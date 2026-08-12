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

import i18n from 'i18next';

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
const FABRIC_COMPOSITION_LABEL_KEYS: Record<FabricComposition, string> = {
  cotton: 'inventory.fabric_composition.cotton',
  polyester: 'inventory.fabric_composition.polyester',
  cotton_poly_blend: 'inventory.fabric_composition.cotton_poly_blend',
  wool: 'inventory.fabric_composition.wool',
  linen: 'inventory.fabric_composition.linen',
  silk: 'inventory.fabric_composition.silk',
  viscose: 'inventory.fabric_composition.viscose',
  nylon: 'inventory.fabric_composition.nylon',
  other: 'common.other',
};

const FABRIC_PATTERN_LABEL_KEYS: Record<FabricPattern, string> = {
  solid: 'inventory.chest_plain',
  striped: 'inventory.fabric_pattern.striped',
  checked: 'inventory.fabric_pattern.checked',
  patterned: 'inventory.fabric_pattern.patterned',
  jacquard: 'inventory.fabric_pattern.jacquard',
};

const FABRIC_SEASON_LABEL_KEYS: Record<FabricSeason, string> = {
  summer: 'inventory.fabric_season.summer',
  winter: 'inventory.fabric_season.winter',
  all_season: 'inventory.fabric_season.all_season',
};

export const FABRIC_COMPOSITION_VALUES = Object.keys(FABRIC_COMPOSITION_LABEL_KEYS) as FabricComposition[];
export const FABRIC_PATTERN_VALUES = Object.keys(FABRIC_PATTERN_LABEL_KEYS) as FabricPattern[];
export const FABRIC_SEASON_VALUES = Object.keys(FABRIC_SEASON_LABEL_KEYS) as FabricSeason[];

export const getFabricCompositionOptions = (): { value: FabricComposition; label: string }[] =>
  FABRIC_COMPOSITION_VALUES.map(value => ({ value, label: i18n.t(FABRIC_COMPOSITION_LABEL_KEYS[value]) }));

export const getFabricPatternOptions = (): { value: FabricPattern; label: string }[] =>
  FABRIC_PATTERN_VALUES.map(value => ({ value, label: i18n.t(FABRIC_PATTERN_LABEL_KEYS[value]) }));

export const getFabricSeasonOptions = (): { value: FabricSeason; label: string }[] =>
  FABRIC_SEASON_VALUES.map(value => ({ value, label: i18n.t(FABRIC_SEASON_LABEL_KEYS[value]) }));

/** تطبيع للبحث/المطابقة في السوق المستقبلي. */
export function fabricSearchKey(f: FabricAttributes): string {
  return [f.composition, f.color, f.pattern, f.season].filter(Boolean).join('|').toLowerCase();
}
