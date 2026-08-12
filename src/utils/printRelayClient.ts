/**
 * printRelayClient.ts
 * ============================================================================
 *  عميل وسيط الطباعة السحابي  —  يعمل على ويندوز والأندرويد بالتساوي
 * ============================================================================
 *
 *  لماذا هذا الملف موجود؟
 *  ----------------------
 *  الطريقة القديمة (`printAgent.ts`) كانت تخاطب http://127.0.0.1:9110
 *  مباشرة من المتصفح. توقفت عن العمل لأن:
 *
 *   • Chrome (M130+) يمنع الصفحات المستضافة على الإنترنت من مخاطبة loopback
 *     أو الشبكة المحلية إلا بإذن Local Network Access صريح.
 *   • Firefox و Safari يحجبان https ← http://127.0.0.1 كـ Mixed Content.
 *   • الأندرويد لا يملك وسيطاً محلياً إطلاقاً.
 *
 *  الحل: كل الطلبات هنا تذهب إلى **سيرفر سين نفسه** (نفس الأصل، HTTPS،
 *  مسار نسبي `/api/print/...`). السيرفر يمرر المهمة للوسيط الذي يكون
 *  متصلاً به من جهاز الكاشير. لا localhost ⇒ لا حجب.
 *
 *  الاقتران يحدث مرة واحدة: المستخدم يقرأ رمزاً من 6 أحرف من نافذة الوسيط
 *  ويُدخله هنا، فنحفظ `stationId` و `clientToken` في localStorage.
 * ============================================================================
 */

import i18n from 'i18next';

/* ============================ الأنواع ============================ */

export interface RelayPrinter {
  name: string;
  isDefault?: boolean;
  isVirtual?: boolean;
  driver?: string;
  port?: string;
  status?: string;
}

export interface RelayStation {
  stationId: string;
  hostname: string;
  platform: string;
  agentVersion: string;
  online: boolean;
  lastSeenAt: number;
  printers: RelayPrinter[];
  queued: number;
}

export interface RelayBinding {
  stationId: string;
  clientToken: string;
  hostname: string;
}

export type RelayJobStatus = 'queued' | 'sent' | 'done' | 'failed';

export interface RelayJobState {
  id: string;
  status: RelayJobStatus;
  error?: string;
  bytes?: number;
}

/* ============================ التخزين المحلي ============================ */

const BINDING_KEY = 'seen_relay_binding';

/** قراءة ربط المحطة المحفوظ (إن وُجد). */
export function getRelayBinding(): RelayBinding | null {
  try {
    const raw = localStorage.getItem(BINDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.stationId || !parsed?.clientToken) return null;
    return {
      stationId: String(parsed.stationId),
      clientToken: String(parsed.clientToken),
      hostname: String(parsed.hostname || ''),
    };
  } catch {
    return null;
  }
}

export function setRelayBinding(binding: RelayBinding | null): void {
  try {
    if (!binding) localStorage.removeItem(BINDING_KEY);
    else localStorage.setItem(BINDING_KEY, JSON.stringify(binding));
  } catch {
    /* تجاهل — وضع التصفح الخاص مثلاً */
  }
}

export const isRelayPaired = (): boolean => !!getRelayBinding();

/* ============================ أدوات ============================ */

const jsonHeaders = { 'Content-Type': 'application/json' };

/** قراءة رد JSON بأمان مع رسالة عربية واضحة عند الفشل. */
async function readJson(res: Response): Promise<any> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

/**
 * تحويل بايتات إلى base64 بكفاءة.
 * نعمل على دفعات لأن `String.fromCharCode(...arr)` يتجاوز حد وسائط
 * الدالة ويرمي RangeError على الفواتير الكبيرة.
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    const slice = bytes.subarray(i, i + CHUNK);
    binary += String.fromCharCode.apply(null, Array.from(slice) as any);
  }
  return btoa(binary);
}

const networkError = (e: any): Error =>
  new Error(
    i18n.t('printing.relay.server_unreachable', { error: e?.message || i18n.t('printing.network_error') })
  );

/* ============================================================================
   الاقتران
   ============================================================================ */

/**
 * اقتران المتصفح بمحطة طباعة باستخدام رمز الاقتران الظاهر في نافذة الوسيط.
 * يُنفَّذ مرة واحدة لكل جهاز/متصفح.
 */
export async function pairWithStation(pairCode: string): Promise<RelayStation> {
  const code = String(pairCode || '')
    .toUpperCase()
    .replace(/[^0-9A-Z]/g, '');

  if (code.length < 4) {
    throw new Error(i18n.t('printing.relay.enter_pair_code_6'));
  }

  let res: Response;
  try {
    res = await fetch('/api/print/pair', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({ pairCode: code }),
    });
  } catch (e) {
    throw networkError(e);
  }

  const data = await readJson(res);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || i18n.t('printing.relay.pair_failed_check_code'));
  }

  setRelayBinding({
    stationId: data.stationId,
    clientToken: data.clientToken,
    hostname: data.station?.hostname || '',
  });

  return data.station as RelayStation;
}

/** إلغاء الاقتران على هذا الجهاز فقط (لا يؤثر على الوسيط ولا الأجهزة الأخرى). */
export function unpairStation(): void {
  setRelayBinding(null);
}

/**
 * حالة المحطة المقترنة: متصلة أم لا، وقائمة طابعاتها.
 * ترجع null إذا لم يكن هناك اقتران محفوظ على هذا الجهاز.
 */
