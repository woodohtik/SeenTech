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
 *  بهذا السيرفر ويظل ينتظر مهام الطباعة (long-poll). المتصفح — على أي
 *  جهاز، ويندوز أو أندرويد أو آيباد — يرسل المهمة إلى السيرفر فقط.
 *
 *      [متصفح أي جهاز]  ──POST──►  [السيرفر]  ◄──long-poll──  [وسيط الكاشير]
 *                                                                    │
 *                                                                    ▼
 *                                                        سبولر ويندوز / TCP 9100
 *
 *  لا يوجد أي اتصال بـ localhost ⇒ لا mixed content، لا CORS، لا
 *  Local Network Access، ولا حاجة لفتح أي منفذ في جدار الحماية.
 *
 *  ملاحظة نشر مهمة
 *  ----------------
 *  المخزن هنا في الذاكرة (Map)، وهو مناسب لسيرفر Express واحد طويل العمر
 *  (وهو نمط تشغيل هذا المشروع: `npm start` ← app.listen).
 *  إذا نُشر النظام على بيئة serverless متعددة النسخ (Vercel Functions مثلاً)
 *  فيجب استبدال `store` بجدول في Supabase — الواجهة معزولة لهذا الغرض.
 * ============================================================================
 */

import type { Express, Request, Response } from 'express';
import crypto from 'crypto';
import net from 'net';
import { authenticate } from './middleware/authMiddleware.ts';

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

interface Station {
  id: string;
  agentToken: string;
  clientToken: string;
  pairCode: string;
  hostname: string;
  platform: string;
  agentVersion: string;
  printers: RelayPrinter[];
  lastSeenAt: number;
  createdAt: number;
  /** المهام المنتظرة بالترتيب */
  queue: PrintJob[];
  /** المستمعون المعلّقون (long-poll) في انتظار مهمة */
  waiters: Array<(job: PrintJob | null) => void>;
}

/* ============================ الإعدادات ============================ */

const CONFIG = {
  /** بعد هذه المدة بدون أي اتصال تُعتبر المحطة غير متصلة */
  offlineAfterMs: 45_000,
  /** أقصى مدة يبقى فيها طلب long-poll معلّقاً قبل إرجاع 204 */
  maxPollWaitMs: 25_000,
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
};

/* ============================ المخزن ============================ */

const stations = new Map<string, Station>();
const jobs = new Map<string, PrintJob>();
/** ربط رمز الاقتران بمعرّف المحطة — رموز قصيرة يقرأها المستخدم */
const pairCodeIndex = new Map<string, string>();
/** عدّاد محاولات الاقتران لمكافحة التخمين */
const pairAttempts = new Map<string, { count: number; resetAt: number }>();

/* ============================ أدوات ============================ */

const nowMs = () => Date.now();

const newId = () => crypto.randomBytes(16).toString('hex');
const newToken = () => crypto.randomBytes(32).toString('base64url');

/**
 * رمز اقتران من 6 أحرف بأبجدية بلا حروف متشابهة (لا 0/O ولا 1/I/L)
 * حتى لا يخطئ المستخدم في قراءته عن الشاشة.
 */
const PAIR_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const newPairCode = (): string => {
  for (let attempt = 0; attempt < 50; attempt++) {
    let code = '';
    const bytes = crypto.randomBytes(6);
    for (let i = 0; i < 6; i++) code += PAIR_ALPHABET[bytes[i] % PAIR_ALPHABET.length];
    if (!pairCodeIndex.has(code)) return code;
  }
  // احتمال بعيد جداً — نضيف عشوائية إضافية
  return crypto.randomBytes(4).toString('hex').toUpperCase();
};

/** مقارنة رموز بزمن ثابت — تمنع استنتاج الرمز من فروق التوقيت. */
const safeEqual = (a: unknown, b: unknown): boolean => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
};

const isOnline = (s: Station) => nowMs() - s.lastSeenAt < CONFIG.offlineAfterMs;

const clientIp = (req: Request): string =>
  String(
    (req.headers['x-forwarded-for'] as string || '').split(',')[0].trim() ||
      req.socket.remoteAddress ||
      'unknown'
  );

const bearer = (req: Request): string => {
  const h = String(req.headers.authorization || '');
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : String(req.headers['x-seen-agent-token'] || '');
};

/** إخراج آمن لبيانات المحطة — بدون أي رموز سرية. */
const publicStation = (s: Station) => ({
  stationId: s.id,
  hostname: s.hostname,
  platform: s.platform,
  agentVersion: s.agentVersion,
  online: isOnline(s),
  lastSeenAt: s.lastSeenAt,
  printers: s.printers,
  queued: s.queue.length,
});

/* ==================== تنظيف دوري للذاكرة ==================== */

let sweeper: NodeJS.Timeout | null = null;

