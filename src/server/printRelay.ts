/**
 * printRelay.ts
 * ============================================================================
 *  وسيط الطباعة السحابي  —  SEEN POS Cloud Print Relay
 * ============================================================================
 *
 *  المشكلة التي يحلها هذا الملف
 *  ----------------------------
 *  الطريقة القديمة كانت: المتصفح ← http://127.0.0.1:9110 (وسيط محلي).
 *  هذه الطريقة تفشل فشلاً صامتاً في المتصفحات الحديثة لثلاثة أسباب مجتمعة:
 *
 *   1) Local Network Access / Private Network Access:
 *      Chrome (M130 وما بعده) يمنع أي صفحة على الإنترنت من مخاطبة عنوان
 *      loopback أو عنوان شبكة محلية إلا بإذن صريح. ترويسة
 *      `Access-Control-Allow-Private-Network` القديمة لم تعد كافية.
 *      النتيجة: fetch يفشل بـ "Failed to fetch" — وهو نفس شكل خطأ
 *      «الوسيط غير مُشغَّل»، ولهذا كان التشخيص مضلِّلاً.
 *
 *   2) Mixed Content:
 *      Firefox و Safari يحجبان https:// ← http://127.0.0.1 حجباً كاملاً.
 *
 *   3) الأندرويد:
 *      لا يوجد أي وسيط محلي على أندرويد إطلاقاً، فالمسار كان معدوماً.
 *
 *  الحل
 *  ----
 *  نقلب اتجاه الاتصال. الوسيط على جهاز الكاشير هو الذي **يتصل خارجاً**
 *  بهذا السيرفر ويظل يستقصي (poll) عن مهام الطباعة. المتصفح — على أي
 *  جهاز، ويندوز أو أندرويد أو آيباد — يرسل المهمة إلى السيرفر فقط.
 *
 *      [متصفح أي جهاز]  ──POST──►  [السيرفر]  ◄──poll──  [وسيط الكاشير]
 *                                       │                        │
 *                                       ▼                        ▼
 *                                  Supabase           سبولر ويندوز / TCP 9100
 *
 *  لا يوجد أي اتصال بـ localhost ⇒ لا mixed content، لا CORS، لا
 *  Local Network Access، ولا حاجة لفتح أي منفذ في جدار الحماية.
 *
 *  ============================================================================
 *  ⚠️ لماذا Supabase وليس Map في الذاكرة؟ (درس مكلف)
 *  ----------------------------------------------------------------------------
 *  الإصدار الأول من هذا الملف خزّن المحطات والمهام في `Map` داخل عملية
 *  Node واحدة — يعمل ممتازاً على سيرفر Express طويل العمر (`npm start`).
 *  لكن هذا المشروع منشور على **Vercel Functions** (انظر `api/index.js`):
 *  كل طلب قد يصل إلى **نسخة (instance) مختلفة تماماً** من الدالة، ولا ذاكرة
 *  مشتركة بينها إطلاقاً. النتيجة كانت خللاً حقيقياً وصامتاً: الوسيط يسجّل
 *  نفسه فتصل نسخة "hello" فيُنشئ رمز الاقتران في ذاكرة نسخة A، ثم يضغط
 *  المستخدم "اقتران" في المتصفح فتصل نسخة "pair" إلى نسخة B التي لا تعرف
 *  عن هذا الرمز شيئاً ⇒ «رمز اقتران غير صحيح» رغم أن الرمز صحيح تماماً.
 *
 *  ثبتّ هذا فعلياً: تسجيل 8 محطات وهمية بالتوازي ثم محاولة الاقتران بكل
 *  الرموز الثمانية بالتوازي أنجح واحداً فقط من ثمانية — نفس الخطأ الذي
 *  رآه المستخدم تماماً. الحل: كل الحالة هنا الآن في Supabase (جداول
 *  `print_stations` / `print_jobs` / `print_pair_attempts`، مشتركة بين كل
 *  نسخ الدالة). الـ long-poll نفسه تحوّل لاستقصاء قصير متكرر (~1.2 ثانية)
 *  داخل نفس طلب HTTP الواحد بدل التسليم الفوري عبر callback في الذاكرة —
 *  فيبقى الشكل الخارجي (poll يعلّق حتى 25 ثانية، 204 عند عدم وجود مهمة)
 *  مطابقاً تماماً، فلا حاجة لتغيير أي كود في الوسيط أو المتصفح.
 *  ============================================================================
 */

import type { Express, Request, Response } from 'express';
import crypto from 'crypto';
import net from 'net';
import { authenticate } from './middleware/authMiddleware.ts';
import { supabaseAdmin } from './supabase-admin.ts';

/* ============================ الأنواع ============================ */

export type PrintTargetKind = 'spooler' | 'tcp';

