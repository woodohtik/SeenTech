/**
 * paymentService — طبقة دفع محايدة للبوابة (Provider-agnostic)
 * -----------------------------------------------------------
 * لا يربط الكود ببوابة معيّنة. واجهة موحّدة + adapters قابلة للتبديل
 * (Moyasar / PayMob / غيرها) عبر متغيّر بيئة واحد PAYMENT_PROVIDER.
 * البوابة بعد غير محسومة — هذا التصميم يتيح اختيارها لاحقاً بلا تغيير منطق الاشتراك.
 *
 * خادمي (يستخدم المفتاح السري). المبالغ تُمرَّر بالريال (SAR) وكل adapter يحوّلها لصيغته.
 *
 * متغيّرات البيئة (خادمية):
 *   PAYMENT_PROVIDER     'moyasar' | 'paymob'   (الافتراضي moyasar)
 *   APP_URL              لبناء callback_url
 *   MOYASAR_SECRET_KEY   (إن اخترتم Moyasar)
 *   PAYMOB_API_KEY       (إن اخترتم PayMob)
 */

export interface PaymentInput {
  tenantId: string;
  amountSar: number;        // بالريال، مثال 1800
  description: string;
  source?: any;             // token/card من نموذج البوابة بالواجهة (حسب المزوّد)
  customer?: { name?: string; phone?: string; email?: string };
}

export interface PaymentResult {
  id: string;
  status: string;           // 'initiated' | 'paid' | 'failed' | ...
  redirectUrl?: string;     // لإكمال الدفع/3DS إن لزم
  raw?: any;
}

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: PaymentInput): Promise<PaymentResult>;
  fetchPayment(paymentId: string): Promise<{ status: string; paid: boolean; raw: any }>;
  /** تحقّق توقيع الـ webhook (نفّذه لكل مزوّد قبل الإنتاج). */
  verifyWebhook?(headers: Record<string, string>, rawBody: string): boolean;
}

const env = (k: string): string =>
  (typeof process !== 'undefined' && process.env?.[k]) || '';
const appUrl = () => env('APP_URL');

// ---------- Adapter: Moyasar ----------
const moyasarProvider: PaymentProvider = {
  name: 'moyasar',
  async createPayment(input) {
    const auth = 'Basic ' + Buffer.from(`${env('MOYASAR_SECRET_KEY')}:`).toString('base64');
    const res = await fetch('https://api.moyasar.com/v1/payments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: auth },
      body: JSON.stringify({
        amount: Math.round(input.amountSar * 100), // هللات
        currency: 'SAR',
        description: input.description,
        callback_url: `${appUrl()}/api/payments/callback?tenant=${input.tenantId}`,
        source: input.source,
        metadata: { tenant_id: input.tenantId },
      }),
    });
    if (!res.ok) throw new Error(`Moyasar create failed: ${res.status} ${await res.text()}`);
    const p = await res.json();
    return { id: p.id, status: p.status, redirectUrl: p?.source?.transaction_url, raw: p };
  },
  async fetchPayment(id) {
    const auth = 'Basic ' + Buffer.from(`${env('MOYASAR_SECRET_KEY')}:`).toString('base64');
    const res = await fetch(`https://api.moyasar.com/v1/payments/${id}`, { headers: { Authorization: auth } });
    if (!res.ok) throw new Error(`Moyasar fetch failed: ${res.status}`);
    const p = await res.json();
    return { status: p.status, paid: p.status === 'paid', raw: p };
  },
  // verifyWebhook: TODO(MOYASAR) — تحقّق التوقيع وفق وثائق Moyasar.
};

// ---------- Adapter: PayMob (stub) ----------
const paymobProvider: PaymentProvider = {
  name: 'paymob',
  async createPayment(_input) {
    // TODO(PAYMOB): تدفّق PayMob = auth token -> order -> payment key -> iframe/redirect.
    throw new Error('PayMob adapter not implemented yet. See PLG_FLOW_README.md.');
  },
  async fetchPayment(_id) {
    throw new Error('PayMob adapter not implemented yet.');
  },
  // verifyWebhook: TODO(PAYMOB) — تحقّق HMAC من PayMob.
};

const PROVIDERS: Record<string, PaymentProvider> = {
  moyasar: moyasarProvider,
  paymob: paymobProvider,
};

/** يرجع المزوّد المختار من البيئة (الافتراضي moyasar). */
export function getPaymentProvider(): PaymentProvider {
  return PROVIDERS[env('PAYMENT_PROVIDER') || 'moyasar'] || moyasarProvider;
}

/**
 * منطق الاشتراك محايد للبوابة: يتحقق من الدفع ويفعّل الاشتراك عند النجاح.
 * مرّر دالة activate (مثلاً supabaseAdmin.rpc('activate_tenant_subscription')).
 */
export async function settleSubscriptionPayment(
  paymentId: string,
  tenantId: string,
  activate: (tenantId: string) => Promise<void>
): Promise<{ paid: boolean }> {
  const { paid } = await getPaymentProvider().fetchPayment(paymentId);
  if (paid) await activate(tenantId);
  return { paid };
}
