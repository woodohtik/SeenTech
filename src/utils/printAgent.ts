/**
 * printAgent.ts
 * ============================================================================
 *  الوسيط المحلي (127.0.0.1:9110)  —  مسار سريع اختياري
 * ============================================================================
 *
 *  ⚠️  هذا لم يعد المسار الأساسي للطباعة الصامتة.
 *
 *  لماذا؟
 *  ------
 *  مخاطبة http://127.0.0.1 من صفحة مستضافة على HTTPS لم تعد تعمل بشكل
 *  موثوق في المتصفحات الحديثة:
 *
 *   1) Local Network Access / Private Network Access
 *      Chrome (M130 وما بعده) يمنع أي صفحة على الإنترنت من مخاطبة loopback
 *      أو عنوان شبكة محلية إلا بإذن صريح. ترويسة
 *      `Access-Control-Allow-Private-Network` التي كان الوسيط يرسلها لم تعد
 *      كافية. الـ fetch يفشل بـ TypeError عام لا يفرّق بين «الوسيط مغلق» و
 *      «المتصفح حجب الطلب» — ولهذا كان النظام يقول «الوسيط غير مُشغَّل» بينما
 *      الوسيط يعمل فعلاً. هذا كان جوهر المشكلة.
 *
 *   2) Mixed Content
 *      Firefox و Safari يحجبان https ← http://127.0.0.1 حجباً كاملاً.
 *
 *   3) الأندرويد
 *      لا يوجد وسيط محلي على الأندرويد إطلاقاً.
 *
 *  البديل: `printRelayClient.ts` — الوسيط يتصل خارجاً بالسيرفر وينتظر
 *  المهام، فتعمل الطباعة الصامتة من أي جهاز بدون أي من هذه القيود.
 *
 *  نُبقي هذا الملف لأن المسار المحلي — عند توفره — أسرع بقليل (لا يمر
 *  بالإنترنت). لكن الفارق ضئيل، والتشخيص هنا صار صريحاً بحيث لا يُضلّل
 *  المستخدم مرة أخرى.
 * ============================================================================
 */

import i18n from 'i18next';

export interface AgentInfo {
  online: boolean;
  version?: string;
  hostname?: string;
  platform?: string;
  tokenRequired?: boolean;
  defaultPrinter?: string;
  error?: string;
  /** سبب الفشل مصنّفاً — يسمح للواجهة بعرض الإرشاد الصحيح */
  reason?: 'ok' | 'blocked-by-browser' | 'mixed-content' | 'not-running' | 'bad-response' | 'timeout';
}

export interface AgentPrinter {
  name: string;
  isDefault?: boolean;
  isVirtual?: boolean;
  driver?: string;
  port?: string;
  status?: string;
}

const AGENT_BASE_URL = 'http://127.0.0.1:9110';
const TOKEN_STORAGE_KEY = 'seen_agent_token';

/* ============================ رمز الوصول ============================ */

export function getAgentToken(): string {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(TOKEN_STORAGE_KEY) || '';
}

export function setAgentToken(token: string): void {
  if (typeof localStorage === 'undefined') return;
  if (!token) localStorage.removeItem(TOKEN_STORAGE_KEY);
  else localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

/**
 * ترويسات الطلب.
 * ملاحظة: لا نضيف `Content-Type` على طلبات GET إطلاقاً. إضافته تجعل الطلب
 * "غير بسيط" فتفرض على المتصفح إرسال preflight إضافي إلى localhost — وهي
 * نقطة فشل زائدة لا داعي لها. (كان هذا خطأً في الإصدار السابق.)
 */
function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const token = getAgentToken();
  if (token) headers['X-Seen-Token'] = token;
  return headers;
}

function jsonHeaders(): Record<string, string> {
  return { 'Content-Type': 'application/json', ...authHeaders() };
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 8192;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + CHUNK)) as any);
  }
  return btoa(binary);
}

/* ============================ تشخيص بيئة المتصفح ============================ */

/**
 * هل يستطيع هذا المتصفح مخاطبة 127.0.0.1 من الصفحة الحالية إطلاقاً؟
 *
 * نفحص هذا **قبل** المحاولة حتى نعطي سبباً حقيقياً بدل «الوسيط غير مُشغَّل».
 */
export function localAgentReachability(): {
  possible: boolean;
  reason: NonNullable<AgentInfo['reason']>;
  message: string;
} {
  if (typeof window === 'undefined') {
    return { possible: false, reason: 'not-running', message: i18n.t('printing.agent.env_unavailable') };
  }

  const ua = navigator.userAgent || '';
  const isAndroid = /Android/i.test(ua);
  const isIOS = /iPad|iPhone|iPod/i.test(ua);
  const pageIsHttps = window.location.protocol === 'https:';
  const isChromium = /Chrome|Chromium|Edg|OPR/i.test(ua) && !/Firefox/i.test(ua);
  const isFirefox = /Firefox/i.test(ua);
  const isSafari = /Safari/i.test(ua) && !isChromium;

  if (isAndroid || isIOS) {
    return {
      possible: false,
      reason: 'not-running',
      message: i18n.t('printing.agent.unavailable_on_mobile'),
    };
  }

  if (pageIsHttps && (isFirefox || isSafari)) {
    return {
      possible: false,
      reason: 'mixed-content',
      message: i18n.t('printing.agent.mixed_content_blocked'),
    };
  }

  if (pageIsHttps && isChromium) {
    return {
      possible: true,
      reason: 'blocked-by-browser',
      message: i18n.t('printing.agent.local_network_access_warning'),
    };
  }

  return { possible: true, reason: 'ok', message: '' };
}