export interface RelayPrinter {
  name: string;
  isDefault?: boolean;
  isVirtual?: boolean;
  driver?: string;
  port?: string;
  status?: string;
}

export interface PrintJob {
  id: string;
  stationId: string;
  /** نوع الهدف: سبولر نظام التشغيل أو طابعة شبكة على منفذ خام */
  target: PrintTargetKind;
  /** اسم الطابعة في نظام التشغيل — لهدف spooler */
  printer?: string;
  /** عنوان الطابعة ومنفذها — لهدف tcp */
  host?: string;
  port?: number;
  dataBase64: string;
  docName: string;
  copies: number;
  status: 'queued' | 'sent' | 'done' | 'failed';
  error?: string;
  bytes?: number;
  createdAt: number;
  updatedAt: number;
}

/** صف جدول print_stations كما يُخزَّن في Supabase. */
interface StationRow {
  id: string;
  agent_token: string;
  client_token: string;
  pair_code: string;
  hostname: string;
  platform: string;
  agent_version: string;
  printers: RelayPrinter[];
  last_seen_at: string;
  created_at: string;
}

/** صف جدول print_jobs كما يُخزَّن في Supabase. */
interface JobRow {
  id: string;
  station_id: string;
  target: PrintTargetKind;
  printer: string | null;
  host: string | null;
  port: number | null;
  data_base64: string;
  doc_name: string;
  copies: number;
  status: 'queued' | 'sent' | 'done' | 'failed';
  error: string | null;
  bytes: number | null;
  created_at: string;
  updated_at: string;
}

/* ============================ الإعدادات ============================ */

const CONFIG = {
  /** بعد هذه المدة بدون أي اتصال تُعتبر المحطة غير متصلة */
  offlineAfterMs: 45_000,
  /** أقصى مدة يبقى فيها طلب poll معلّقاً قبل إرجاع 204 */
  maxPollWaitMs: 25_000,
  /** الفاصل بين كل محاولة استقصاء عن مهمة جديدة أثناء الانتظار */
  pollIntervalMs: 1_200,
  /** أقصى عدد مهام في الطابور لكل محطة */
  maxQueuePerStation: 40,
  /** مدة الاحتفاظ بسجل المهمة بعد انتهائها (لقراءة الحالة من المتصفح) */
  jobRetentionMs: 10 * 60_000,
  /** حذف المحطات التي لم تظهر إطلاقاً بعد هذه المدة */
  stationTtlMs: 14 * 24 * 60 * 60_000,
  /** أقصى حجم بيانات لمهمة واحدة (base64) */
  maxJobBytes: 8 * 1024 * 1024,
  /** أقصى عدد محاولات اقتران خاطئة لكل عنوان IP في الدقيقة */
  pairAttemptsPerMinute: 10,
  /** مهمة تبقى queued (لم يستقصِ عنها أي وسيط) أطول من هذه المدة تُعتبر
   *  فاشلة -- بدون هذا تبقى "قيد الانتظار" للأبد إن كانت المحطة غير متصلة
   *  أو غير موجودة أصلاً (3، seen-comprehensive-review-fixes-task.md). */
  queuedJobTimeoutMs: 30 * 60_000,
};

/* ============================ أدوات ============================ */

const nowMs = () => Date.now();
const nowIso = () => new Date().toISOString();

const newId = () => crypto.randomBytes(16).toString('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

/**
 * رمز اقتران من 6 أحرف بأبجدية بلا حروف متشابهة (لا 0/O ولا 1/I/L)
 * حتى لا يخطئ المستخدم في قراءته عن الشاشة.
 */
const PAIR_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const randomPairCode = (): string => {
  let code = '';
  const bytes = crypto.randomBytes(6);
  for (let i = 0; i < 6; i++) code += PAIR_ALPHABET[bytes[i] % PAIR_ALPHABET.length];
  return code;
};

/** مقارنة رموز بزمن ثابت — تمنع استنتاج الرمز من فروق التوقيت. */
const safeEqual = (a: unknown, b: unknown): boolean => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
};

const isOnline = (s: Pick<StationRow, 'last_seen_at'>) =>
  nowMs() - new Date(s.last_seen_at).getTime() < CONFIG.offlineAfterMs;

// req.ip -- server.ts يضبط app.set('trust proxy', 1) فيثق Express بقفزة
// وكيل Vercel الواحدة ويشتق العنوان من الطرف الصحيح من سلسلة
// X-Forwarded-For، فلا يقدر الطالب تزييف عنوانه بوضع قيمة مزوَّرة في أول
// الترويسة (القراءة اليدوية السابقة كانت تأخذ أول قيمة في القائمة، وهي
// بالضبط ما يتحكم به الطالب -- يتيح تجاوز حد pairAttemptsPerMinute أدناه).
const clientIp = (req: Request): string => req.ip || 'unknown';