const sweep = () => {
  const t = nowMs();

  // حذف المهام المنتهية القديمة
  for (const [id, job] of jobs) {
    const finished = job.status === 'done' || job.status === 'failed';
    if (finished && t - job.updatedAt > CONFIG.jobRetentionMs) jobs.delete(id);
    // مهمة عُلِّقت في "sent" لأكثر من دقيقتين → الوسيط سقط أثناء الطباعة
    if (job.status === 'sent' && t - job.updatedAt > 120_000) {
      job.status = 'failed';
      job.error = 'انقطع الاتصال بوسيط الطباعة قبل تأكيد الطباعة.';
      job.updatedAt = t;
    }
  }

  // حذف المحطات المهجورة
  for (const [id, s] of stations) {
    if (t - s.lastSeenAt > CONFIG.stationTtlMs) {
      pairCodeIndex.delete(s.pairCode);
      stations.delete(id);
    }
  }

  // تصفير عدّادات الاقتران
  for (const [ip, rec] of pairAttempts) {
    if (t > rec.resetAt) pairAttempts.delete(ip);
  }
};

/* ==================== توزيع المهام على المستمعين ==================== */

/**
 * تسليم المهمة التالية لأول مستمع معلّق إن وُجد.
 * إن لم يوجد مستمع تبقى المهمة في الطابور حتى يعود الوسيط.
 */
