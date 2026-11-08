/**
 * CustomerMeasurementsForm — فورم مقاسات عام للعميل (عامة، مبرندة بعلامة «سين»)
 * ---------------------------------------------------------------------------
 * رابط دائم يرسله المحل للعميل (واتساب) ليملأ/يعدّل مقاساته بنفسه، بلا
 * تسجيل دخول وبلا حساب. الحفظ فوري ومباشر -- لا طابور مراجعة.
 *
 * الأمان: لا تستعلم عن جدول customers مباشرة، ولا تستدعي Supabase من
 * المتصفح إطلاقاً. تجلب/تحفظ البيانات عبر GET/POST
 * /api/public/measurements/:token في server.ts (supabaseAdmin يختار
 * الحقول المسموحة فقط) عبر رمز عشوائي غير قابل للتخمين
 * (customers.measurements_token)، بنفس نمط /track/:token تماماً. التفاصيل
 * الكاملة في docs/superpowers/specs/2026-11-08-customer-measurements-public-form-design.md.
 *
 * الواجهة تعيد استخدام VisualMeasurements وThobeMeasurementSelector كما هما
 * -- نفس الفورم الذي يستخدمه الموظف عند تعديل عميل، بلا أي تعديل على
 * المكوّنين.
 */

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { XCircle } from 'lucide-react';
import { useDirection } from '../../lib/direction';
import { apiUrl } from '../../lib/apiBase';
import { customerColors, customerFont, customerRadius } from '../../lib/customerAppTheme';
import { BrandingContext } from '../../contexts/BrandingContext';
import type { Measurements } from '../../types';
import type { MeasurementUnit } from '../../utils/measurementUnits';
import VisualMeasurements from '../VisualMeasurements';
import ThobeMeasurementSelector from '../ThobeMeasurementSelector';

interface MeasurementsFormResponse {
  customer_name: string;
  shop_name: string;
  shop_logo_url: string | null;
  measurement_unit: MeasurementUnit;
  measurements: Measurements;
}

// ThobeMeasurementSelector (reused unchanged, per spec) renders a <Branding>
// badge internally, which calls useBranding() and throws without a
// BrandingContext.Provider ancestor. The real BrandingProvider makes a live
// Supabase call + opens a realtime channel from the browser -- exactly what
// this public, unauthenticated page must never do. This static value lets
// the badge render (it only shows a hardcoded "Seen" wordmark regardless of
// the value, see Branding.tsx) without touching Supabase at all.
const STATIC_BRANDING = { settings: { websiteUrl: '#', companyName: 'Seen' }, loading: false };

function LoadingSkeleton() {
  return (
    <div style={styles.skeletonWrap}>
      <div className="seen-skeleton" style={{ ...styles.skeletonBlock, width: 64, height: 64, borderRadius: customerRadius.card, margin: '0 auto 12px' }} />
      <div className="seen-skeleton" style={{ ...styles.skeletonBlock, width: '60%', height: 20, margin: '0 auto 8px' }} />
      <div className="seen-skeleton" style={{ ...styles.skeletonBlock, width: '40%', height: 14, margin: '0 auto 24px' }} />
      <div className="seen-skeleton" style={{ ...styles.skeletonBlock, width: '100%', height: 200 }} />
    </div>
  );
}