const bearer = (req: Request): string => {
  const h = String(req.headers.authorization || '');
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : String(req.headers['x-seen-agent-token'] || '');
};

const rowToJob = (r: JobRow): PrintJob => ({
  id: r.id,
  stationId: r.station_id,
  target: r.target,
  printer: r.printer ?? undefined,
  host: r.host ?? undefined,
  port: r.port ?? undefined,
  dataBase64: r.data_base64,
  docName: r.doc_name,
  copies: r.copies,
  status: r.status,
  error: r.error ?? undefined,
  bytes: r.bytes ?? undefined,
  createdAt: new Date(r.created_at).getTime(),
  updatedAt: new Date(r.updated_at).getTime(),
});

const queuedCountFor = async (stationId: string): Promise<number> => {
  const { count } = await supabaseAdmin
    .from('print_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('station_id', stationId)
    .eq('status', 'queued');
  return count || 0;
};

/** إخراج آمن لبيانات المحطة — بدون أي رموز سرية. */
const publicStation = async (s: StationRow) => ({
  stationId: s.id,
  hostname: s.hostname,
  platform: s.platform,
  agentVersion: s.agent_version,
  online: isOnline(s),
  lastSeenAt: new Date(s.last_seen_at).getTime(),
  printers: s.printers,
  queued: await queuedCountFor(s.id),
});

const fetchStationById = async (id: string): Promise<StationRow | null> => {
  if (!id) return null;
  const { data } = await supabaseAdmin.from('print_stations').select('*').eq('id', id).maybeSingle();
  return (data as StationRow) || null;
};

/* ==================== تنظيف دوري (أفضل جهد) ==================== */
/*
 * على Vercel Functions لا يوجد ضمان أن تبقى نسخة الدالة حيّة طويلاً كفاية
 * ليعمل setInterval بانتظام — هذا تنظيف "أفضل جهد" فقط، غير حرج للصحة
 * الوظيفية (poll يتجاهل أصلاً المحطات غير المتصلة بناءً على last_seen_at،
 * والصفوف المنتهية تبقى مجرد سجلات قديمة غير مؤذية حتى تُحذف).
 */
let sweeper: NodeJS.Timeout | null = null;

const sweep = async () => {
  try {
    const jobCutoff = new Date(nowMs() - CONFIG.jobRetentionMs).toISOString();
    await supabaseAdmin.from('print_jobs').delete().in('status', ['done', 'failed']).lt('updated_at', jobCutoff);

    const stuckCutoff = new Date(nowMs() - 120_000).toISOString();
    await supabaseAdmin
      .from('print_jobs')
      .update({
        status: 'failed',
        error: 'انقطع الاتصال بوسيط الطباعة قبل تأكيد الطباعة.',
        updated_at: nowIso(),
      })
      .eq('status', 'sent')
      .lt('updated_at', stuckCutoff);

    const queuedCutoff = new Date(nowMs() - CONFIG.queuedJobTimeoutMs).toISOString();
    await supabaseAdmin
      .from('print_jobs')
      .update({
        status: 'failed',
        error: 'لم يستلم وسيط الطباعة هذه المهمة خلال مدة معقولة (المحطة غير متصلة على الأرجح).',
        updated_at: nowIso(),
      })
      .eq('status', 'queued')
      .lt('created_at', queuedCutoff);

    const stationCutoff = new Date(nowMs() - CONFIG.stationTtlMs).toISOString();
    await supabaseAdmin.from('print_stations').delete().lt('last_seen_at', stationCutoff);

    await supabaseAdmin.from('print_pair_attempts').delete().lt('reset_at', nowIso());
  } catch (e: any) {
    console.warn('[print-relay] فشل التنظيف الدوري:', e?.message || e);
  }
};

/* ============================================================================
   الطباعة المباشرة على طابعة شبكة من السيرفر (مسار احتياطي)
   ----------------------------------------------------------------------------
   يعمل فقط إذا كان السيرفر نفسه على شبكة الطابعة (تشغيل محلي في المتجر).
   إذا كان السيرفر في السحابة فلن يصل لعناوين 192.168.x.x — ولهذا نرجّح
   دائماً مسار الوسيط، ونعيد رسالة واضحة عند الفشل.
   ============================================================================ */

const PRIVATE_HOST_RE =
  /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|127\.\d{1,3}\.\d{1,3}\.\d{1,3}|localhost)$/;

export const isPrivateHost = (host: unknown): host is string =>
  typeof host === 'string' && host.length > 0 && PRIVATE_HOST_RE.test(host.trim());