const dispatch = (station: Station) => {
  while (station.waiters.length && station.queue.length) {
    const waiter = station.waiters.shift()!;
    const job = station.queue.shift()!;
    job.status = 'sent';
    job.updatedAt = nowMs();
    waiter(job);
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
    sweeper = setInterval(sweep, 30_000);
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
  app.post('/api/print/agent/hello', (req: Request, res: Response) => {
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
    const existing = wantedId ? stations.get(wantedId) : undefined;

    // استئناف محطة قائمة — يشترط رمز الوسيط الصحيح
    if (existing && safeEqual(body.agentToken, existing.agentToken)) {
      existing.hostname = hostname;
      existing.platform = platform;
      existing.agentVersion = agentVersion;
      existing.printers = printers;
      existing.lastSeenAt = nowMs();

      return res.json({
        ok: true,
        stationId: existing.id,
        agentToken: existing.agentToken,
        clientToken: existing.clientToken,
        pairCode: existing.pairCode,
        pollWaitMs: CONFIG.maxPollWaitMs,
        resumed: true,
      });
    }

    // محطة جديدة
    const station: Station = {
      id: newId(),
      agentToken: newToken(),
      clientToken: newToken(),
      pairCode: newPairCode(),
      hostname,
      platform,
      agentVersion,
      printers,
      lastSeenAt: nowMs(),
      createdAt: nowMs(),
      queue: [],
      waiters: [],
    };

    stations.set(station.id, station);
    pairCodeIndex.set(station.pairCode, station.id);

    console.log(
      `[print-relay] محطة جديدة "${hostname}" (${platform}) — رمز الاقتران ${station.pairCode} — ${printers.length} طابعة`
    );

    res.json({
      ok: true,
      stationId: station.id,
      agentToken: station.agentToken,
      clientToken: station.clientToken,
      pairCode: station.pairCode,
      pollWaitMs: CONFIG.maxPollWaitMs,
      resumed: false,
    });
  });

  /**
   * GET /api/print/agent/poll?stationId=...
   * Authorization: Bearer <agentToken>
   *
   * يبقى الطلب معلّقاً حتى تصل مهمة (200 + المهمة) أو تنتهي المهلة (204).
   * هذا الطلب هو أيضاً نبضة الحياة التي تُبقي المحطة «متصلة».
   */
  app.get('/api/print/agent/poll', (req: Request, res: Response) => {
    const stationId = String(req.query.stationId || '');
    const station = stations.get(stationId);

    if (!station || !safeEqual(bearer(req), station.agentToken)) {
      // 409 وليس 401: نُشير للوسيط أن عليه إعادة التسجيل من الصفر
      return res.status(409).json({ ok: false, error: 'المحطة غير مسجّلة. أعد التسجيل عبر /hello.' });
    }

    station.lastSeenAt = nowMs();

    // مهمة جاهزة الآن؟ سلّمها فوراً
    if (station.queue.length) {
      const job = station.queue.shift()!;
      job.status = 'sent';
      job.updatedAt = nowMs();
      return res.json({ ok: true, job });
    }

    // لا شيء الآن → نُعلّق الطلب
    let settled = false;

    const finish = (job: PrintJob | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const idx = station.waiters.indexOf(finish);
      if (idx >= 0) station.waiters.splice(idx, 1);
      if (job) res.json({ ok: true, job });
      else res.status(204).end();
    };

    const timer = setTimeout(() => finish(null), CONFIG.maxPollWaitMs);
    if (typeof timer.unref === 'function') timer.unref();

    station.waiters.push(finish);

    // إن قطع الوسيط الاتصال (إغلاق النافذة/انقطاع الشبكة) نُزيله من القائمة
    req.on('close', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      const idx = station.waiters.indexOf(finish);
      if (idx >= 0) station.waiters.splice(idx, 1);
    });
  });

  /**
   * POST /api/print/agent/result
   * Authorization: Bearer <agentToken>
   * الطلب: { stationId, jobId, ok, error?, bytes? }
   */
  app.post('/api/print/agent/result', (req: Request, res: Response) => {
    const body = req.body || {};
    const station = stations.get(String(body.stationId || ''));

    if (!station || !safeEqual(bearer(req), station.agentToken)) {
      return res.status(409).json({ ok: false, error: 'المحطة غير مسجّلة.' });
    }

    station.lastSeenAt = nowMs();

    const job = jobs.get(String(body.jobId || ''));
    if (!job || job.stationId !== station.id) {
      return res.status(404).json({ ok: false, error: 'المهمة غير موجودة.' });
    }

    job.status = body.ok ? 'done' : 'failed';
    job.error = body.ok ? undefined : String(body.error || 'فشل غير محدد في الوسيط.').slice(0, 600);
    job.bytes = Number(body.bytes) || job.bytes;
    job.updatedAt = nowMs();

    if (!body.ok) console.warn(`[print-relay] فشلت المهمة ${job.id}: ${job.error}`);

    res.json({ ok: true });
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
  app.post('/api/print/pair', (req: Request, res: Response) => {
    const ip = clientIp(req);
    const t = nowMs();
    const rec = pairAttempts.get(ip);

    if (rec && t < rec.resetAt && rec.count >= CONFIG.pairAttemptsPerMinute) {
      return res.status(429).json({
        ok: false,
        error: 'محاولات كثيرة جداً. انتظر دقيقة ثم أعد المحاولة.',
      });
    }

    const code = String((req.body || {}).pairCode || '')
      .toUpperCase()
      .replace(/[^0-9A-Z]/g, '');

    const stationId = pairCodeIndex.get(code);
    const station = stationId ? stations.get(stationId) : undefined;

    if (!station) {
      const next = rec && t < rec.resetAt ? { count: rec.count + 1, resetAt: rec.resetAt } : { count: 1, resetAt: t + 60_000 };
      pairAttempts.set(ip, next);
      return res.status(404).json({
        ok: false,
        error: 'رمز اقتران غير صحيح، أو أن وسيط الطباعة غير مُشغَّل. تأكد من الرمز الظاهر في نافذة الوسيط.',
      });
    }

    pairAttempts.delete(ip);

    res.json({
      ok: true,
      stationId: station.id,
      clientToken: station.clientToken,
      station: publicStation(station),
    });
  });

  /**
   * GET /api/print/station/:stationId?clientToken=...
   * حالة المحطة وقائمة طابعاتها — للعرض في إعدادات الطابعة.
   */
  app.get('/api/print/station/:stationId', (req: Request, res: Response) => {
    const station = stations.get(String(req.params.stationId || ''));
    const token = String(req.query.clientToken || req.headers['x-seen-client-token'] || '');

    if (!station || !safeEqual(token, station.clientToken)) {
      return res.status(404).json({
        ok: false,
        error: 'المحطة غير معروفة للسيرفر. أعد الاقتران بالرمز الظاهر في نافذة الوسيط.',
      });
    }

    res.json({ ok: true, station: publicStation(station) });
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
  app.post('/api/print/job', (req: Request, res: Response) => {
    const body = req.body || {};
    const station = stations.get(String(body.stationId || ''));

    if (!station || !safeEqual(body.clientToken, station.clientToken)) {
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

    if (station.queue.length >= CONFIG.maxQueuePerStation) {
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

    const job: PrintJob = {
      id: newId(),
      stationId: station.id,
      target,
      printer: target === 'spooler' ? String(body.printer).trim().slice(0, 200) : undefined,
      host: target === 'tcp' ? String(body.host).trim() : undefined,
      port: target === 'tcp' ? Number(body.port) || 9100 : undefined,
      dataBase64,
      docName: String(body.docName || 'SEEN POS Receipt').slice(0, 120),
      copies: Math.min(Math.max(1, Number(body.copies) || 1), 5),
      status: 'queued',
      createdAt: nowMs(),
      updatedAt: nowMs(),
    };

    jobs.set(job.id, job);
    station.queue.push(job);
    dispatch(station);

    res.json({ ok: true, jobId: job.id });
  });

  /**
   * GET /api/print/job/:jobId?clientToken=...
   * متابعة حالة المهمة من المتصفح.
   */
  app.get('/api/print/job/:jobId', (req: Request, res: Response) => {
    const job = jobs.get(String(req.params.jobId || ''));
    if (!job) {
      return res.status(404).json({ ok: false, error: 'المهمة غير موجودة أو انتهت مدة الاحتفاظ بها.' });
    }

    const station = stations.get(job.stationId);
    const token = String(req.query.clientToken || req.headers['x-seen-client-token'] || '');
    if (!station || !safeEqual(token, station.clientToken)) {
      return res.status(403).json({ ok: false, error: 'غير مصرّح بقراءة حالة هذه المهمة.' });
    }

    res.json({
      ok: true,
      job: {
        id: job.id,
        status: job.status,
        error: job.error,
        bytes: job.bytes,
        createdAt: job.createdAt,
        updatedAt: job.updatedAt,
      },
    });
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
