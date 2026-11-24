import { z } from 'zod';
import { MEASUREMENT_FIELDS, LEGACY_MEASUREMENT_FIELDS, FIELD_NOTE_MAX, validateFieldNotes, type MeasurementKey, type LegacyMeasurementKey } from '../constants/measurementFields';
import i18n from '../i18n/config';
import { formatSaudiPhone } from '../utils/phoneUtils';

// Common regex patterns - accepts +9665XXXXXXXX, 05XXXXXXXX, 5XXXXXXXX, +9661XXXXXXXX, 01XXXXXXXX, etc.
const phoneRegex = /^(\+?\d{1,3}[- ]?)?\d{8,12}$/;

const t = (key: string, options?: any) => i18n.t(key, options) as string;

const phoneField = z.string().transform((val) => formatSaudiPhone(val)).pipe(
  z.string().regex(phoneRegex, t('validation.phone_format'))
);

const numericMeasurementShape = Object.fromEntries(
  [...MEASUREMENT_FIELDS, ...LEGACY_MEASUREMENT_FIELDS].map((f) => [f.key, z.coerce.number().min(0).max(f.maxCm).optional()])
) as Record<MeasurementKey | LegacyMeasurementKey, z.ZodOptional<z.ZodNumber>>;

export const customerSchema = z.object({
  name: z.string().min(2, t('validation.min_length', { count: 2 })).max(100, t('validation.max_length', { count: 100 })),
  phone: phoneField,
  // .nullable() on all four of these: Supabase returns SQL NULL as JS
  // `null`, not `undefined`, and `.optional()` alone only ever accepted
  // `undefined` -- a NULL email/companyName/trn/notes (the normal case for
  // most customers) made editing ANY field on that customer fail this
  // schema with an invisible "invalid_type" error, surfaced only via the
  // generic, misleading "enter name and phone correctly" message.
  email: z.string().email(t('validation.invalid_email')).optional().or(z.literal('')).nullable(),
  companyName: z.string().optional().nullable(),
  trn: z.string().refine((val) => !val || /^\d{15}$/.test(val), {
    message: t('validation.tax_number_format')
  }).optional().or(z.literal('')).nullable(),
  isB2B: z.boolean().optional().default(false),
  address: z.string().optional(),
  city: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  measurements: z.object({
    // Every numeric measurement comes from the one list in
    // constants/measurementFields.ts. zod strips unknown keys, so a key
    // missing here is erased from the customer on the next save (CM-01 below).
    ...numericMeasurementShape,
    // A note per measurement (seen-measurements-basic-advanced-task.md 2).
    fieldNotes: z.unknown().optional().transform((raw, ctx) => {
      const notes = validateFieldNotes(raw);
      if (!notes.ok) {
        ctx.addIssue({
          code: 'custom',
          message: notes.error === 'too_long' ? t('measurements.field_note_too_long', { max: FIELD_NOTE_MAX }) : t('measurements.field_note_invalid'),
        });
        return z.NEVER;
      }
      return notes.value;
    }),
    collarType: z.string().optional(),
    cuffType: z.string().optional(),
    pocketType: z.string().optional(),
    chestStyle: z.string().optional(),
    shoulderStyle: z.string().optional(),
    // seen-cto-code-review-2026-11-13.md CM-01: these four were missing
    // from this schema entirely. zod strips unknown keys by default, so
    // VisualMeasurements.tsx's own writes to cuttingType/collarPadding/
    // closureType/closureVisibility survived only in the form's local
    // state -- the moment a staff member saved ANY edit to the customer
    // (e.g. just fixing a phone number), customerSchema's parsed output
    // silently dropped these four keys and the full-object UPDATE erased
    // them from the database, even if the customer had set them through
    // the public measurements form beforehand. Matches the shape
    // validateMeasurementsPayload.ts already validates for that public
    // form's own write path.
    cuttingType: z.string().max(40).optional(),
    collarPadding: z.enum(['hard', 'soft']).optional(),
    closureType: z.enum(['zipper', 'buttons']).optional(),
    closureVisibility: z.enum(['hidden', 'visible']).optional(),
    thobeMeasurements: z.object({
      collar: z.coerce.number().min(0).optional(),
      chest: z.coerce.number().min(0).optional(),
      shoulders: z.coerce.number().min(0).optional(),
      sleeves: z.coerce.number().min(0).optional(),
      length: z.coerce.number().min(0).optional(),
      bottomWidth: z.coerce.number().min(0).optional(),
    }).optional(),
  }).optional(),
  styles: z.object({
    neckShape: z.string().optional(),
    sleeveStyle: z.string().optional(),
    pocketType: z.string().optional(),
  }).optional(),
  notes: z.string().max(1000, t('validation.max_length', { count: 1000 })).optional().nullable(),
  isTest: z.boolean().optional().default(false),
});

