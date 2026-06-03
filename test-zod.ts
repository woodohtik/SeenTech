import { z } from 'zod';

const phoneRegex = /^(05|5)(5|0|3|6|4|9|1|8|7)([0-9]{7})$/;
const onboardingSchema = z.object({
  customerId: z.string().min(5, 'كود العميل يجب أن يكون 5 أحرف على الأقل').optional(),
  shopName: z.string().min(2, 'اسم المحل يجب أن يكون حرفين على الأقل'),
  logoUrl: z.string().optional(),
  category: z.enum(['tailor', 'tailor-female', 'uniform']),
  taxNumber: z.string().regex(/^\d{15}$/, 'رقم الضريبة يجب أن يكون 15 رقم').optional().or(z.literal('')),
  taxStatus: z.enum(['registered', 'unregistered']).optional(),
  invoiceDefaults: z.string().optional(),
  address: z.string().min(5, 'العنوان يجب أن يكون 5 أحرف على الأقل'),
  city: z.string().min(2, 'المدينة مطلوبة'),
  country: z.string().min(2, 'الدولة مطلوبة'),
  phone: z.string().regex(phoneRegex, 'رقم الهاتف غير صحيح').optional().or(z.literal('')),
  currency: z.string().min(1, 'العملة مطلوبة').default('SAR'),
  language: z.enum(['ar', 'en']).default('ar'),
  inventoryStrategy: z.enum(['centralized', 'decentralized']).default('centralized'),
  defaultLayout: z.enum(['sidebar', 'grid']).optional().default('sidebar'),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

const defaultValues = {
  customerId: `SN-123456`,
  shopName: 'Test Shop',
  category: 'tailor',
  taxNumber: '',
  taxStatus: 'registered',
  invoiceDefaults: 'test',
  address: '123 Test Street',
  city: 'Test City',
  country: 'Test Country',
  phone: '',
  currency: 'SAR',
  language: 'ar',
  inventoryStrategy: 'centralized',
  defaultLayout: 'sidebar',
};

const result = onboardingSchema.safeParse(defaultValues);
console.log(result.success ? "Success" : JSON.stringify(result.error.issues, null, 2));