export default function CustomerMeasurementsForm({ token }: { token: string }) {
  const { t } = useTranslation();
  const { dir } = useDirection();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [shopName, setShopName] = useState('');
  const [shopLogoUrl, setShopLogoUrl] = useState<string | null>(null);
  const [measurementUnit, setMeasurementUnit] = useState<MeasurementUnit>('inch');
  const [measurements, setMeasurements] = useState<Measurements>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(apiUrl(`/api/public/measurements/${token}`));
        if (!alive) return;
        if (response.status === 429) {
          setError(t('public_measurements.rate_limited'));
        } else if (!response.ok) {
          setError(t('public_measurements.not_found'));
        } else {
          const data = (await response.json()) as MeasurementsFormResponse;
          setCustomerName(data.customer_name);
          setShopName(data.shop_name);
          setShopLogoUrl(data.shop_logo_url);
          setMeasurementUnit(data.measurement_unit);
          setMeasurements(data.measurements || {});
        }
      } catch {
        if (alive) setError(t('public_measurements.load_failed'));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [token, t]);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      const response = await fetch(apiUrl(`/api/public/measurements/${token}`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ measurements }),
      });
      if (response.status === 429) {
        setSaveError(t('public_measurements.rate_limited'));
      } else if (!response.ok) {
        setSaveError(t('public_measurements.save_failed'));
      } else {
        setSaved(true);
      }
    } catch {
      setSaveError(t('public_measurements.save_failed'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <BrandingContext.Provider value={STATIC_BRANDING}>
    {/* VisualMeasurements goes to 4 columns at the sm: breakpoint (640px) and
        ThobeMeasurementSelector switches to a 350px-fixed-column side-by-side
        layout at lg: (1024px) -- both react to the VIEWPORT, not this card's
        own width. A fixed narrow card (fine on a phone, where the viewport
        itself is narrow anyway) left both squeezed into far less room than
        either component expects on an actual desktop screen. */}
    <style>{`
      .seen-measurements-card { max-width: 520px; }
      @media (min-width: 640px) { .seen-measurements-card { max-width: 720px; } }
      @media (min-width: 1024px) { .seen-measurements-card { max-width: 960px; } }
    `}</style>
    <div dir={dir} style={styles.page}>
      <div className="seen-measurements-card" style={styles.card}>
        <div style={styles.brand}>
          <span style={styles.brandMark}>{t('public_tracking.brand_mark')}</span>
          <span style={styles.brandSub}>{t('public_measurements.title')}</span>
        </div>

        {loading && <LoadingSkeleton />}

        {error && !loading && (
          <div style={styles.errorBox}>
            <XCircle size={32} color={customerColors.dangerText} />
            <p style={styles.error}>{error}</p>
          </div>
        )}

        {!loading && !error && (
          <>
            {shopLogoUrl ? (
              <img src={shopLogoUrl} alt={shopName} style={styles.logo} />
            ) : null}
            <h2 style={styles.shop}>{shopName}</h2>
            <p style={styles.muted}>{customerName}</p>

            <div style={styles.formWrap}>
              <VisualMeasurements
                values={measurements}
                onChange={(field, value) => {
                  setMeasurements((m) => ({ ...m, [field]: value }));
                  setSaved(false);
                }}
              />
              <ThobeMeasurementSelector
                values={measurements}
                onChange={(next) => {
                  setMeasurements(next);
                  setSaved(false);
                }}
                measurementUnit={measurementUnit}
              />
            </div>

            {saveError && <p style={styles.error}>{saveError}</p>}

            {saved ? (
              <p style={styles.notifySuccess}>{t('public_measurements.save_success')}</p>
            ) : (
              <button style={styles.saveButton} onClick={handleSave} disabled={saving}>
                {saving ? t('public_measurements.saving') : t('public_measurements.save_button')}
              </button>
            )}
          </>
        )}

        <div style={styles.footer}>{t('public_tracking.powered_by')}</div>
      </div>
    </div>
    </BrandingContext.Provider>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: customerColors.bg, fontFamily: customerFont.body, padding: 16,
  },
  card: {
    width: '100%', background: customerColors.surface, borderRadius: customerRadius.card,
    boxShadow: customerColors.shadow, padding: 24, textAlign: 'center',
  },
  brand: { display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 16 },
  brandMark: { fontFamily: customerFont.display, fontSize: 34, fontWeight: 700, color: customerColors.navy, lineHeight: 1 },
  brandSub: { fontSize: 13, color: customerColors.accentText, marginTop: 4 },
  logo: { width: 64, height: 64, objectFit: 'contain', borderRadius: customerRadius.sm, margin: '0 auto 8px' },
  shop: { fontFamily: customerFont.display, fontSize: 18, fontWeight: 700, color: customerColors.navy, margin: '4px 0' },
  muted: { color: customerColors.textMuted, fontSize: 14, margin: '4px 0 16px' },
  errorBox: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, margin: '16px 0' },
  error: { color: customerColors.dangerText, fontSize: 15, margin: '8px 0' },
  formWrap: { textAlign: 'right', margin: '16px 0' },
  notifySuccess: { color: customerColors.successText, fontSize: 15, fontWeight: 600, margin: '16px 0' },
  saveButton: {
    width: '100%', padding: '14px 16px', borderRadius: customerRadius.sm, border: 'none',
    background: customerColors.blue, color: '#fff', fontSize: 16, fontWeight: 700, cursor: 'pointer',
    marginTop: 8,
  },
  footer: { marginTop: 20, paddingTop: 14, borderTop: `1px solid ${customerColors.border}`, color: customerColors.textMuted, fontSize: 12 },
  skeletonWrap: { padding: '4px 0' },
  skeletonBlock: { borderRadius: 6 },
};