export const orderSchema = z.object({
  customerId: z.string().min(1, t('validation.required')),
  items: z.array(z.object({
    garmentType: z.string().min(1, t('validation.required')),
    fabric: z.string().min(1, t('validation.required')),
    fabricId: z.string().optional(),
    // Whole pieces. The fabric a line takes is its own figure (consumedMeters),
    // never the quantity.
    quantity: z.coerce.number().int(t('validation.required')).min(1, t('validation.required')),
    // Total fabric for the line, in meters.
    consumedMeters: z.coerce.number().min(0).optional(),
    // The staff member typed that total instead of taking the estimate.
    fabricManual: z.boolean().optional(),
    price: z.coerce.number().min(0, t('validation.required')),
    closureType: z.enum(['zipper', 'buttons']).optional(),
    closureVisibility: z.enum(['hidden', 'visible']).optional(),
    collarType: z.string().optional(),
    cuffType: z.string().optional(),
    pocketType: z.string().optional(),
    chestStyle: z.string().optional(),
    collarPadding: z.enum(['hard', 'soft']).optional(),
    additions: z.string().optional(),
    embroidery: z.string().optional(),
    // حقول التخصيص الديناميكية لأي نشاط غير mens_tailoring — بلا zod يُسقطها zodResolver صامتاً.
    attributes: z.record(z.string(), z.any()).optional(),
  })).min(1, t('validation.required')),
  totalAmount: z.coerce.number().min(0).optional(),
  subTotalAmount: z.coerce.number().min(0).optional(),
  discountAmount: z.coerce.number().min(0).optional(),
  paidAmount: z.coerce.number().min(0),
  remainingAmount: z.coerce.number().min(0).optional(),
  paymentMethod: z.enum(['cash', 'network', 'cash_on_delivery', 'partial']),
  deliveryDate: z.string().min(1, t('validation.required')),
  createdBy: z.string().optional(),
  // enum ثابت لمستأجري mens_tailoring، أو stage_key حر لأي نشاط آخر (انظر Orders.tsx: defaultOrderValues/onSubmit).
  status: z.string().min(1, t('validation.required')),
  notes: z.string().max(1000).optional().or(z.literal('')),
  internalNotes: z.string().max(1000).optional().or(z.literal('')),
  images: z.array(z.string()).optional(),
  isTest: z.boolean().optional().default(false),
});

export const inventorySchema = z.object({
  name: z.string().min(2, t('validation.min_length', { count: 2 })),
  nameEn: z.string().optional(),
  type: z.enum(['fabric', 'thread', 'button', 'lining', 'accessories', "ready_made", 'other']),
  quantity: z.coerce.number().min(0, t('validation.required')),
  unit: z.enum(['meter', 'yard', 'roll', 'bolt', 'piece', 'spool', 'box']),
  baseUnit: z.enum(['meter', 'piece']).default('meter'),
  conversionRate: z.coerce.number().min(0.0001, t('validation.required')).default(1),
  minThreshold: z.coerce.number().min(0),
  pricePerUnit: z.coerce.number().min(0),
  taxType: z.enum(['inclusive', 'exclusive', 'exempt']).default('exclusive'),
  supplierId: z.string().optional(),
  sku: z.string().optional(),
  barcode: z.string().optional(),
  isTest: z.boolean().optional().default(false),
  mainImage: z.string().optional(),
  showInPos: z.boolean().optional().default(true),
});

export const staffSchema = z.object({
  name: z.string().min(2, t('validation.min_length', { count: 2 })),
  email: z.string().email(t('validation.invalid_email')),
  phone: z.string().transform((val) => formatSaudiPhone(val)).pipe(
    z.string().refine((val) => val === '' || phoneRegex.test(val), {
      message: t('validation.phone_format')
    })
  ).optional().or(z.literal('')),
  role: z.string().min(1, t('validation.required')),
  branchId: z.string().min(1, t('validation.required')),
  status: z.enum(['active', 'inactive']),
  pin: z.string().length(4, t('validation.required')).regex(/^\d+$/, t('validation.phone_format')).optional().or(z.literal('')),
  enablePin: z.boolean().optional().default(true),
  isTest: z.boolean().optional().default(false),
});

