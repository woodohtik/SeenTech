/**
 * fabricAttributes — التقاط بيانات الأقمشة بشكل منظّم (يؤسّس لسوق الأقمشة لاحقاً)
 * ---------------------------------------------------------------------------
 * بدل ترك القماش حقلاً نصياً حراً، نلتقط سماته بشكل موحّد من اليوم. هكذا نجمع
 * داتا نظيفة تُشغّل «سوق الأقمشة» (الطبقة 3) لاحقاً بلا بداية صفرية.
 *
 * التوصيل (آمن، اختياري):
 *   1) في InventoryItem أضف حقلاً اختيارياً:  fabricAttributes?: FabricAttributes;
 *   2) في جدول inventory (Supabase) أضف عموداً jsonb:
 *        ALTER TABLE inventory ADD COLUMN fabric_attributes jsonb;
 *   3) في نموذج صنف المخزون (عند category === 'fabric') اعرض الحقول أدناه.
 */

export interface FabricAttributes {
  composition?: FabricComposition;  // التركيب
  color?: string;                   // اللون (نص حر أو من palette)
  colorCode?: string;               // كود اللون (للمطابقة الدقيقة)
  widthCm?: number;                 // عرض الطاقة (سم)
  weightGsm?: number;               // الوزن (غرام/م²)
  pattern?: FabricPattern;          // النقشة
  season?: FabricSeason;            // الموسم
  origin?: string;                  // بلد المنشأ
  supplierSku?: string;             // SKU لدى المورّد (لإعادة الطلب الآلي)
}

export type FabricComposition =
  | 'cotton' | 'polyester' | 'cotton_poly_blend' | 'wool' | 'linen'
  | 'silk' | 'viscose' | 'nylon' | 'other';

export type FabricPattern =
  | 'solid' | 'striped' | 'checked' | 'patterned' | 'jacquard';

export type FabricSeason = 'summer' | 'winter' | 'all_season';

/** خيارات جاهزة للقوائم المنسدلة في النموذج (عربي/قيمة). */
export const FABRIC_COMPOSITION_OPTIONS: { value: FabricComposition; label: string }[] = [
  { value: 'cotton', label: 'قطن' },
  { value: 'polyester', label: 'بوليستر' },
  { value: 'cotton_poly_blend', label: 'مخلوط قطن/بوليستر' },
  { value: 'wool', label: 'صوف' },
  { value: 'linen', label: 'كتّان' },
  { value: 'silk', label: 'حرير' },
  { value: 'viscose', label: 'فيسكوز' },
  { value: 'nylon', label: 'نايلون' },
  { value: 'other', label: 'أخرى' },
];

export const FABRIC_PATTERN_OPTIONS: { value: FabricPattern; label: string }[] = [
  { value: 'solid', label: 'سادة' },
  { value: 'striped', label: 'مخطّط' },
  { value: 'checked', label: 'كاروهات' },
  { value: 'patterned', label: 'منقوش' },
  { value: 'jacquard', label: 'جاكارد' },
];

export const FABRIC_SEASON_OPTIONS: { value: FabricSeason; label: string }[] = [
  { value: 'summer', label: 'صيفي' },
  { value: 'winter', label: 'شتوي' },
  { value: 'all_season', label: 'لكل المواسم' },
];

/** تطبيع للبحث/المطابقة في السوق المستقبلي. */
export function fabricSearchKey(f: FabricAttributes): string {
  return [f.composition, f.color, f.pattern, f.season].filter(Boolean).join('|').toLowerCase();
}