export async function getStationStatus(): Promise<RelayStation | null> {
  const binding = getRelayBinding();
  if (!binding) return null;

  const url = `/api/print/station/${encodeURIComponent(binding.stationId)}?clientToken=${encodeURIComponent(
    binding.clientToken
  )}`;

  let res: Response;
  try {
    res = await fetch(url, { method: 'GET' });
  } catch (e) {
    throw networkError(e);
  }

  const data = await readJson(res);

  // 404 = السيرفر لا يعرف هذه المحطة (أُعيد تشغيله) → الاقتران المحفوظ باطل
  if (res.status === 404) {
    setRelayBinding(null);
    throw new Error(
      i18n.t('printing.relay.pairing_expired_restarted')
    );
  }

  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || i18n.t('settings_page.printer.station_status_failed'));
  }

  // تحديث اسم الجهاز المحفوظ إن تغيّر
  if (data.station?.hostname && data.station.hostname !== binding.hostname) {
    setRelayBinding({ ...binding, hostname: data.station.hostname });
  }

  return data.station as RelayStation;
}

/* ============================================================================
   إرسال مهام الطباعة
   ============================================================================ */

export interface SubmitJobOptions {
  /** سبولر نظام التشغيل (طابعة USB/محلية) أو طابعة شبكة على منفذ خام */
  target?: 'spooler' | 'tcp';
  /** اسم الطابعة في نظام التشغيل — لهدف spooler */
  printer?: string;
  /** عنوان الطابعة ومنفذها — لهدف tcp */
  host?: string;
  port?: number;
  docName?: string;
  copies?: number;
}

/** إرسال مهمة للطابور وإرجاع معرّفها فوراً (بدون انتظار الطباعة). */
export async function submitJob(
  data: Uint8Array,
  options: SubmitJobOptions = {}
): Promise<string> {
  const binding = getRelayBinding();
  if (!binding) {
    throw new Error(
      i18n.t('printing.relay.no_station_on_device')
    );
  }
  if (!data?.length) throw new Error(i18n.t('printing.relay.empty_print_data'));

  const target = options.target || 'spooler';

  let res: Response;
  try {
    res = await fetch('/api/print/job', {
      method: 'POST',
      headers: jsonHeaders,
      body: JSON.stringify({
        stationId: binding.stationId,
        clientToken: binding.clientToken,
        target,
        printer: options.printer,
        host: options.host,
        port: options.port,
        docName: options.docName || 'SEEN POS Receipt',
        copies: options.copies || 1,
        dataBase64: bytesToBase64(data),
      }),
    });
  } catch (e) {
    throw networkError(e);
  }

  const payload = await readJson(res);

  if (res.status === 404) {
    setRelayBinding(null);
    throw new Error(
      i18n.t('printing.relay.pairing_expired')
    );
  }

  if (!res.ok || !payload?.ok) {
    throw new Error(payload?.error || i18n.t('printing.relay.submit_job_failed'));
  }

  return String(payload.jobId);
}

/** قراءة حالة مهمة واحدة. */
export async function getJobState(jobId: string): Promise<RelayJobState> {
  const binding = getRelayBinding();
  if (!binding) throw new Error(i18n.t('printing.relay.no_station_paired'));

  const url = `/api/print/job/${encodeURIComponent(jobId)}?clientToken=${encodeURIComponent(
    binding.clientToken
  )}`;

  const res = await fetch(url, { method: 'GET' });
  const data = await readJson(res);

  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || i18n.t('printing.relay.job_state_failed'));
  }
  return data.job as RelayJobState;
}

/**
 * انتظار انتهاء المهمة فعلياً على الطابعة.
 * نستخدم استقصاءً قصيراً متسارعاً في البداية (أغلب الفواتير تطبع في أقل من
 * ثانية) ثم نُبطئ تدريجياً حتى لا نُثقل السيرفر.
 *
 * ملاحظة تصميمية: تُرجع الدالة بنجاح فقط عند تأكيد الوسيط للطباعة، فلا
 * نعرض «تمت الطباعة» للكاشير والورق لم يخرج — وهي مشكلة كانت موجودة سابقاً.
 */
export async function waitForJob(jobId: string, timeoutMs = 25_000): Promise<void> {
  const startedAt = Date.now();
  let delay = 250;

  for (;;) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error(
        i18n.t('printing.relay.no_confirmation_timeout')
      );
    }

    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(1500, Math.round(delay * 1.5));

    let state: RelayJobState;
    try {
      state = await getJobState(jobId);
    } catch {
      continue; // انقطاع مؤقت — نعيد المحاولة حتى المهلة
    }

    if (state.status === 'done') return;
    if (state.status === 'failed') {
      throw new Error(state.error || i18n.t('printing.relay.print_failed_in_agent'));
    }
  }
}

/** إرسال مهمة وانتظار تأكيد طباعتها — الدالة التي يستخدمها محرك الطباعة. */
export async function printViaRelay(
  data: Uint8Array,
  options: SubmitJobOptions = {}
): Promise<void> {
  const jobId = await submitJob(data, options);

  /*
   * بعد نجاح submitJob تكون المهمة مُدرَجة في طابور الخادم، وقد يسحبها الوسيط
   * ويطبعها في أي لحظة. لذلك أي فشل من هنا (انقضاء مهلة انتظار التأكيد، أو
   * تقرير فشل من الوسيط) هو فشل **غامض**: قد تكون الفاتورة خرجت بالفعل.
   *
   * نُعلّم الخطأ بـ `dispatched` ليعرف المتصل أنه لا يجوز إعادة الطباعة
   * تلقائياً عبر مسار آخر أو عبر مربع الحوار — وإلا خرج إيصالان.
   */
  try {
    await waitForJob(jobId);
  } catch (e: any) {
    if (e && typeof e === 'object') e.dispatched = true;
    throw e;
  }
}