export const sendRawToTcpPrinter = (
  host: string,
  port: number,
  buffer: Buffer,
  timeoutMs = 8000
): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const done = (err?: Error) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* تجاهل */
      }
      err ? reject(err) : resolve();
    };

    socket.setTimeout(timeoutMs);
    socket.once('timeout', () =>
      done(new Error(`انتهت مهلة الاتصال بالطابعة ${host}:${port}.`))
    );
    socket.once('error', (e: NodeJS.ErrnoException) => {
      const hint =
        e.code === 'ECONNREFUSED'
          ? 'الطابعة رفضت الاتصال — تأكد أن منفذ الطباعة الخام (9100) مفعّل في إعداداتها.'
          : e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH'
          ? 'لا يمكن الوصول للطابعة — السيرفر ليس على نفس شبكة الطابعة. استخدم «وسيط سين» على جهاز داخل المتجر.'
          : e.message;
      done(new Error(`فشل الاتصال بـ ${host}:${port}: ${hint}`));
    });

    socket.connect(port, host, () => {
      socket.write(buffer, (writeErr) => {
        if (writeErr) return done(writeErr);
        setTimeout(() => {
          socket.end();
          done();
        }, 400);
      });
    });
  });

/* ============================================================================
   تركيب المسارات
   ============================================================================ */