export const onboardingSchema = z.object({
  customerId: z.string().min(5, t('validation.customer_id_format')).optional(),
  shopName: z.string().min(2, t('validation.min_length', { count: 2 })),
  phone: z.string().optional().or(z.literal('')),
  logoUrl: z.string().optional(),
  // Dynamic — sourced from the `verticals` table (verticalService.listVerticals()),
  // not a fixed enum, so a newly-added vertical never needs a code change here.
  vertical: z.string().min(1, t('validation.required')),
  taxNumber: z.string().regex(/^\d{15}$/, t('validation.tax_number_format')).optional().or(z.literal('')),
  taxStatus: z.enum(['registered', 'unregistered']).optional(),
  invoiceDefaults: z.string().optional(),
  address: z.string().min(5, t('validation.min_length', { count: 5 })),
  city: z.string().min(2, t('validation.required')),
  country: z.string().min(2, t('validation.required')),
  currency: z.string().min(1, t('validation.required')).default('SAR'),
  language: z.enum(['ar', 'en', 'ur']).default('ar'),
  inventoryStrategy: z.enum(['centralized', 'decentralized']).default('centralized'),
  defaultLayout: z.enum(['sidebar', 'grid']).optional().default('sidebar'),
  pin: z.string().length(4, t('validation.required')).regex(/^\d+$/, t('validation.phone_format')).optional().or(z.literal('')),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
});

export const supplierSchema = z.object({
  name: z.string().min(2, t('validation.min_length', { count: 2 })),
  contactPerson: z.string().min(2, t('validation.min_length', { count: 2 })),
  email: z.string().email(t('validation.invalid_email')).optional().or(z.literal('')),
  phone: phoneField,
  address: z.string().optional().or(z.literal('')),
  taxNumber: z.string().optional().or(z.literal('')),
  category: z.enum(['fabric', 'accessories', 'thread', 'button', 'lining', 'other']),
  isTest: z.boolean().optional().default(false),
});

export const reconciliationSchema = z.object({
  actualQuantity: z.coerce.number().min(0, t('validation.required')),
  reason: z.enum(['damaged', 'lost', 'correction', 'return', 'other'], {
    message: t('validation.required')
  }),
  staffId: z.string().min(1, t('validation.required')),
});

export const settingsSchema = z.object({
  name: z.string().min(2, t('validation.min_length', { count: 2 })),
  phone: z.string().optional().or(z.literal('')),
  address: z.string().min(5, t('validation.min_length', { count: 5 })),
  // seen-ai-assistant-zatca-cr-task.md: required (not just format-checked
  // when present like trn below) -- ZatcaOnboardingSettings.tsx already
  // blocks ZATCA activation without it, so leaving it skippable here just
  // meant a merchant could complete this whole tab and still hit a wall
  // later with no idea why.
  commercialRegister: z.string().min(1, t('validation.required')).regex(/^\d{10}$/, t('validation.commercial_register_format')),
  city: z.string().optional().or(z.literal('')),
  postalCode: z.string().optional().or(z.literal('')),
  inventoryStrategy: z.enum(['centralized', 'decentralized']),
  logoUrl: z.string().optional(),
  currencySymbol: z.string().optional(),
  measurementUnit: z.enum(['cm', 'inch']).optional(),
  fabricEstimate: z.object({
    wasteCm: z.coerce.number().min(0).max(200),
    defaultWidthCm: z.coerce.number().min(50).max(400),
    narrowWidthCm: z.coerce.number().min(50).max(400),
  }).optional(),
  taxSettings: z.object({
    enabled: z.boolean(),
    trn: z.string().optional().or(z.literal('')),
    legalName: z.string().optional(),
    // Zero is not a way to switch tax off: every reader of this rate (the
    // order form, create_tailoring_order, the settings save itself) treats 0
    // as "not set" and falls back to 15. Exemption is the tax type 'exempt'.
    vatRate: z.coerce.number().gt(0, t('validation.vat_rate_positive')).max(100),
    tailoringTaxType: z.enum(['inclusive', 'exclusive', 'exempt']).optional().default('exclusive')
  }).optional(),
  notificationSettings: z.object({
    lowStock: z.boolean().optional().default(true),
    newOrder: z.boolean().optional().default(true),
    dailyClose: z.boolean().optional().default(true),
    tomorrowDelivery: z.boolean().optional().default(true)
  }).optional(),
}).refine((data) => {
  if (data.taxSettings?.enabled) {
    return !!data.taxSettings.trn && /^\d{15}$/.test(data.taxSettings.trn);
  }
  if (data.taxSettings?.trn) {
    return /^\d{15}$/.test(data.taxSettings.trn);
  }
  return true;
}, {
  message: t('validation.tax_number_format'),
  path: ['taxSettings', 'trn']
});

