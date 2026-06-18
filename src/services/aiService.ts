/**
 * aiService — مساعد الذكاء الاصطناعي لسين (حالة الاستخدام الأولى: تدقيق أخطاء القياسات)
 * ----------------------------------------------------------------------------------
 * وحدة معزولة لا تلمس أي تدفق قائم. تجمع بين:
 *   1) فحوصات قاعدية حتمية (تعمل دائماً، بلا إنترنت ولا مفتاح) — تكتشف القيم المستحيلة
 *      والانحرافات عن السجل السابق للعميل.
 *   2) شرح/اقتراح اختياري عبر Gemini (إن توفّر GEMINI_API_KEY) — لغة طبيعية للخياط.
 *
 * الاستخدام (مثال):
 *   import { checkMeasurementAnomalies } from '../../services/aiService';
 *   const result = await checkMeasurementAnomalies(newMeasurements, previousMeasurementsList);
 *   if (result.flags.length) showWarnings(result.flags, result.aiSummary);
 *
 * ملاحظة: GEMINI_API_KEY خادمي — في الإنتاج يُفضّل استدعاء الجزء الذكي من نقطة خادم
 * بدل كشف المفتاح للواجهة. الفحوصات القاعدية آمنة في الواجهة.
 */

import type { Measurements } from '../types';

export interface MeasurementFlag {
  field: keyof Measurements | string;
  severity: 'error' | 'warning';
  message: string; // عربي، صالح للعرض المباشر
}

export interface MeasurementCheckResult {
  flags: MeasurementFlag[];
  aiSummary?: string;     // شرح اختياري من الذكاء الاصطناعي
  usedAI: boolean;
}

/** نطاقات منطقية (سم) لقياسات الثوب الرجالي الشائعة — قابلة للضبط لكل فئة. */
const SANE_RANGES: Partial<Record<keyof Measurements, [number, number]>> = {
  length: [120, 180],
  shoulder: [40, 60],
  chest: [85, 140],
  waist: [70, 140],
  hips: [80, 150],
  sleeve: [50, 70],
  neck: [33, 50],
};

/** نسبة الانحراف عن متوسط سجل العميل التي تستدعي تنبيهاً. */
const HISTORY_DEVIATION_PCT = 0.18; // 18%

/**
 * الفحوصات القاعدية الحتمية. لا تعتمد على أي خدمة خارجية.
 */
export function ruleBasedMeasurementChecks(
  current: Measurements,
  history: Measurements[] = []
): MeasurementFlag[] {
  const flags: MeasurementFlag[] = [];

  // 1) القيم خارج النطاق المنطقي
  (Object.keys(SANE_RANGES) as (keyof Measurements)[]).forEach((field) => {
    const val = current[field];
    const range = SANE_RANGES[field];
    if (typeof val === 'number' && range) {
      if (val <= 0) {
        flags.push({ field, severity: 'error', message: `قيمة «${labelOf(field)}» غير صالحة (${val}).` });
      } else if (val < range[0] || val > range[1]) {
        flags.push({
          field,
          severity: 'warning',
          message: `«${labelOf(field)}» = ${val} سم خارج النطاق المعتاد (${range[0]}–${range[1]}). تأكّد من الإدخال.`,
        });
      }
    }
  });

  // 2) علاقات منطقية (الصدر عادةً أكبر من الرقبة، الطول أكبر من الكم...)
  if (isNum(current.chest) && isNum(current.neck) && current.chest! <= current.neck!) {
    flags.push({ field: 'chest', severity: 'warning', message: 'الصدر أصغر من أو يساوي الرقبة — غالباً خطأ إدخال.' });
  }
  if (isNum(current.length) && isNum(current.sleeve) && current.sleeve! >= current.length!) {
    flags.push({ field: 'sleeve', severity: 'warning', message: 'طول الكم ≥ طول الثوب — غالباً خطأ إدخال.' });
  }

  // 3) الانحراف عن سجل العميل السابق
  if (history.length) {
    (Object.keys(SANE_RANGES) as (keyof Measurements)[]).forEach((field) => {
      const cur = current[field];
      if (!isNum(cur)) return;
      const past = history.map((h) => h[field]).filter(isNum) as number[];
      if (!past.length) return;
      const avg = past.reduce((a, b) => a + b, 0) / past.length;
      if (avg > 0 && Math.abs((cur as number) - avg) / avg > HISTORY_DEVIATION_PCT) {
        flags.push({
          field,
          severity: 'warning',
          message: `«${labelOf(field)}» = ${cur} يختلف ${Math.round((Math.abs((cur as number) - avg) / avg) * 100)}% عن متوسط هذا العميل (${avg.toFixed(0)}). تأكّد.`,
        });
      }
    });
  }

  return flags;
}

/**
 * الواجهة الرئيسية: فحوصات قاعدية + شرح ذكي اختياري.
 */
export async function checkMeasurementAnomalies(
  current: Measurements,
  history: Measurements[] = []
): Promise<MeasurementCheckResult> {
  const flags = ruleBasedMeasurementChecks(current, history);

  // لا داعي لاستدعاء الذكاء الاصطناعي إن لم توجد ملاحظات.
  if (!flags.length) return { flags, usedAI: false };

  const apiKey =
    (typeof process !== 'undefined' && process.env?.GEMINI_API_KEY) ||
    (import.meta as any)?.env?.GEMINI_API_KEY;

  if (!apiKey) {
    // يعمل بشكل كامل بدون مفتاح — فقط بلا شرح لغوي.
    return { flags, usedAI: false };
  }

  try {
    // تحميل كسول للمكتبة الموجودة أصلاً في التبعيات (@google/genai).
    const { GoogleGenAI } = await import('@google/genai');
    const ai = new GoogleGenAI({ apiKey });
    const prompt =
      'أنت مساعد خياطة. لخّص للخياط بالعربية وبإيجاز (سطرين كحد أقصى) سبب هذه التنبيهات على قياسات ثوب، ' +
      'واقترح ما يتحقق منه:\n' +
      flags.map((f) => `- ${f.message}`).join('\n');

    const res: any = await ai.models.generateContent({
      model: 'gemini-2.0-flash',
      contents: prompt,
    });
    const aiSummary = res?.text ?? res?.response?.text?.() ?? undefined;
    return { flags, aiSummary, usedAI: Boolean(aiSummary) };
  } catch (err) {
    // فشل الذكاء الاصطناعي لا يكسر التدفق — نرجع الفحوصات القاعدية فقط.
    console.warn('[aiService] AI summary skipped:', (err as Error)?.message);
    return { flags, usedAI: false };
  }
}

// ---- مساعدات ----
function isNum(v: unknown): v is number {
  return typeof v === 'number' && !Number.isNaN(v);
}
function labelOf(field: keyof Measurements | string): string {
  const map: Record<string, string> = {
    length: 'الطول', shoulder: 'الكتف', chest: 'الصدر', waist: 'الخصر',
    hips: 'الأرداف', sleeve: 'الكم', neck: 'الرقبة',
  };
  return map[field as string] || (field as string);
}
