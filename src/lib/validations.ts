import { z } from 'zod';
import i18n from '../i18n/config';

// Common regex patterns
const phoneRegex = /^(\+?\d{1,3}[- ]?)?\d{10}$/;

const t = (key: string, options?: any) => i18n.t(key, options) as string;

export const customerSchema = z.object({
  name: z.string().min(2, t('validation.min_length', { count: 2 })).max(100, t('validation.max_length', { count: 100 })),
  phone: z.string().regex(phoneRegex, t('validation.phone_format')),
  email: z.string().email(t('validation.invalid_email')).optional().or(z.literal('')),
  companyName: z.string().optional(),
  trn: z.string().optional(),
  isB2B: z.boolean().optional().default(false),
  address: z.string().optional(),
  city: z.string().optional(),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  measurements: z.object({
    length: z.coerce.number().min(0).max(300).optional(),
    shoulder: z.coerce.number().min(0).max(100).optional(),
    chest: z.coerce.number().min(0).max(200).optional(),
    waist: z.coerce.number().min(0).max(200).optional(),
    hips: z.coerce.number().min(0).max(200).optional(),
    sleeve: z.coerce.number().min(0).max(150).optional(),
    neck: z.coerce.number().min(0).max(100).optional(),
    collarType: z.string().optional(),
    cuffType: z.string().optional(),
    pocketType: z.string().optional(),
    chestStyle: z.string().optional(),
    shoulderStyle: z.string().optional(),
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
  notes: z.string().max(1000, t('validation.max_length', { count: 1000 })).optional(),
  isTest: z.boolean().optional().default(false),
});

export const orderSchema = z.object({
  customerId: z.string().min(1, t('validation.required')),
  items: z.array(z.object({
    garmentType: z.string().min(1, t('validation.required')),
    fabric: z.string().min(1, t('validation.required')),
    fabricId: z.string().optional(),
    quantity: z.coerce.number().min(0.01, t('validation.required')),
    selectedUnit: z.string().min(1, t('validation.required')),
    consumedMeters: z.coerce.number().min(0),
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
  })).min(1, t('validation.required')),
  totalAmount: z.coerce.number().min(0).optional(),
  subTotalAmount: z.coerce.number().min(0).optional(),
  discountAmount: z.coerce.number().min(0).optional(),
  paidAmount: z.coerce.number().min(0),
  remainingAmount: z.coerce.number().min(0).optional(),
  paymentMethod: z.enum(['cash', 'network', 'cash_on_delivery', 'partial']),
  deliveryDate: z.string().min(1, t('validation.required')),
  createdBy: z.string().optional(),
  status: z.enum(['measurements_taken', 'cutting', 'sewing', 'embroidery', 'ironing_packaging', 'ready', 'delivered']),
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
  phone: z.string().regex(phoneRegex, t('validation.phone_format')),
  role: z.string().min(1, t('validation.required')),
  branchId: z.string().min(1, t('validation.required')),
  status: z.enum(['active', 'inactive']),
  pin: z.string().length(4, t('validation.required')).regex(/^\d+$/, t('validation.phone_format')).optional().or(z.literal('')),
  isTest: z.boolean().optional().default(false),
});

export const onboardingSchema = z.object({
  customerId: z.string().min(5, t('validation.customer_id_format')).optional(),
  shopName: z.string().min(2, t('validation.min_length', { count: 2 })),
  logoUrl: z.string().optional(),
  category: z.enum(['tailor', 'tailor-female', 'uniform']),
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
  phone: z.string().regex(phoneRegex, t('validation.phone_format')),
  address: z.string().min(5, t('validation.min_length', { count: 5 })),
  taxNumber: z.string().optional(),
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
  phone: z.string().regex(phoneRegex, t('validation.phone_format')),
  address: z.string().min(5, t('validation.min_length', { count: 5 })),
  inventoryStrategy: z.enum(['centralized', 'decentralized']),
  logoUrl: z.string().optional(),
  currencySymbol: z.string().optional(),
  taxSettings: z.object({
    enabled: z.boolean(),
    trn: z.string().optional(),
    legalName: z.string().optional(),
    vatRate: z.coerce.number().min(0).max(100)
  }).optional(),
});

