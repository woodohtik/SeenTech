import { supabase } from '../lib/supabase/client';

/**
 * تفاصيل التحويل البنكي المعروضة للتجّار عند الاشتراك بالتحويل البنكي
 * (BillingSettings.tsx) -- كانت الثلاثة (اسم البنك، اسم المستفيد، رقم
 * الآيبان) مثبَّتة بالكود/ملفات الترجمة بلا أي شاشة إدارية لتعديلها.
 * saas_settings['bank_transfer'] الآن المصدر الحي الوحيد، بنفس نمط
 * 'branding'/'platform'/'referral_program' في SaaSSystemSettings.tsx.
 */
export interface BankTransferSettings {
  bankName: string;
  accountHolder: string;
  iban: string;
}

// القيم المثبَّتة سابقاً بالكود -- تبقى هنا فقط كقيمة افتراضية تُعرَض قبل
// أن يحفظ سوبر أدمن أي قيمة فعلية لأول مرة، لا كمصدر حقيقة.
export const DEFAULT_BANK_TRANSFER_SETTINGS: BankTransferSettings = {
  bankName: 'مصرف الراجحي',
  accountHolder: 'شركة سين لنظم المعلومات والتكلفة',
  iban: 'SA1280000456123456789012',
};

export async function getBankTransferSettings(): Promise<BankTransferSettings> {
  const { data } = await supabase.from('saas_settings').select('value').eq('key', 'bank_transfer').maybeSingle();
  return {
    bankName: data?.value?.bankName || DEFAULT_BANK_TRANSFER_SETTINGS.bankName,
    accountHolder: data?.value?.accountHolder || DEFAULT_BANK_TRANSFER_SETTINGS.accountHolder,
    iban: data?.value?.iban || DEFAULT_BANK_TRANSFER_SETTINGS.iban,
  };
}