/* ============================ فحص الوسيط المحلي ============================ */

/**
 * فحص الاتصال بوسيط الطباعة المحلي.
 *
 * الفرق الجوهري عن الإصدار السابق: لم نعد نفترض أن كل فشل يعني «الوسيط
 * غير مُشغَّل». نُفرّق بين حجب المتصفح وبين الوسيط المتوقف فعلاً، ونعطي
 * المستخدم الإرشاد الصحيح في كل حالة.
 */
export async function detectPrintAgent(): Promise<AgentInfo> {
  const reach = localAgentReachability();

  if (!reach.possible) {
    return { online: false, reason: reach.reason, error: reach.message };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2500);

  try {
    const res = await fetch(`${AGENT_BASE_URL}/health`, {
      method: 'GET',
      headers: authHeaders(),
      signal: controller.signal,
      // لا نرسل أي كوكيز للوسيط المحلي — لا حاجة لها
      credentials: 'omit',
      cache: 'no-store',
    });
    clearTimeout(timeoutId);

    if (!res.ok) {
      return {
        online: false,
        reason: 'bad-response',
        error: i18n.t('printing.agent.bad_response', { status: res.status }),
      };
    }

    const data = await res.json();
    if (data?.ok) {
      return {
        online: true,
        reason: 'ok',
        version: data.version,
        hostname: data.hostname,
        platform: data.platform,
        tokenRequired: data.tokenRequired,
        defaultPrinter: data.defaultPrinter,
      };
    }

    return {
      online: false,
      reason: 'bad-response',
      error: data?.error || i18n.t('printing.agent.connect_failed'),
    };
  } catch (err: any) {
    clearTimeout(timeoutId);

    if (err?.name === 'AbortError') {
      return {
        online: false,
        reason: 'timeout',
        error: i18n.t('printing.agent.timeout'),
      };
    }

    /*
     * هنا مربط الفرس. المتصفح يرمي نفس `TypeError: Failed to fetch` في
     * حالتين مختلفتين تماماً، ولا يكشف أيهما لأسباب أمنية:
     *   (أ) لا يوجد شيء يستمع على المنفذ (الوسيط مغلق فعلاً)
     *   (ب) المتصفح حجب الطلب (Local Network Access / Mixed Content)
     * لذلك نذكر السببين معاً بدل الجزم بواحد — وهذا ما كان يُضلّل المستخدم.
     */
    return {
      online: false,
      reason: 'blocked-by-browser',
      error: i18n.t('printing.agent.unreachable'),
    };
  }
}

/* ============================ عمليات الوسيط المحلي ============================ */

export async function listAgentPrinters(): Promise<AgentPrinter[]> {
  const res = await fetch(`${AGENT_BASE_URL}/printers`, {
    method: 'GET',
    headers: authHeaders(),
    credentials: 'omit',
    cache: 'no-store',
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || i18n.t('printing.agent.list_printers_failed'));
  }
  return data.printers || [];
}

export async function testPrintViaAgent(printerName: string, text?: string): Promise<void> {
  const defaultText =
    '================================\n' +
    '  SEEN POS Print Agent Test     \n' +
    '================================\n' +
    `Printer: ${printerName.replace(/[^\x20-\x7e]/g, '').trim() || 'POS Printer'}\n` +
    `Date: ${new Date().toISOString().slice(0, 19).replace('T', ' ')}\n` +
    '--------------------------------\n' +
    '       CONNECTION OK\n' +
    '--------------------------------\n\n';

  const res = await fetch(`${AGENT_BASE_URL}/print/text`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'omit',
    body: JSON.stringify({ printer: printerName, text: text || defaultText }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok || !data?.ok) {
    throw new Error(data?.error || i18n.t('printing.agent.test_print_failed'));
  }
}

export async function sendRawToAgent(
  printerName: string,
  data: Uint8Array,
  docName: string = 'SEEN POS Receipt'
): Promise<void> {
  if (!printerName) throw new Error(i18n.t('printing.agent.printer_name_missing'));

  const res = await fetch(`${AGENT_BASE_URL}/print/raw`, {
    method: 'POST',
    headers: jsonHeaders(),
    credentials: 'omit',
    body: JSON.stringify({
      printer: printerName,
      dataBase64: uint8ArrayToBase64(data),
      docName,
    }),
  });

  const dataRes = await res.json().catch(() => null);
  if (!res.ok || !dataRes?.ok) {
    throw new Error(
      dataRes?.error || i18n.t('printing.agent.send_invoice_failed', { printer: printerName })
    );
  }
}