export function registerPrintRelay(app: Express): void {
  if (!sweeper) {
    sweeper = setInterval(() => void sweep(), 30_000);
    // لا نمنع إيقاف العملية بسبب هذا المؤقّت
    if (typeof sweeper.unref === 'function') sweeper.unref();
  }

  /* ======================================================================
     1) جانب الوسيط  (يعمل على جهاز الكاشير)
     ====================================================================== */

  /**
   * POST /api/print/agent/hello
   * تسجيل المحطة أو تحديث بياناتها. يُستدعى عند إقلاع الوسيط وكل مرة
   * تتغير فيها قائمة الطابعات.
   *
   * الطلب : { stationId?, agentToken?, hostname, platform, agentVersion, printers[] }
   * الرد  : { ok, stationId, agentToken, pairCode, pollWaitMs }
   *
   * إذا أرسل الوسيط stationId + agentToken صحيحين نحتفظ بنفس رمز الاقتران
   * حتى لا يحتاج المستخدم لإعادة الاقتران بعد كل إعادة تشغيل.
   */
  app.post('/api/print/agent/hello', async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const hostname = String(body.hostname || 'unknown').slice(0, 120);
      const platform = String(body.platform || 'unknown').slice(0, 40);
      const agentVersion = String(body.agentVersion || '0').slice(0, 20);

      const printers: RelayPrinter[] = Array.isArray(body.printers)
        ? body.printers
            .filter((p: any) => p && typeof p.name === 'string' && p.name.trim())
            .slice(0, 60)
            .map((p: any) => ({
              name: String(p.name).slice(0, 200),
              isDefault: !!p.isDefault,
              isVirtual: !!p.isVirtual,
              driver: String(p.driver || '').slice(0, 200),
              port: String(p.port || '').slice(0, 80),
              status: String(p.status || '').slice(0, 60),
            }))
        : [];

      const wantedId = typeof body.stationId === 'string' ? body.stationId : '';
      const existing = wantedId ? await fetchStationById(wantedId) : null;

      // استئناف محطة قائمة — يشترط رمز الوسيط الصحيح
      if (existing && safeEqual(body.agentToken, existing.agent_token)) {
        const { error } = await supabaseAdmin
          .from('print_stations')
          .update({ hostname, platform, agent_version: agentVersion, printers, last_seen_at: nowIso() })
          .eq('id', existing.id);
        if (error) throw error;

        return res.json({
          ok: true,
          stationId: existing.id,
          agentToken: existing.agent_token,
          clientToken: existing.client_token,
          pairCode: existing.pair_code,
          pollWaitMs: CONFIG.maxPollWaitMs,
          resumed: true,
        });
      }

      // محطة جديدة — نحاول عدة مرات عند تصادم نادر في رمز الاقتران (فريد في الجدول)
      const id = newId();
      const agentToken = newToken();
      const clientToken = newToken();

      let insertError: any = null;
      let pairCode = '';
      for (let attempt = 0; attempt < 5; attempt++) {
        pairCode = randomPairCode();
        const { error } = await supabaseAdmin.from('print_stations').insert({
          id,
          agent_token: agentToken,
          client_token: clientToken,
          pair_code: pairCode,
          hostname,
          platform,
          agent_version: agentVersion,
          printers,
          last_seen_at: nowIso(),
        });
        if (!error) {
          insertError = null;
          break;
        }
        insertError = error;
        // 23505 = unique_violation — تصادم في pair_code فقط (id عشوائي 128-بت)
        if (error.code !== '23505') break;
      }
      if (insertError) throw insertError;

      console.log(
        `[print-relay] محطة جديدة "${hostname}" (${platform}) — رمز الاقتران ${pairCode} — ${printers.length} طابعة`
      );

      res.json({
        ok: true,
        stationId: id,
        agentToken,
        clientToken,
        pairCode,
        pollWaitMs: CONFIG.maxPollWaitMs,
        resumed: false,
      });
    } catch (e: any) {
      console.error('[print-relay] /agent/hello:', e?.message || e);
      res.status(500).json({ ok: false, error: 'تعذر تسجيل المحطة. حاول مرة أخرى.' });
    }
  });

  /**
   * GET /api/print/agent/poll?stationId=...
   * Authorization: Bearer <agentToken>
   *
   * يبقى الطلب معلّقاً حتى تصل مهمة (200 + المهمة) أو تنتهي المهلة (204).
   * هذا الطلب هو أيضاً نبضة الحياة التي تُبقي المحطة «متصلة».
   *
   * التنفيذ: استقصاء قصير متكرر عن `print_jobs` طوال مدة الطلب الواحد —
   * لا اعتماد على أي حالة في ذاكرة العملية بين طلبين مختلفين.
   */
  app.get('/api/print/agent/poll', async (req: Request, res: Response) => {
    try {
      const stationId = String(req.query.stationId || '');
      const station = await fetchStationById(stationId);

      if (!station || !safeEqual(bearer(req), station.agent_token)) {
        // 409 وليس 401: نُشير للوسيط أن عليه إعادة التسجيل من الصفر
        return res.status(409).json({ ok: false, error: 'المحطة غير مسجّلة. أعد التسجيل عبر /hello.' });
      }

      await supabaseAdmin.from('print_stations').update({ last_seen_at: nowIso() }).eq('id', stationId);

      let clientGone = false;
      req.on('close', () => {
        clientGone = true;
      });

      const deadline = nowMs() + CONFIG.maxPollWaitMs;

      for (;;) {
        if (clientGone || res.writableEnded) return;

        const { data: candidate } = await supabaseAdmin
          .from('print_jobs')
          .select('*')
          .eq('station_id', stationId)
          .eq('status', 'queued')
          .order('created_at', { ascending: true })
          .limit(1)
          .maybeSingle();

        if (candidate) {
          // مطالبة ذرّية: لا نسلّم المهمة إلا إذا فزنا بسباق التحديث (لا يزال 'queued')
          const { data: claimed } = await supabaseAdmin
            .from('print_jobs')
            .update({ status: 'sent', updated_at: nowIso() })
            .eq('id', candidate.id)
            .eq('status', 'queued')
            .select('*')
            .maybeSingle();

          if (claimed) {
            return res.json({ ok: true, job: rowToJob(claimed as JobRow) });
          }
          // خسرنا السباق لنسخة أخرى — نعيد المحاولة فوراً دون انتظار
          continue;
        }

        if (nowMs() >= deadline) break;
        await new Promise((r) => setTimeout(r, CONFIG.pollIntervalMs));
      }

      if (!clientGone && !res.writableEnded) res.status(204).end();
    } catch (e: any) {
      console.error('[print-relay] /agent/poll:', e?.message || e);
      if (!res.writableEnded) res.status(500).json({ ok: false, error: 'خطأ في السيرفر أثناء انتظار المهام.' });
    }
  });

  /**
   * POST /api/print/agent/result
   * Authorization: Bearer <agentToken>
   * الطلب: { stationId, jobId, ok, error?, bytes? }
   */
  app.post('/api/print/agent/result', async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const stationId = String(body.stationId || '');
      const station = await fetchStationById(stationId);

      if (!station || !safeEqual(bearer(req), station.agent_token)) {
        return res.status(409).json({ ok: false, error: 'المحطة غير مسجّلة.' });
      }

      await supabaseAdmin.from('print_stations').update({ last_seen_at: nowIso() }).eq('id', stationId);

      const jobId = String(body.jobId || '');
      const { data: job } = await supabaseAdmin
        .from('print_jobs')
        .select('id, station_id, bytes')
        .eq('id', jobId)
        .maybeSingle();

      if (!job || job.station_id !== stationId) {
        return res.status(404).json({ ok: false, error: 'المهمة غير موجودة.' });
      }

      const ok = !!body.ok;
      const error = ok ? null : String(body.error || 'فشل غير محدد في الوسيط.').slice(0, 600);
      const bytes = Number(body.bytes) || job.bytes || null;

      await supabaseAdmin
        .from('print_jobs')
        .update({ status: ok ? 'done' : 'failed', error, bytes, updated_at: nowIso() })
        .eq('id', jobId);

      if (!ok) console.warn(`[print-relay] فشلت المهمة ${jobId}: ${error}`);

      res.json({ ok: true });
    } catch (e: any) {
      console.error('[print-relay] /agent/result:', e?.message || e);
      res.status(500).json({ ok: false, error: 'تعذر تسجيل نتيجة المهمة.' });
    }
  });

  /* ======================================================================
     2) جانب المتصفح  (أي جهاز: ويندوز، أندرويد، آيباد)
     ====================================================================== */

  /**
   * POST /api/print/pair
   * الطلب: { pairCode }
   * الرد : { ok, stationId, clientToken, station }
   *
   * يُدخل المستخدم رمز الاقتران الظاهر في نافذة الوسيط مرة واحدة فقط.
   */
  app.post('/api/print/pair', async (req: Request, res: Response) => {
    try {
      const ip = clientIp(req);
      const { data: rec } = await supabaseAdmin.from('print_pair_attempts').select('*').eq('ip', ip).maybeSingle();
      const recActive = rec && new Date(rec.reset_at).getTime() > nowMs();

      if (recActive && rec.count >= CONFIG.pairAttemptsPerMinute) {
        return res.status(429).json({
          ok: false,
          error: 'محاولات كثيرة جداً. انتظر دقيقة ثم أعد المحاولة.',
        });
      }

      const code = String((req.body || {}).pairCode || '')
        .toUpperCase()
        .replace(/[^0-9A-Z]/g, '');

      const { data: station } = await supabaseAdmin
        .from('print_stations')
        .select('*')
        .eq('pair_code', code)
        .maybeSingle();

      if (!station) {
        // increment_print_pair_attempt (RPC ذرّية) بدل upsert قراءة-ثم-كتابة
        // -- نفس إصلاح increment_tracking_attempt، يمنع محاولتين متزامنتين
        // من الكتابة على نفس count القديم بدل التراكم الصحيح.
        await supabaseAdmin.rpc('increment_print_pair_attempt', { p_ip: ip });
        return res.status(404).json({
          ok: false,
          error: 'رمز اقتران غير صحيح، أو أن وسيط الطباعة غير مُشغَّل. تأكد من الرمز الظاهر في نافذة الوسيط.',
        });
      }

      await supabaseAdmin.from('print_pair_attempts').delete().eq('ip', ip);

      res.json({
        ok: true,
        stationId: station.id,
        clientToken: station.client_token,
        station: await publicStation(station as StationRow),
      });
    } catch (e: any) {
      console.error('[print-relay] /pair:', e?.message || e);
      res.status(500).json({ ok: false, error: 'تعذر إتمام الاقتران. حاول مرة أخرى.' });
    }
  });

  /**
   * POST /api/print/station/:stationId/unpair
   * الطلب: { clientToken } (نفس الرمز الحالي المخزَّن على هذا الجهاز)
   *
   * (2.5، seen-comprehensive-review-fixes-task.md): زر "إلغاء الإقران" كان
   * يمسح فقط التخزين المحلي على هذا الجهاز -- client_token يبقى صالحاً في
   * قاعدة البيانات إلى الأبد، فأي جهاز آخر (أو نسخة مسروقة من الرمز) يبقى
   * قادراً على إرسال مهام طباعة لنفس المحطة. هذا المسار يُبطل client_token
   * (ويولّد pair_code جديداً أيضاً، لمنع إعادة استخدام رمز الاقتران القديم)
   * فعلياً في قاعدة البيانات، فتفقد كل الأجهزة المقترنة سابقاً صلاحيتها فوراً
   * ويحتاج أي جهاز (بما فيه هذا الجهاز) اقتراناً جديداً بالرمز الجديد.
   */
  app.post('/api/print/station/:stationId/unpair', async (req: Request, res: Response) => {
    try {
      const station = await fetchStationById(String(req.params.stationId || ''));
      const token = String((req.body || {}).clientToken || req.headers['x-seen-client-token'] || '');

      if (!station || !safeEqual(token, station.client_token)) {
        return res.status(404).json({ ok: false, error: 'محطة غير معروفة أو رمز غير صحيح.' });
      }

      let newPairCode = '';
      for (let attempt = 0; attempt < 5; attempt++) {
        newPairCode = randomPairCode();
        const { error } = await supabaseAdmin
          .from('print_stations')
          .update({ client_token: newToken(), pair_code: newPairCode })
          .eq('id', station.id);
        if (!error) break;
        if (attempt === 4) throw error;
      }

      res.json({ ok: true });
    } catch (e: any) {
      console.error('[print-relay] /unpair:', e?.message || e);
      res.status(500).json({ ok: false, error: 'تعذر إلغاء الاقتران. حاول مرة أخرى.' });
    }
  });

  /**
   * GET /api/print/station/:stationId?clientToken=...
   * حالة المحطة وقائمة طابعاتها — للعرض في إعدادات الطابعة.
   */
  app.get('/api/print/station/:stationId', async (req: Request, res: Response) => {
    try {
      const station = await fetchStationById(String(req.params.stationId || ''));
      const token = String(req.query.clientToken || req.headers['x-seen-client-token'] || '');

      if (!station || !safeEqual(token, station.client_token)) {
        return res.status(404).json({
          ok: false,
          error: 'المحطة غير معروفة للسيرفر. أعد الاقتران بالرمز الظاهر في نافذة الوسيط.',
        });
      }

      res.json({ ok: true, station: await publicStation(station) });
    } catch (e: any) {
      console.error('[print-relay] /station/:id:', e?.message || e);
      res.status(500).json({ ok: false, error: 'تعذر قراءة حالة المحطة.' });
    }
  });

  /**
   * POST /api/print/job
   * الطلب: {
   *   stationId, clientToken,
   *   target: 'spooler' | 'tcp',
   *   printer?, host?, port?,
   *   dataBase64, docName?, copies?
   * }
   * الرد : { ok, jobId }
   *
   * يُرجع فوراً بعد إضافة المهمة للطابور. المتصفح يتابع الحالة عبر
   * GET /api/print/job/:jobId — فلا تتعلق واجهة الكاشير في الانتظار.
   */
  app.post('/api/print/job', async (req: Request, res: Response) => {
    try {
      const body = req.body || {};
      const station = await fetchStationById(String(body.stationId || ''));

      if (!station || !safeEqual(body.clientToken, station.client_token)) {
        return res.status(404).json({
          ok: false,
          error: 'المحطة غير معروفة أو انتهت صلاحية الاقتران. أعد الاقتران من إعدادات الطابعة.',
        });
      }

      if (!isOnline(station)) {
        return res.status(503).json({
          ok: false,
          error: `وسيط الطباعة على "${station.hostname}" غير متصل حالياً. تأكد أن نافذة الوسيط مفتوحة على جهاز الكاشير وأن الجهاز متصل بالإنترنت.`,
        });
      }

      const queued = await queuedCountFor(station.id);
      if (queued >= CONFIG.maxQueuePerStation) {
        return res.status(429).json({
          ok: false,
          error: 'طابور الطباعة ممتلئ. تحقّق من الطابعة (ورق/غطاء) ثم أعد المحاولة.',
        });
      }

      const dataBase64 = String(body.dataBase64 || '');
      if (!dataBase64) {
        return res.status(400).json({ ok: false, error: 'لا توجد بيانات للطباعة.' });
      }
      if (dataBase64.length > CONFIG.maxJobBytes) {
        return res.status(413).json({
          ok: false,
          error: 'حجم الفاتورة كبير جداً للطباعة. قلّل عدد الأصناف أو اختر حجم ورق أصغر.',
        });
      }

      const target: PrintTargetKind = body.target === 'tcp' ? 'tcp' : 'spooler';

      if (target === 'spooler' && !String(body.printer || '').trim()) {
        return res.status(400).json({ ok: false, error: 'لم يتم تحديد اسم الطابعة.' });
      }
      if (target === 'tcp' && !isPrivateHost(body.host)) {
        return res.status(400).json({
          ok: false,
          error: 'عنوان طابعة الشبكة غير صالح. يُسمح فقط بعناوين الشبكة المحلية (مثل 192.168.1.50).',
        });
      }

      const jobId = newId();
      const { error } = await supabaseAdmin.from('print_jobs').insert({
        id: jobId,
        station_id: station.id,
        target,
        printer: target === 'spooler' ? String(body.printer).trim().slice(0, 200) : null,
        host: target === 'tcp' ? String(body.host).trim() : null,
        port: target === 'tcp' ? Number(body.port) || 9100 : null,
        data_base64: dataBase64,
        doc_name: String(body.docName || 'SEEN POS Receipt').slice(0, 120),
        copies: Math.min(Math.max(1, Number(body.copies) || 1), 5),
        status: 'queued',
      });
      if (error) throw error;

      res.json({ ok: true, jobId });
    } catch (e: any) {
      console.error('[print-relay] /job:', e?.message || e);
      res.status(500).json({ ok: false, error: 'تعذرت إضافة مهمة الطباعة.' });
    }
  });

  /**
   * GET /api/print/job/:jobId?clientToken=...
   * متابعة حالة المهمة من المتصفح.
   */
  app.get('/api/print/job/:jobId', async (req: Request, res: Response) => {
    try {
      const { data: job } = await supabaseAdmin
        .from('print_jobs')
        .select('*')
        .eq('id', String(req.params.jobId || ''))
        .maybeSingle();

      if (!job) {
        return res.status(404).json({ ok: false, error: 'المهمة غير موجودة أو انتهت مدة الاحتفاظ بها.' });
      }

      const station = await fetchStationById((job as JobRow).station_id);
      const token = String(req.query.clientToken || req.headers['x-seen-client-token'] || '');
      if (!station || !safeEqual(token, station.client_token)) {
        return res.status(403).json({ ok: false, error: 'غير مصرّح بقراءة حالة هذه المهمة.' });
      }

      const j = rowToJob(job as JobRow);
      res.json({
        ok: true,
        job: {
          id: j.id,
          status: j.status,
          error: j.error,
          bytes: j.bytes,
          createdAt: j.createdAt,
          updatedAt: j.updatedAt,
        },
      });
    } catch (e: any) {
      console.error('[print-relay] /job/:id:', e?.message || e);
      res.status(500).json({ ok: false, error: 'تعذرت قراءة حالة المهمة.' });
    }
  });

  /* ======================================================================
     3) الطباعة المباشرة على طابعة شبكة من السيرفر
     ----------------------------------------------------------------------
     مسار متوافق مع الإصدار السابق. يعمل فقط عند تشغيل السيرفر داخل
     شبكة المتجر. نُبقيه لأنه أسرع مسار متاح في التشغيل المحلي.
     ====================================================================== */

  // Printer-only port range for the direct-TCP fallback below — these two
  // routes open a raw socket to a caller-supplied private-network host/port
  // with no print-relay pairing (that's the point: they're the "no relay
  // agent installed, server itself is on the store's LAN" fallback), so they
  // never had ANY authentication at all. Since the actual caller is always
  // this app's own POS frontend, gate them behind the same `authenticate`
  // middleware every other tenant-data route uses, rather than the
  // relay-specific station/clientToken pairing (which legitimately doesn't
  // exist yet for a station using this direct-TCP fallback).
  const ALLOWED_RAW_PORTS = new Set([9100, 9101, 9102, 9103, 515, 631]);

  app.post('/api/print/raw', authenticate, async (req: Request, res: Response) => {
    try {
      const { host, port, dataBase64 } = req.body || {};

      if (!isPrivateHost(host)) {
        return res.status(400).json({
          ok: false,
          error: 'عنوان IP غير صالح. يُسمح فقط بعناوين الشبكة المحلية (مثل 192.168.x.x).',
        });
      }
      if (!dataBase64 || typeof dataBase64 !== 'string') {
        return res.status(400).json({ ok: false, error: 'لا توجد بيانات للطباعة.' });
      }

      const tcpPort = Number(port) || 9100;
      if (!ALLOWED_RAW_PORTS.has(tcpPort)) {
        return res.status(400).json({ ok: false, error: 'رقم المنفذ غير صالح.' });
      }

      const buffer = Buffer.from(dataBase64, 'base64');
      if (!buffer.length) {
        return res.status(400).json({ ok: false, error: 'بيانات الطباعة فارغة.' });
      }

      await sendRawToTcpPrinter(String(host).trim(), tcpPort, buffer);
      res.json({ ok: true, bytes: buffer.length });
    } catch (err: any) {
      console.error('[print/raw]', err?.message || err);
      res.status(502).json({ ok: false, error: err?.message || 'فشل إرسال البيانات للطابعة.' });
    }
  });

  app.post('/api/print/probe', authenticate, (req: Request, res: Response) => {
    const { host, port } = req.body || {};

    if (!isPrivateHost(host)) {
      return res.status(400).json({
        ok: false,
        error: 'عنوان IP غير صالح. يُسمح فقط بعناوين الشبكة المحلية (مثل 192.168.x.x).',
      });
    }

    const tcpPort = Number(port) || 9100;
    if (!ALLOWED_RAW_PORTS.has(tcpPort)) {
      return res.status(400).json({ ok: false, error: 'رقم المنفذ غير صالح.' });
    }
    const socket = new net.Socket();
    let settled = false;

    const finish = (ok: boolean, error?: string) => {
      if (settled) return;
      settled = true;
      try {
        socket.destroy();
      } catch {
        /* تجاهل */
      }
      ok ? res.json({ ok: true }) : res.status(502).json({ ok: false, error });
    };

    socket.setTimeout(4000);
    socket.once('timeout', () =>
      finish(false, `لم تستجب الطابعة على ${host}:${tcpPort} خلال 4 ثوانٍ.`)
    );
    socket.once('error', (e: NodeJS.ErrnoException) =>
      finish(false, `تعذر الاتصال بـ ${host}:${tcpPort} (${e.code || e.message}).`)
    );
    socket.connect(tcpPort, String(host).trim(), () => finish(true));
  });

  console.log('[print-relay] وسيط الطباعة السحابي جاهز على /api/print/*');
}
