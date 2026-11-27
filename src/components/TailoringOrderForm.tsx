import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useUnsavedWork } from '../lib/unsavedWork';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { useTranslation } from 'react-i18next';
import { useForm, useFieldArray, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import {
  AlertCircle, Check, CheckCircle2, Clock, CreditCard, Edit2, Image as ImageIcon, Loader2, Minus, Plus,
  Printer, RotateCcw, Ruler, ShoppingBag, Trash2, Truck, UserPlus, X, Zap,
} from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { handleFirestoreError, OperationType, getFriendlyErrorMessage } from '../lib/appErrors';
import { cn } from '../lib/utils';
import { isRtlLang } from '../lib/direction';
import { orderSchema, customerSchema } from '../lib/validations';
import { Customer, Measurements } from '../types';
import type { FieldSchema } from '../types/expansion';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useAuth } from '../contexts/AuthContext';
import { useStaff } from '../contexts/StaffContext';
import { usePermissions } from '../hooks/usePermissions';
import { useMeasurementUnit } from '../hooks/useMeasurementUnit';
import { useFabricEstimateSettings } from '../hooks/useFabricEstimateSettings';
import { useVerticalConfig } from '../hooks/useVerticalConfig';
import { isSpeechRecognitionSupported } from '../hooks/useSpeechRecognition';
import { legacyOrderStatusFor } from '../services/verticalService';
import { lengthCategoryKeyList } from '../utils/itemUnits';
import { useVerticalTerms } from '../hooks/useVerticalTerms';
import { localizedLabel, localizedOptions } from '../utils/verticalLabels';
import { createTailoringOrder } from '../services/tailoringOrderService';
import { formatItemStock, type ContentUnit } from '../utils/fabricUomConverter';
import { formatSaudiPhone } from '../utils/phoneUtils';
import { formatMeasurement, unitLabelKey } from '../utils/measurementUnits';
import { measurementRows, measurementSetFor } from '../constants/measurementFields';
import { estimateFabricMeters, fabricInputFromMeasurements } from '../utils/fabricEstimate';
import {
  computeLineFabric, computeTailoringTotals, fabricFromContentUnit, fabricInContentUnit,
  resolveTailoringTax, type TailoringTax,
} from '../utils/tailoringOrder';
import { PriceDisplay } from './PriceDisplay';
import VisualMeasurements from './VisualMeasurements';
import ThobeMeasurementSelector from './ThobeMeasurementSelector';
import { SmartSelect } from './ui/SmartSelect';
import { QuickAddTailor } from './staff/QuickAddTailor';
import { OrderImagesField } from './orders/OrderImagesField';
import { deleteOrderImage } from '../lib/orderImages';
import { useCustomerStylePrefill, rememberCustomerStylePrefs } from './orders/useCustomerStylePrefill';
import { applyStylePrefs } from '../utils/customerStylePrefs';
import { DatePicker, todayYmd } from './ui/DatePicker';
import { VoiceMicButton } from './ui/VoiceMicButton';

/**
 * The one form for a new tailoring order. Orders, the customer buttons and POS
 * all open this same component, and it saves through createTailoringOrder.
 */
export interface TailoringOrderFormProps {
  open: boolean;
  onClose: () => void;
  tenantId: string;
  /** Preselects the customer (the customer buttons, POS's current customer). */
  initialCustomerId?: string;
  /** Rendered at the top of the form body (the Orders page passes its stage stepper). */
  topSlot?: React.ReactNode;
  /**
   * After a successful save, stay open on the order's receipt instead of
   * closing. POS uses it: the order no longer passes through the cart.
   */
  showReceipt?: boolean;
  onCreated?: (order: Record<string, any>, meta: { queuedOffline: boolean }) => void;
}

const PAYMENT_METHODS = [
  { id: 'cash', labelKey: 'common.payment_methods.cash', icon: ShoppingBag },
  { id: 'network', labelKey: 'common.payment_methods.network', icon: CreditCard },
  { id: 'cash_on_delivery', labelKey: 'common.payment_methods.cash_on_delivery', icon: Truck },
  { id: 'partial', labelKey: 'common.payment_methods.partial', icon: Clock },
];

const EXTERNAL_FABRIC = 'custom';

const inputClass =
  "w-full bg-surface border border-border rounded-xl p-3 text-sm font-semibold text-content outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand";
const smallLabelClass = "text-sm text-content-muted font-bold uppercase";
// 16px, no uppercase (DESIGN.md §2, §7); one line high, so a row's fields line up.
const sectionLabelClass = "text-base font-bold text-content leading-6";

export default function TailoringOrderForm(props: TailoringOrderFormProps) {
  if (typeof document === 'undefined') return null;
  // The body mounts only while open, so every opening starts from a clean form.
  return createPortal(
    <AnimatePresence>{props.open && <TailoringOrderFormGate {...props} />}</AnimatePresence>,
    document.body
  );
}

/**
 * seen-verticals-readiness-task.md Phase 1.6: the form opens only once the
 * shop's activity settings are loaded -- its defaults (garment type, stages,
 * fields) are computed once when it mounts, so opening it earlier used to fill
 * a furniture order with men's-tailoring values. When the settings cannot be
 * loaded at all (offline, nothing saved, not a men's shop) no order is
 * created with defaults: the staff member is told why.
 */
function TailoringOrderFormGate(props: TailoringOrderFormProps) {
  const { loading, unavailable } = useVerticalConfig();
  const { t } = useTranslation();
  if (!loading && !unavailable) return <TailoringOrderFormBody {...props} />;
  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm font-sans"
      role="dialog"
      aria-modal="true"
      onClick={props.onClose}
    >
      <div className="bg-surface rounded-3xl shadow-2xl w-full max-w-sm border border-border p-6 space-y-4 text-center" onClick={(e) => e.stopPropagation()}>
        {loading ? (
          <>
            <Loader2 size={28} className="mx-auto animate-spin text-brand" />
            <p className="text-sm font-bold text-content">{t('verticals.loading_settings', 'جارٍ تحميل إعدادات نشاطك...')}</p>
          </>
        ) : (
          <>
            <AlertCircle size={28} className="mx-auto text-danger" />
            <h3 className="font-black text-content">{t('verticals.settings_unavailable_title', 'تعذّر تحميل إعدادات نشاطك')}</h3>
            <p className="text-sm text-content-muted font-bold leading-relaxed">
              {t('verticals.settings_unavailable_desc', 'لا يمكن إنشاء طلب الآن بإعدادات صحيحة لنشاطك. اتصل بالإنترنت ثم أعد المحاولة.')}
            </p>
          </>
        )}
        <button
          type="button"
          onClick={props.onClose}
          className="w-full bg-surface-muted text-content py-3 rounded-2xl font-black text-sm hover:bg-border transition-colors"
        >
          {t('common.close')}
        </button>
      </div>
    </div>
  );
}

/**
 * Item fields for any activity other than men's tailoring, from the
 * activity's own field schema. Values live in items[index].attributes.
 */
function DynamicOrderItemFields({
  index, fields, watch, setValue,
}: {
  index: number;
  fields: FieldSchema[];
  watch: (name: any) => any;
  setValue: (name: any, value: any) => void;
}) {
  const { t, i18n } = useTranslation();
  if (fields.length === 0) return null;

  return (
    <div className="main-720:col-span-4 mt-4 pt-4 border-t border-border grid grid-cols-1 main-720:grid-cols-3 gap-4">
      {fields.map((f) => {
        const path = `items.${index}.attributes.${f.field_key}`;
        const value = watch(path);
        if (f.field_type === 'select') {
          return (
            <div key={f.field_key} className="space-y-1">
              <label className={smallLabelClass}>{localizedLabel(f, i18n.language)}</label>
              <SmartSelect
                value={value ?? ''}
                onChange={(val) => setValue(path, val)}
                className="w-full bg-surface rounded-xl shadow-sm"
                options={[{ value: '', label: t('orders.choose_option') }, ...localizedOptions(f, i18n.language)]}
              />
            </div>
          );
        }
        if (f.field_type === 'bool') {
          return (
            <div key={f.field_key} className="space-y-1">
              <label className={smallLabelClass}>{localizedLabel(f, i18n.language)}</label>
              <button
                type="button"
                onClick={() => setValue(path, !value)}
                className={cn(
                  "w-full px-3 py-2.5 rounded-xl border-2 text-sm font-bold transition-all",
                  value ? "border-brand bg-brand/10 text-brand" : "border-border bg-surface text-content-muted"
                )}
              >
                {value ? t('common.yes') : t('common.no')}
              </button>
            </div>
          );
        }
        return (
          <div key={f.field_key} className="space-y-1">
            <label className={smallLabelClass}>{localizedLabel(f, i18n.language)}</label>
            <input
              type={f.field_type === 'number' ? 'number' : 'text'}
              value={value ?? ''}
              onChange={(e) => setValue(path, f.field_type === 'number' ? (e.target.value === '' ? '' : Number(e.target.value)) : e.target.value)}
              className="w-full bg-surface border border-border rounded-xl p-3 text-sm font-bold text-content outline-none transition-all focus:ring-2 focus:ring-brand/20 focus:border-brand"
            />
          </div>
        );
      })}
    </div>
  );
}

/**
 * The line's fabric total, editable. Keeps its own text while focused so a
 * half-typed decimal ("10.") is not rewritten under the cursor.
 */
function FabricTotalInput({
  id, value, onCommit,
}: {
  id: string;
  /** Current total in the cloth's unit, or null when there is none yet. */
  value: number | null;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  return (
    <input
      id={id}
      type="number"
      min="0"
      step="any"
      inputMode="decimal"
      value={text ?? (value === null ? '' : String(value))}
      onFocus={() => setText(value === null ? '' : String(value))}
      onChange={(e) => {
        setText(e.target.value);
        const parsed = parseFloat(e.target.value);
        if (Number.isFinite(parsed) && parsed >= 0) onCommit(parsed);
      }}
      onBlur={() => setText(null)}
      className="w-24 min-h-0 h-9 bg-surface border border-border rounded-lg px-2 text-sm font-black text-content outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand"
    />
  );
}

function QuickAddCustomerModal({
  tenantId, onClose, onAdded,
}: {
  tenantId: string;
  onClose: () => void;
  onAdded: (customer: Customer) => void;
}) {
  const { t, i18n } = useTranslation();
  const { error: toastError, success: toastSuccess } = useToast();
  const measurementUnit = useMeasurementUnit(tenantId);
  const fabricEstimateSettings = useFabricEstimateSettings(tenantId);
  const { register, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      name: '', phone: '', email: '', companyName: '', trn: '', notes: '',
      isTest: false, isB2B: false, address: '', city: '',
      measurements: {
        collarType: 'classic', cuffType: 'square', pocketType: 'hidden', chestStyle: 'plain', shoulderStyle: 'plain',
      },
      styles: { neckShape: 'round', sleeveStyle: 'normal', pocketType: 'none' },
    } as any,
  });
  const measurements = watch('measurements' as any);

  const onInvalid = (errs: any) => {
    const missing: string[] = [];
    if (errs.name) missing.push(t('login.full_name'));
    if (errs.phone) missing.push(t('onboarding.fields.phone'));
    toastError(missing.length > 0
      ? t('orders.complete_customer_fields', { fields: missing.join(t('common.list_separator')) })
      : t('orders.customer_name_phone_invalid'));
  };

  const onSubmit = async (data: any) => {
    const { address, city, latitude, longitude, companyName, trn, isTest } = data;
    const customerData: any = {
      name: data.name,
      phone: formatSaudiPhone(data.phone),
      email: data.email || null,
      notes: data.notes || null,
      measurements: data.measurements || {},
      // Address data lives inside styles, as the customers screen stores it.
      styles: { ...(data.styles || {}), address, city, latitude, longitude },
      company_name: companyName ? companyName : null,
      vat_number: trn ? trn : null,
      tenant_id: tenantId,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_test: !!isTest,
    };

    try {
      const { data: row, error } = await supabase.from('customers').insert(customerData).select().single();
      if (error) throw error;
      onAdded({
        ...row,
        companyName: row.company_name,
        trn: row.vat_number,
        isTest: row.is_test,
        isB2B: !!row.company_name,
        createdAt: row.created_at,
        tenantId: row.tenant_id,
      } as unknown as Customer);
      toastSuccess(t('orders.customer_added_success'));
    } catch (error: any) {
      console.error(error);
      toastError(error ? getFriendlyErrorMessage(error) : t('orders.customer_add_failed'));
    }
  };

  return (
    <div
      className="fixed inset-0 z-[150] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm overflow-y-auto font-sans"
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={t('pos.add_new_customer')}
        onClick={(e) => e.stopPropagation()}
        initial={{ scale: 0.95, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        className="relative w-full max-w-[clamp(320px,94vw,1100px)] max-h-[90vh] rounded-[var(--radius-card)] bg-[var(--surface)] shadow-2xl flex flex-col my-auto border border-border overflow-hidden text-start"
        dir={isRtlLang(i18n.language) ? 'rtl' : 'ltr'}
      >
        <div className="flex items-center justify-between p-4 main-640:p-6 border-b border-[var(--border)] bg-brand/5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-brand text-white rounded-2xl shrink-0 shadow-sm"><UserPlus size={20} /></div>
            <h3 className="text-base main-640:text-lg main-900:text-xl font-black text-content">{t('pos.add_new_customer')}</h3>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="p-2 hover:bg-surface-muted rounded-full transition-colors text-content-muted">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit(onSubmit, onInvalid)} className="flex-1 overflow-y-auto p-4 main-640:p-6 space-y-6">
          <div className="grid grid-cols-1 main-720:grid-cols-2 gap-6">
            <div className="space-y-1">
              <label htmlFor="quick-customer-name" className="text-sm font-bold text-content-muted">{t('login.full_name')}</label>
              <input id="quick-customer-name" {...register('name' as any)} className={inputClass} />
              {errors.name && <p className="text-sm text-danger font-bold">{String(errors.name.message)}</p>}
            </div>
            <div className="space-y-1">
              <label htmlFor="quick-customer-phone" className="text-sm font-bold text-content-muted">{t('onboarding.fields.phone')}</label>
              <input
                id="quick-customer-phone"
                {...register('phone' as any)}
                onBlur={(e) => setValue('phone' as any, formatSaudiPhone(e.target.value))}
                className={inputClass}
              />
              {errors.phone && <p className="text-sm text-danger font-bold">{String(errors.phone.message)}</p>}
            </div>
          </div>

          <h4 className="text-lg font-bold text-content pt-4 border-t border-border flex items-center gap-2">
            <ShoppingBag size={20} className="text-brand" />
            {t('orders.b2b_data_title')}
          </h4>
          <div className="grid grid-cols-1 main-720:grid-cols-2 gap-6 pb-4 border-b border-border">
            <div className="space-y-2">
              <label htmlFor="quick-customer-company" className="text-sm font-bold text-content-muted">{t('orders.company_name_label')} <span className="opacity-70 text-sm">{t('common.optional')}</span></label>
              <input id="quick-customer-company" type="text" {...register('companyName' as any)} className={inputClass} placeholder={t('orders.company_name_placeholder')} />
            </div>
            <div className="space-y-2">
              <label htmlFor="quick-customer-trn" className="text-sm font-bold text-content-muted">{t('orders.company_trn_label')} <span className="opacity-70 text-sm">{t('common.optional')}</span></label>
              <input id="quick-customer-trn" type="text" {...register('trn' as any)} className={inputClass} dir="ltr" placeholder="300000000000003" />
              {errors.trn && <p className="text-sm text-danger font-bold">{String(errors.trn.message)}</p>}
            </div>
          </div>

          <ThobeMeasurementSelector
            values={(measurements as Measurements) || {}}
            onChange={(next) => {
              Object.entries(next).forEach(([key, value]) => setValue(`measurements.${key}` as any, value));
            }}
            measurementUnit={measurementUnit}
            fabricEstimate={{ settings: fabricEstimateSettings }}
          />
          <div className="space-y-4">
            <h4 className={cn(sectionLabelClass, "flex items-center gap-2")}>
              <Zap size={16} />
              {t('orders.visual_details_title')}
            </h4>
            <VisualMeasurements
              values={measurements || {}}
              onChange={(field, val) => setValue(`measurements.${field}` as any, val)}
            />
          </div>

          <div className="space-y-2 pt-6 border-t border-border">
            <label htmlFor="quick-customer-notes" className="text-sm font-bold text-content-muted">{t('orders.extra_notes')}</label>
            <textarea id="quick-customer-notes" {...register('notes' as any)} className={cn(inputClass, "h-24")} />
          </div>

          <div className="flex items-center gap-3 p-4 bg-warning/5 rounded-2xl border border-warning/10">
            <input type="checkbox" id="quick-customer-test" {...register('isTest' as any)} className="w-5 h-5 text-brand border-border rounded focus:ring-brand" />
            <label htmlFor="quick-customer-test" className="text-sm font-bold text-warning flex items-center gap-2">
              <Zap size={16} />
              {t('common.test_data')}
            </label>
          </div>

          <div className="sticky bottom-0 z-10 -mx-4 main-640:-mx-6 px-4 main-640:px-6 pt-4 pb-[calc(1rem+env(safe-area-inset-bottom))] border-t border-[var(--border)] bg-[var(--surface)] flex items-center justify-end gap-3">
            <button type="button" onClick={onClose} className="px-6 py-2.5 text-content-muted font-bold hover:text-content transition-colors text-sm">{t('common.cancel')}</button>
            <button type="submit" disabled={isSubmitting} className="bg-brand text-white px-8 py-2.5 rounded-xl font-bold hover:bg-brand/90 shadow-lg shadow-brand/20 transition-all disabled:opacity-50 text-sm">
              {isSubmitting ? t('common.saving') : t('orders.confirm_add_customer')}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
}

function TailoringOrderFormBody({
  onClose: onCloseProp, tenantId, initialCustomerId, topSlot, showReceipt, onCreated,
}: TailoringOrderFormProps) {
  const { t, i18n } = useTranslation();
  const isRtl = isRtlLang(i18n.language);
  // The open order form holds off an update until it is saved or closed (update-delivery task 3.1).
  useUnsavedWork('tailoring-order-form', true);
  const { error: toastError, success: toastSuccess, warning: toastWarning } = useToast();
  const { confirm } = useConfirm();
  const { currentStaff } = useStaff();
  const { user: currentAuthUser } = useAuth();
  const { hasPermission } = usePermissions(currentStaff);
  const { workflowStages, orderItemFields, isLegacyVertical, capabilities } = useVerticalConfig();
  const tv = useVerticalTerms();
  // Phase 4 of seen-verticals-readiness-task.md: the activity's own
  // measurement set (thobe for men's tailoring, as before; none -- the
  // section is hidden -- for an activity without an approved set).
  const hasBodyMeasurements = measurementSetFor(capabilities.body_measurements).length > 0;
  const estimatesFabricFromMeasurements = capabilities.body_measurements === 'thobe';
  const measurementUnit = useMeasurementUnit(tenantId);
  const fabricEstimateSettings = useFabricEstimateSettings(tenantId);
  const voiceSupported = isSpeechRecognitionSupported();
  const canDiscount = hasPermission('action.discount');

  const [isLoading, setIsLoading] = useState(true);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [fabrics, setFabrics] = useState<any[]>([]);
  /** Real stock of the branch this order draws from, in meters, by fabric id. */
  const [branchStock, setBranchStock] = useState<Record<string, number> | null>(null);
  const [tailors, setTailors] = useState<{ id: string; name: string }[]>([]);
  // After "+ add tailor": the list again, so the new one can be picked.
  const reloadTailors = useCallback(async () => {
    const { data } = await supabase.from('staff').select('id, name').eq('tenant_id', tenantId).eq('role', 'tailor').eq('status', 'active');
    setTailors((data || []).map((s: any) => ({ id: s.id, name: s.name })));
  }, [tenantId]);
  const [tax, setTax] = useState<TailoringTax>({ enabled: false, vatRatePercentage: 15, taxType: 'exclusive' });
  const [strategy, setStrategy] = useState<'centralized' | 'decentralized'>('centralized');
  const [isQuickAddOpen, setIsQuickAddOpen] = useState(false);
  const [isEditingMeasurements, setIsEditingMeasurements] = useState(false);
  const [tempMeasurements, setTempMeasurements] = useState<Measurements>({});
  const [isSavingMeasurements, setIsSavingMeasurements] = useState(false);
  const [savedOrder, setSavedOrder] = useState<{ order: Record<string, any>; queuedOffline: boolean; depositSkipped: boolean } | null>(null);
  // One id for this form session: a second click or a retry after a dropped
  // response saves the same order instead of a new one.
  const orderIdRef = useRef<string>(globalThis.crypto.randomUUID());
  // seen-order-images-upload-task.md: photos upload as they are added, into
  // this order's folder. Abandoning the form removes them again (no orphan
  // files); saving keeps them. The order waits for a photo still uploading.
  const sessionUploadsRef = useRef<string[]>([]);
  const savedRef = useRef(false);
  const [imagesBusy, setImagesBusy] = useState(false);
  const onClose = useCallback(() => {
    if (!savedRef.current && sessionUploadsRef.current.length) {
      const paths = sessionUploadsRef.current;
      sessionUploadsRef.current = [];
      void Promise.all(paths.map((p) => deleteOrderImage(p).catch(() => undefined)));
    }
    onCloseProp();
  }, [onCloseProp]);

  const firstStageKey = isLegacyVertical || workflowStages.length === 0 ? 'measurements_taken' : workflowStages[0].stage_key;

  const newLine = useCallback(() => ({
    // "ثوب" is a sensible default only for men's tailoring.
    garmentType: isLegacyVertical ? 'ثوب' : '',
    quantity: 1,
    price: 0,
    fabric: '',
    fabricId: '',
    consumedMeters: 0,
    fabricManual: false,
    closureType: 'buttons' as const,
    closureVisibility: 'visible' as const,
    collarType: 'plain',
    cuffType: 'plain',
    pocketType: 'single',
    chestStyle: 'plain',
    collarPadding: 'soft' as const,
    additions: '',
    embroidery: '',
  }), [isLegacyVertical]);

  const { register, control, handleSubmit, watch, setValue, getValues, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(orderSchema),
    defaultValues: {
      customerId: initialCustomerId || '',
      deliveryDate: '',
      assignedTailorId: '',
      items: [newLine()],
      status: firstStageKey,
      paidAmount: 0,
      paymentMethod: 'cash',
      discountAmount: 0,
      notes: '',
      internalNotes: '',
      images: [] as string[],
      isTest: false,
    } as any,
  });
  const { fields, append, remove } = useFieldArray({ control, name: 'items' as any });

  const watchItems: any[] = watch('items' as any) || [];
  const watchCustomerId: string = watch('customerId' as any);
  const selectedCustomer = customers.find((c) => c.id === watchCustomerId);
  const totals = computeTailoringTotals(watchItems, canDiscount ? watch('discountAmount' as any) : 0, tax);
  const activeMeasurements = isEditingMeasurements ? tempMeasurements : selectedCustomer?.measurements;
  // Phase 2 item 3: the chosen customer's preferences fill the lines.
  const stylePrefill = useCustomerStylePrefill({
    customer: selectedCustomer as any,
    lineCount: watchItems.length,
    setLineValue: (index, key, value) => setValue(`items.${index}.${key}` as any, value, { shouldDirty: true }),
  });

  // ---- data ----
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    (async () => {
      try {
        const [{ data: custData }, { data: fabricData }, { data: staffData }, { data: tenantRow }, { data: mainBranch }] = await Promise.all([
          // Only what the form shows: the picker's name and the measurements panel.
          supabase.from('customers').select('id, name, phone, measurements').eq('tenant_id', tenantId),
          // The shop's length categories (Phase 1): men's tailoring -> `fabric` only, as before.
          supabase.from('inventory_items').select('*').eq('tenant_id', tenantId)
            .or(`category.eq.fabric,category_key.in.(${lengthCategoryKeyList().join(',')})`),
          supabase.from('staff').select('id, name, role, status').eq('tenant_id', tenantId).eq('role', 'tailor').eq('status', 'active'),
          supabase.from('tenants').select('*').eq('id', tenantId).maybeSingle(),
          supabase.from('branches').select('id').eq('tenant_id', tenantId).eq('is_main', true).maybeSingle(),
        ]);
        if (cancelled) return;

        setCustomers((custData || []) as unknown as Customer[]);
        setFabrics(fabricData || []);
        setTailors((staffData || []).map((s: any) => ({ id: s.id, name: s.name })));
        setTax(resolveTailoringTax(tenantRow));
        const tenantStrategy: 'centralized' | 'decentralized' = tenantRow?.inventory_strategy || 'centralized';
        setStrategy(tenantStrategy);

        // Stock moves in branch_inventory only; inventory_items.quantity is
        // not kept current. Read the branch this order will be cut from.
        const stockBranchId = tenantStrategy === 'centralized'
          ? (mainBranch?.id || currentStaff?.branchId)
          : (currentStaff?.branchId || mainBranch?.id);
        if (stockBranchId) {
          const { data: stockRows, error: stockError } = await supabase
            .from('branch_inventory')
            .select('item_id, quantity, variant_id')
            .eq('tenant_id', tenantId)
            .eq('branch_id', stockBranchId);
          if (!cancelled && !stockError) {
            const map: Record<string, number> = {};
            (stockRows || []).forEach((row: any) => {
              if (!row.variant_id) map[row.item_id] = Number(row.quantity) || 0;
            });
            setBranchStock(map);
          }
        }
      } catch (error) {
        if (!cancelled) handleFirestoreError(error as any, OperationType.LIST, 'data');
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // currentStaff's branch is read once per opening on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  useEffect(() => {
    setIsEditingMeasurements(false);
    setTempMeasurements(selectedCustomer?.measurements || {});
    // Only the chosen customer should reset the edit panel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [watchCustomerId]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (isQuickAddOpen) setIsQuickAddOpen(false);
      else onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isQuickAddOpen, onClose]);

  // ---- per-line fabric ----
  const fabricOptions = useMemo(() => [
    { value: '', label: t('orders.choose_fabric') },
    ...fabrics.map((item) => ({
      value: item.id,
      // Without a readable branch balance, show the name alone rather than a stale number.
      label: branchStock ? `${item.name} (${formatItemStock(item, branchStock[item.id] ?? 0)})` : item.name,
    })),
    { value: EXTERNAL_FABRIC, label: t('orders.external_fabric') },
  ], [fabrics, branchStock, t]);

  const lineFabric = (item: any) => {
    const isExternal = item?.fabric === EXTERNAL_FABRIC;
    const fabricRow = fabrics.find((f) => f.id === item?.fabricId);
    // The thobe formula as before; any other activity enters the metres by hand.
    const perPieceMeters = estimatesFabricFromMeasurements && (isExternal || fabricRow)
      ? estimateFabricMeters(
          fabricInputFromMeasurements(activeMeasurements, fabricRow ? Number(fabricRow.fabric_width_cm) || null : null),
          fabricEstimateSettings
        )
      : null;
    const contentUnit: ContentUnit = fabricRow?.content_unit === 'yard' ? 'yard' : 'meter';
    return {
      isExternal,
      hasFabric: isExternal || Boolean(fabricRow),
      contentUnit,
      ...computeLineFabric({
        perPieceMeters,
        quantity: item?.quantity,
        isManual: item?.fabricManual,
        manualMeters: item?.consumedMeters,
        isExternal,
      }),
    };
  };

  // ---- submit ----
  const onInvalidSubmit = useCallback((formErrors: any) => {
    const missing: string[] = [];
    if (formErrors.customerId) missing.push(t('common.customer'));
    if (formErrors.deliveryDate) missing.push(t('orders.expected_delivery_date'));
    if (Array.isArray(formErrors.items)) {
      formErrors.items.forEach((itemErr: any, idx: number) => {
        if (!itemErr) return;
        const field = (key: string) => t('orders.missing_item_field', { field: t(key), index: idx + 1 });
        if (itemErr.garmentType) missing.push(field('orders.item_type'));
        if (itemErr.fabric) missing.push(field('orders.fabric'));
        if (itemErr.price) missing.push(field('orders.piece_price'));
        if (itemErr.quantity) missing.push(field('orders.quantity_pieces'));
      });
    } else if (formErrors.items) {
      missing.push(t('orders.required_items'));
    }
    toastError(missing.length > 0
      ? t('orders.complete_following_fields', { fields: missing.join(t('common.list_separator')) })
      : t('orders.fill_required_fields'));
    setTimeout(() => {
      document.querySelector('[data-tailoring-order-form] [aria-invalid="true"]')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }, [t, toastError]);

  const onSubmit = async (data: any) => {
    if (!tenantId) {
      toastError(t('orders.error_store_code_not_found'));
      return;
    }
    if (strategy === 'decentralized' && !currentStaff?.branchId) {
      toastError(t('orders.error_staff_branch_required'));
      return;
    }

    const statusKey: string = data.status || firstStageKey;
    const items = (data.items as any[]).map((item) => {
      const fabric = lineFabric(item);
      return {
        ...item,
        quantity: Math.max(1, Math.floor(Number(item.quantity) || 1)),
        // Marks the quantity as pieces, so nothing reads it as a fabric amount.
        quantityUnit: 'piece',
        fabricId: fabric.isExternal ? '' : (item.fabricId || ''),
        fabricPerPieceMeters: fabric.perPieceMeters ?? 0,
        fabricManual: fabric.isManual,
        consumedMeters: fabric.consumedMeters,
      };
    });

    try {
      const result = await createTailoringOrder({
        orderId: orderIdRef.current,
        tenantId,
        staff: currentStaff ? { id: currentStaff.id, name: currentStaff.name, branchId: currentStaff.branchId } : null,
        authUserId: currentAuthUser?.id,
        customer: selectedCustomer ? { id: selectedCustomer.id, name: selectedCustomer.name, measurements: selectedCustomer.measurements } : null,
        inventoryStrategy: strategy,
        statusKey,
        legacyStatus: legacyOrderStatusFor(statusKey, workflowStages),
        items,
        totals: computeTailoringTotals(items, canDiscount ? data.discountAmount : 0, tax),
        paidAmount: Number(data.paidAmount || 0),
        discountAmount: canDiscount ? Number(data.discountAmount || 0) : 0,
        paymentMethod: data.paymentMethod || 'cash',
        deliveryDate: data.deliveryDate,
        assignedTailorId: data.assignedTailorId,
        notes: data.notes,
        images: data.images,
        isTest: data.isTest,
        confirmShortage: (missing) => confirm(t('orders.stock_shortage_confirm', { items: missing.join(', ') })),
      });

      if (result.status === 'cancelled') {
        toastWarning(t('orders.order_cancelled_low_stock'));
        return;
      }

      savedRef.current = true;
      const queuedOffline = result.status === 'queued';
      // The order's choices become the customer's preferences (best effort; not offline).
      if (!queuedOffline && selectedCustomer && items[0]) {
        void rememberCustomerStylePrefs(tenantId, selectedCustomer.id, items[0] as Record<string, unknown>).catch(() => undefined);
      }
      onCreated?.(result.order, { queuedOffline });
      if (queuedOffline) {
        toastSuccess(
          t('orders.order_queued_offline_title', 'سُجِّل الطلب محلياً'),
          t('orders.order_queued_offline_desc', 'لا يوجد اتصال حالياً — سيُرفَع تلقائياً للخادم فور عودة الإنترنت.')
        );
      } else {
        toastSuccess(t('orders.order_added_success'));
      }
      if (result.depositSkipped) {
        // The order is saved; only the deposit was left out.
        toastWarning(t('orders.deposit_needs_shift_title'), t('orders.deposit_needs_shift_desc'));
      }
      if (showReceipt) setSavedOrder({ order: result.order, queuedOffline, depositSkipped: result.depositSkipped });
      else onClose();
    } catch (error: any) {
      console.error('Order submission error:', error);
      handleFirestoreError(error, OperationType.WRITE, 'orders');
    }
  };

  const saveMeasurements = async () => {
    if (!selectedCustomer) return;
    setIsSavingMeasurements(true);
    try {
      // seen-permissions-fix-task.md Phase 3: allowed to whoever may create an
      // order, and it changes the measurements only (editing the rest of a
      // customer needs customers.edit).
      const { error } = await supabase.rpc('save_customer_measurements', {
        p_customer_id: selectedCustomer.id,
        p_measurements: tempMeasurements,
      });
      if (error) throw error;
      setCustomers((prev) => prev.map((c) => (c.id === selectedCustomer.id ? { ...c, measurements: tempMeasurements } : c)));
      toastSuccess(t('orders.measurements_updated_success'));
      setIsEditingMeasurements(false);
    } catch (err) {
      console.error(err);
      toastError(t('orders.measurements_update_failed'));
    } finally {
      setIsSavingMeasurements(false);
    }
  };

  const printReceipt = async () => {
    if (!savedOrder) return;
    try {
      const { printElementDetailed, getConfiguredPaperSize } = await import('../utils/printManager');
      const res = await printElementDetailed('tailoring-order-receipt', {
        paperSize: getConfiguredPaperSize('80mm'),
        title: `${tv('orders.receipt_title')} ${savedOrder.order.order_number || ''}`.trim(),
      });
      if (!res.ok) toastError(res);
    } catch (e) {
      console.error('[TailoringOrderForm] print failed:', e);
      window.print();
    }
  };

  const unitText = (unit: ContentUnit) => t(unit === 'yard' ? 'inventory.unit_yard' : 'inventory.unit_meter');
  const paidAmount = Number(watch('paidAmount' as any) || 0);
  const images: string[] = watch('images' as any) || [];

  return (
    <div className="fixed inset-0 z-[100] flex items-end main-900:items-center justify-center main-900:p-4 overflow-hidden">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={t('orders.create_new_order')}
        data-tailoring-order-form
        initial={{ y: '100%', opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: '100%', opacity: 0 }}
        transition={{ type: 'spring', damping: 25, stiffness: 200 }}
        className="relative w-full main-900:max-w-5xl rounded-t-3xl main-900:rounded-3xl shadow-2xl z-10 overflow-hidden h-[95vh] main-900:h-auto main-900:max-h-[92vh] flex flex-col border border-border bg-surface text-start"
        dir={isRtl ? 'rtl' : 'ltr'}
      >
        <div className="flex items-center justify-between p-4 main-640:p-5 border-b border-[var(--border)] bg-brand/5 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-brand text-white rounded-2xl shrink-0 shadow-sm">
              {savedOrder ? <CheckCircle2 size={20} /> : <Plus size={20} />}
            </div>
            <h3 className="text-base main-640:text-lg main-900:text-xl font-black text-content">
              {savedOrder ? t('orders.receipt_saved') : t('orders.create_new_order')}
            </h3>
          </div>
          <button type="button" onClick={onClose} aria-label={t('common.close')} className="p-2 hover:bg-surface-muted rounded-full transition-colors text-content-muted">
            <X size={20} />
          </button>
        </div>

        {savedOrder ? (
          <div className="flex-1 overflow-y-auto p-4 main-640:p-6">
            <div id="tailoring-order-receipt" className="max-w-md mx-auto bg-surface border border-border rounded-2xl p-5 space-y-4 text-content" dir={isRtl ? 'rtl' : 'ltr'}>
              <div className="text-center space-y-1">
                <h4 className="text-lg font-black">{tv('orders.receipt_title')}</h4>
                {savedOrder.order.order_number && (
                  <p className="text-sm font-bold text-content-muted" dir="ltr">{savedOrder.order.order_number}</p>
                )}
                {savedOrder.queuedOffline && (
                  <p className="text-sm font-bold text-warning">{t('orders.order_queued_offline_title', 'سُجِّل الطلب محلياً')}</p>
                )}
              </div>
              <dl className="text-sm space-y-1.5">
                <div className="flex justify-between gap-3"><dt className="text-content-muted font-bold">{t('common.customer')}</dt><dd className="font-black">{savedOrder.order.customer_name}</dd></div>
                <div className="flex justify-between gap-3"><dt className="text-content-muted font-bold">{t('orders.expected_delivery_date')}</dt><dd className="font-black" dir="ltr">{String(savedOrder.order.delivery_date || '').slice(0, 10)}</dd></div>
              </dl>
              <ul className="border-y border-border py-3 space-y-2 text-sm">
                {(savedOrder.order.items as any[] || getValues('items' as any) || []).map((item: any, idx: number) => (
                  <li key={idx} className="flex justify-between gap-3">
                    <span className="font-bold">{item.garmentType} × {item.quantity}</span>
                    <span className="font-black"><PriceDisplay amount={Number(item.price) * Number(item.quantity)} /></span>
                  </li>
                ))}
              </ul>
              <dl className="text-sm space-y-1.5">
                {Number(savedOrder.order.discount_amount) > 0 && (
                  <div className="flex justify-between gap-3"><dt className="text-content-muted font-bold">{t('orders.discount_label')}</dt><dd className="font-black"><PriceDisplay amount={Number(savedOrder.order.discount_amount)} /></dd></div>
                )}
                {Number(savedOrder.order.tax_amount) > 0 && (
                  <div className="flex justify-between gap-3"><dt className="text-content-muted font-bold">{t('orders.vat_label')}</dt><dd className="font-black"><PriceDisplay amount={Number(savedOrder.order.tax_amount)} /></dd></div>
                )}
                <div className="flex justify-between gap-3 text-base"><dt className="font-black">{t('orders.grand_total')}</dt><dd className="font-black"><PriceDisplay amount={Number(savedOrder.order.total_amount)} /></dd></div>
                <div className="flex justify-between gap-3"><dt className="text-content-muted font-bold">{t('orders.amount_paid')}</dt><dd className="font-black"><PriceDisplay amount={Number(savedOrder.order.paid_amount)} /></dd></div>
                <div className="flex justify-between gap-3"><dt className="text-content-muted font-bold">{t('orders.remaining_label')}</dt><dd className="font-black"><PriceDisplay amount={Number(savedOrder.order.total_amount) - Number(savedOrder.order.paid_amount)} /></dd></div>
              </dl>
            </div>
            {savedOrder.depositSkipped && (
              <p role="alert" className="max-w-md mx-auto mt-3 text-sm font-bold text-warning bg-[var(--seen-warning-bg)] border border-warning/20 rounded-xl p-3">
                {t('orders.deposit_needs_shift_desc')}
              </p>
            )}
            <div className="max-w-md mx-auto mt-4 flex flex-wrap gap-3">
              <button type="button" onClick={printReceipt} className="flex-1 min-w-[140px] bg-brand text-white py-3 rounded-xl font-bold hover:bg-brand/90 transition-colors flex items-center justify-center gap-2">
                <Printer size={18} /> {t('orders.receipt_print')}
              </button>
              <button type="button" onClick={onClose} className="flex-1 min-w-[140px] border border-border py-3 rounded-xl font-bold text-content hover:bg-surface-muted transition-colors">
                {t('common.close')}
              </button>
            </div>
          </div>
        ) : (
        <form onSubmit={handleSubmit(onSubmit, onInvalidSubmit)} className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto p-4 main-640:p-6 space-y-6">
            {topSlot}

            {/* Customer, delivery, tailor */}
            <div className="grid grid-cols-1 main-720:grid-cols-3 gap-4">
              <div className="space-y-2">
                <div className="flex items-center h-6"><label className={sectionLabelClass}>{t('common.customer')}</label></div>
                <div className="flex items-center gap-2">
                  <div className="flex-1 min-w-0" aria-invalid={!!errors.customerId}>
                    <Controller
                      name={'customerId' as any}
                      control={control}
                      render={({ field }) => (
                        <SmartSelect
                          value={field.value}
                          onChange={field.onChange}
                          options={[
                            { value: '', label: isLoading ? t('common.loading') : t('orders.choose_customer') },
                            ...customers.map((c) => ({ value: c.id, label: c.name })),
                          ]}
                          error={!!errors.customerId}
                          className=""
                        />
                      )}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsQuickAddOpen(true)}
                    title={t('orders.add_new_customer')}
                    aria-label={t('orders.add_new_customer')}
                    className="w-12 h-12 bg-brand text-white rounded-2xl flex items-center justify-center hover:bg-brand/90 transition-all shrink-0 shadow-sm active:scale-95"
                  >
                    <UserPlus size={20} />
                  </button>
                </div>
                {errors.customerId && <p className="text-sm text-danger font-bold">{String(errors.customerId.message)}</p>}
                {stylePrefill.filledFor && (
                  <p role="status" className="text-sm font-bold text-brand">{t('orders.customer_prefs_filled', { name: stylePrefill.filledFor })}</p>
                )}
              </div>

              <div className="space-y-2" aria-invalid={!!errors.deliveryDate}>
                <div className="flex items-center h-6"><label className={sectionLabelClass}>{t('orders.expected_delivery_date')}</label></div>
                <DatePicker
                  value={watch('deliveryDate' as any) || ''}
                  onChange={(val) => setValue('deliveryDate' as any, val, { shouldValidate: true, shouldDirty: true })}
                  // No delivery date in the past (seen-merchant-trial-test-2026-11-26.md, phase 3 item 6).
                  minDate={todayYmd()}
                />
                {errors.deliveryDate && <p className="text-sm text-danger font-bold">{String(errors.deliveryDate.message)}</p>}
              </div>

              {/* One tailor per order: the commission trigger works at order level. */}
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2 h-6">
                  <label className={sectionLabelClass}>{tv('orders.assigned_tailor')}</label>
                  {hasPermission('staff.create') && (
                    <QuickAddTailor tenantId={tenantId} currentStaffEmail={currentStaff?.email} onAdded={reloadTailors} />
                  )}
                </div>
                <SmartSelect
                  value={watch('assignedTailorId' as any) || ''}
                  onChange={(v) => setValue('assignedTailorId' as any, v, { shouldDirty: true })}
                  options={[
                    { value: '', label: t('orders.assigned_tailor_none') },
                    ...tailors.map((s) => ({ value: s.id, label: s.name })),
                  ]}
                />
              </div>
            </div>

            {/* Measurements -- only for an activity that takes them (Phase 4). */}
            {selectedCustomer && hasBodyMeasurements && (
              <div className="bg-brand/5 p-4 main-640:p-5 rounded-3xl border border-brand/10 space-y-4">
                <div className="flex items-center justify-between text-brand">
                  <div className="flex items-center gap-2">
                    <Ruler size={18} />
                    <h4 className="font-black text-sm uppercase">{t('orders.customer_measurements_auto')}</h4>
                  </div>
                  {!isEditingMeasurements ? (
                    <button
                      type="button"
                      onClick={() => {
                        setTempMeasurements(selectedCustomer.measurements || {});
                        setIsEditingMeasurements(true);
                      }}
                      className="text-sm font-bold text-brand bg-surface border border-brand/20 hover:bg-brand hover:text-white px-3 py-1.5 rounded-xl transition-all flex items-center gap-1.5 shadow-sm active:scale-95"
                    >
                      <Edit2 size={13} />
                      <span>{t('common.edit')}</span>
                    </button>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setIsEditingMeasurements(false)}
                        className="text-sm font-bold text-content-muted bg-surface hover:bg-surface-muted px-2.5 py-1 rounded-xl transition-all"
                      >
                        {t('common.cancel')}
                      </button>
                      <button
                        type="button"
                        disabled={isSavingMeasurements}
                        onClick={saveMeasurements}
                        className="text-sm font-bold text-white bg-brand hover:bg-brand/90 px-3 py-1.5 rounded-xl transition-all flex items-center gap-1 shadow-sm active:scale-95 disabled:opacity-50"
                      >
                        <Check size={13} />
                        <span>{isSavingMeasurements ? t('common.saving') : t('orders.save_measurements')}</span>
                      </button>
                    </div>
                  )}
                </div>

                {!isEditingMeasurements ? (
                  <div className="grid grid-cols-3 main-640:grid-cols-5 gap-2">
                    {measurementRows(selectedCustomer.measurements, true).map((row) => (
                      <div key={row.key} className="bg-surface p-2 rounded-xl border border-brand/10 text-center">
                        <p className="text-sm leading-5 text-content-muted font-bold break-words">{t(row.labelKey)}</p>
                        <p className="text-sm font-black text-brand">
                          {row.value
                            ? <><bdi dir="ltr" className="tabular-nums">{formatMeasurement(row.value, measurementUnit)}</bdi> <span className="text-sm text-content-muted font-bold">{t(unitLabelKey(measurementUnit))}</span></>
                            : '-'}
                        </p>
                        {row.note && <p className="mt-0.5 text-sm text-content-muted break-words">{row.note}</p>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <ThobeMeasurementSelector
                      values={tempMeasurements}
                      onChange={setTempMeasurements}
                      measurementUnit={measurementUnit}
                      fabricEstimate={{ settings: fabricEstimateSettings }}
                    />
                    <p className="text-sm font-bold text-content-muted pt-2 border-t border-brand/10">{t('orders.edit_style_details')}</p>
                    <VisualMeasurements
                      values={tempMeasurements as any}
                      onChange={(field, val) => setTempMeasurements((prev) => ({ ...prev, [field]: val }))}
                    />
                  </div>
                )}
              </div>
            )}

            {/* Items */}
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h4 className={cn(sectionLabelClass, "flex items-center gap-2")}>
                  <ShoppingBag size={16} />
                  {t('orders.required_items')}
                </h4>
                <button
                  type="button"
                  onClick={() => append(applyStylePrefs(newLine(), stylePrefill.prefs()))}
                  className="bg-brand/5 text-brand px-4 py-2 rounded-xl text-sm font-black hover:bg-brand/10 transition-all flex items-center gap-2"
                >
                  <Plus size={14} /> {t('orders.add_item')}
                </button>
              </div>

              {fields.map((field, index) => {
                const item = watchItems[index] || {};
                const itemErrors = (errors.items as any)?.[index];
                const fabric = lineFabric(item);
                const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
                const setQuantity = (next: number) =>
                  setValue(`items.${index}.quantity` as any, Math.max(1, Math.floor(next) || 1), { shouldValidate: true, shouldDirty: true });
                const unit = unitText(fabric.contentUnit);
                const inUnit = (meters: number) => fabricInContentUnit(meters, fabric.contentUnit);
                return (
                  <div key={field.id} className="grid grid-cols-1 main-720:grid-cols-4 gap-4 bg-surface-muted p-4 main-640:p-5 rounded-2xl relative border border-transparent hover:border-brand/10 transition-all">
                    <div className="space-y-1">
                      <label htmlFor={`order-item-${index}-type`} className={smallLabelClass}>{t('orders.item_type')}</label>
                      <input
                        id={`order-item-${index}-type`}
                        {...register(`items.${index}.garmentType` as any)}
                        aria-invalid={!!itemErrors?.garmentType}
                        className={cn(inputClass, itemErrors?.garmentType && "ring-2 ring-danger border-danger")}
                        placeholder={t(isLegacyVertical ? 'orders.item_type_placeholder' : 'orders.item_type_placeholder_generic')}
                      />
                    </div>

                    <div className="space-y-1" aria-invalid={!!itemErrors?.fabric}>
                      <label className={smallLabelClass}>{t('orders.fabric')}</label>
                      <SmartSelect
                        value={item.fabric === EXTERNAL_FABRIC ? EXTERNAL_FABRIC : (item.fabricId || '')}
                        onChange={(val) => {
                          const row = fabrics.find((f) => f.id === val);
                          setValue(`items.${index}.fabricId` as any, row ? row.id : '');
                          setValue(`items.${index}.fabric` as any, row ? row.name : (val === EXTERNAL_FABRIC ? EXTERNAL_FABRIC : ''), { shouldValidate: true, shouldDirty: true });
                          // A typed total belonged to the previous cloth.
                          setValue(`items.${index}.fabricManual` as any, false);
                          setValue(`items.${index}.consumedMeters` as any, 0);
                        }}
                        className={cn("w-full bg-surface rounded-xl shadow-sm", itemErrors?.fabric && "ring-2 ring-danger")}
                        options={fabricOptions}
                      />
                    </div>

                    <div className="space-y-1">
                      <label htmlFor={`order-item-${index}-qty`} className={smallLabelClass}>{t('orders.quantity_pieces')}</label>
                      <div className="flex items-stretch gap-1">
                        <button
                          type="button"
                          onClick={() => setQuantity(quantity - 1)}
                          disabled={quantity <= 1}
                          aria-label={t('orders.decrease_quantity')}
                          className="w-11 shrink-0 rounded-xl border border-border bg-surface text-content flex items-center justify-center hover:border-brand/40 disabled:opacity-40"
                        >
                          <Minus size={16} />
                        </button>
                        <input
                          id={`order-item-${index}-qty`}
                          type="number"
                          min="1"
                          step="1"
                          inputMode="numeric"
                          value={item.quantity ?? ''}
                          onChange={(e) => {
                            // Whole pieces only: anything after a decimal point is dropped.
                            const digits = e.target.value.replace(/[.,].*$/, '').replace(/\D/g, '');
                            setValue(`items.${index}.quantity` as any, digits === '' ? '' : Number(digits), { shouldValidate: true, shouldDirty: true });
                          }}
                          onBlur={() => setQuantity(Number(item.quantity))}
                          aria-invalid={!!itemErrors?.quantity}
                          className={cn(inputClass, "text-center font-black", itemErrors?.quantity && "ring-2 ring-danger border-danger")}
                        />
                        <button
                          type="button"
                          onClick={() => setQuantity(quantity + 1)}
                          aria-label={t('orders.increase_quantity')}
                          className="w-11 shrink-0 rounded-xl border border-border bg-surface text-content flex items-center justify-center hover:border-brand/40"
                        >
                          <Plus size={16} />
                        </button>
                      </div>
                    </div>

                    <div className="space-y-1">
                      <label htmlFor={`order-item-${index}-price`} className={smallLabelClass}>{t('orders.piece_price')}</label>
                      <input
                        id={`order-item-${index}-price`}
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        {...register(`items.${index}.price` as any)}
                        aria-invalid={!!itemErrors?.price}
                        className={cn(inputClass, itemErrors?.price && "ring-2 ring-danger border-danger")}
                      />
                    </div>

                    {/* Fabric for the line */}
                    {capabilities.fabric_consumption && fabric.hasFabric && (
                      <div className="main-720:col-span-4 rounded-xl border border-brand/15 bg-surface px-3 py-2 flex flex-wrap items-center gap-x-4 gap-y-2">
                        <p className="text-sm font-bold text-content flex-1 min-w-[220px]" role="status">
                          {fabric.perPieceMeters === null ? (
                            <span className="text-sm text-content-muted">
                              {estimatesFabricFromMeasurements
                                ? t('measurements.fabric_estimate_missing')
                                : t('orders.fabric_enter_manually', 'أدخل الأمتار المستهلكة لهذا الصنف يدوياً')}
                            </span>
                          ) : (
                            <>
                              {t('orders.fabric_line', {
                                perPiece: inUnit(fabric.perPieceMeters).toFixed(2),
                                count: quantity,
                                total: inUnit(fabric.computedMeters ?? 0).toFixed(2),
                                unit,
                              })}
                              {fabric.contentUnit === 'yard' && (
                                <span className="text-content-muted"> {t('orders.fabric_line_in_meters', { meters: (fabric.computedMeters ?? 0).toFixed(2) })}</span>
                              )}
                            </>
                          )}
                        </p>
                        {fabric.isExternal ? (
                          <p className="text-sm font-bold text-content-muted">{t('orders.fabric_external_note')}</p>
                        ) : (
                          <div className="flex items-center gap-2">
                            <label htmlFor={`order-item-${index}-fabric-total`} className="text-sm font-bold text-content-muted">
                              {t('orders.fabric_total_label', { unit })}
                            </label>
                            <FabricTotalInput
                              id={`order-item-${index}-fabric-total`}
                              value={fabric.totalMeters === null ? null : inUnit(fabric.totalMeters)}
                              onCommit={(value) => {
                                setValue(`items.${index}.consumedMeters` as any, fabricFromContentUnit(value, fabric.contentUnit), { shouldDirty: true });
                                setValue(`items.${index}.fabricManual` as any, true, { shouldDirty: true });
                              }}
                            />
                            {fabric.isManual && (
                              <>
                                <span className="text-sm font-black text-warning bg-[var(--seen-warning-bg)] border border-warning/20 rounded-lg px-2 py-1">
                                  {t('orders.fabric_manual_badge')}
                                </span>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setValue(`items.${index}.fabricManual` as any, false, { shouldDirty: true });
                                    setValue(`items.${index}.consumedMeters` as any, 0);
                                  }}
                                  className="text-sm font-bold text-brand flex items-center gap-1 hover:underline"
                                >
                                  <RotateCcw size={13} /> {t('orders.fabric_reset')}
                                </button>
                              </>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {isLegacyVertical ? (
                      <div className="main-720:col-span-4 pt-4 border-t border-border space-y-4">
                        <VisualMeasurements
                          values={item}
                          onChange={(key, val) => setValue(`items.${index}.${key}` as any, val)}
                        />
                        <div className="grid grid-cols-1 main-720:grid-cols-2 gap-4">
                          <div className="space-y-1">
                            <label htmlFor={`order-item-${index}-additions`} className={smallLabelClass}>{t('orders.other_additions')}</label>
                            <input id={`order-item-${index}-additions`} {...register(`items.${index}.additions` as any)} placeholder={t('orders.other_additions_placeholder')} className={inputClass} />
                          </div>
                          <div className="space-y-1">
                            <label htmlFor={`order-item-${index}-embroidery`} className={smallLabelClass}>{t('orders.embroidery_label')}</label>
                            <input id={`order-item-${index}-embroidery`} {...register(`items.${index}.embroidery` as any)} placeholder={t('orders.embroidery_placeholder')} className={inputClass} />
                          </div>
                        </div>
                      </div>
                    ) : (
                      <DynamicOrderItemFields index={index} fields={orderItemFields} watch={watch} setValue={setValue} />
                    )}

                    {fields.length > 1 && (
                      <button
                        type="button"
                        onClick={() => remove(index)}
                        aria-label={t('common.delete')}
                        className="absolute -top-2 end-[-0.5rem] bg-danger text-white p-2 rounded-full shadow-lg hover:scale-110 transition-transform"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Money, notes, images */}
            <div className="grid grid-cols-1 main-720:grid-cols-2 gap-6">
              <div className="bg-brand text-white p-5 main-640:p-6 rounded-2xl space-y-4">
                {(tax.enabled || totals.discount > 0) && (
                  <div className="flex justify-between items-center text-sm border-b border-white/10 pb-2">
                    <span className="text-white/70 font-medium">{t('orders.subtotal')}</span>
                    <span className="font-bold"><PriceDisplay amount={totals.subtotal} /></span>
                  </div>
                )}
                {tax.enabled && (
                  <div className="flex justify-between items-center text-sm border-b border-white/10 pb-2">
                    <span className="text-white/70 font-medium">{t('orders.vat_label')} ({tax.vatRatePercentage}%)</span>
                    <span className="font-bold"><PriceDisplay amount={totals.vat} /></span>
                  </div>
                )}
                <div className="flex justify-between items-center">
                  <span className="text-white/90 font-black text-sm uppercase">{t('orders.grand_total')}</span>
                  <span className="text-3xl font-black"><PriceDisplay amount={totals.total} /></span>
                </div>

                {canDiscount && (
                  <div className="space-y-2">
                    <label htmlFor="order-discount" className="text-sm font-bold text-white/70 uppercase">{t('orders.discount_label')}</label>
                    <input
                      id="order-discount"
                      type="number"
                      min="0"
                      step="any"
                      inputMode="decimal"
                      {...register('discountAmount' as any)}
                      className="w-full bg-surface/10 border border-surface/20 rounded-xl p-3 font-black text-surface placeholder:text-surface/30 focus:ring-2 focus:ring-surface/40 outline-none"
                    />
                  </div>
                )}

                <div className="space-y-2">
                  <span className="text-sm font-bold text-white/70 uppercase">{t('orders.payment_method_label')}</span>
                  <div className="grid grid-cols-2 gap-2">
                    {PAYMENT_METHODS.map((method) => (
                      <button
                        key={method.id}
                        type="button"
                        aria-pressed={watch('paymentMethod' as any) === method.id}
                        onClick={() => setValue('paymentMethod' as any, method.id)}
                        className={cn(
                          "flex items-center gap-2 p-3 rounded-xl border-2 transition-all text-sm font-bold",
                          watch('paymentMethod' as any) === method.id ? "border-surface bg-surface text-brand" : "border-surface/20 bg-surface/10 text-surface"
                        )}
                      >
                        <method.icon size={16} />
                        {t(method.labelKey)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-2 pt-4 border-t border-white/10">
                  <label htmlFor="order-paid" className="text-sm font-bold text-white/70 uppercase">{t('orders.amount_paid')}</label>
                  <input
                    id="order-paid"
                    type="number"
                    min="0"
                    step="any"
                    inputMode="decimal"
                    {...register('paidAmount' as any)}
                    className="w-full bg-surface/10 border border-surface/20 rounded-xl p-3 font-black text-surface placeholder:text-surface/30 focus:ring-2 focus:ring-surface/40 outline-none"
                  />
                  <div className="flex justify-between text-sm font-bold pt-1">
                    <span className="text-white/80">{t('orders.remaining_label')}</span>
                    <span className="bg-danger px-2 py-0.5 rounded-lg"><PriceDisplay amount={totals.total - paidAmount} /></span>
                  </div>
                </div>
              </div>

              <div className="space-y-5">
                <div className="space-y-2">
                  <label htmlFor="order-notes" className={sectionLabelClass}>{t('orders.general_notes')}</label>
                  <div className="relative">
                    <textarea
                      id="order-notes"
                      {...register('notes' as any)}
                      placeholder={t('orders.additional_instructions')}
                      className={cn(inputClass, "h-28 resize-none pe-10")}
                    />
                    {voiceSupported && (
                      <div className="absolute top-2 end-2">
                        <VoiceMicButton onResult={(text) => setValue('notes' as any, [getValues('notes' as any), text].filter(Boolean).join(' '))} />
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className={cn(sectionLabelClass, "flex items-center gap-2")}>
                    <ImageIcon size={16} />
                    {t('orders.illustration_images')}
                  </h4>
                  <OrderImagesField
                    tenantId={tenantId}
                    orderId={orderIdRef.current}
                    value={images}
                    onChange={(next) => setValue('images' as any, next, { shouldDirty: true })}
                    onBusyChange={setImagesBusy}
                    onUploaded={(path) => { sessionUploadsRef.current.push(path); }}
                  />
                </div>

                {/* The whole strip toggles it: a 48px target (seen-responsive-layout-task.md Phase 5). */}
                <label htmlFor="order-is-test" className="flex min-h-12 cursor-pointer items-center gap-3 p-3 bg-warning/10 rounded-2xl border border-warning/20">
                  <input type="checkbox" id="order-is-test" {...register('isTest' as any)} className="w-5 h-5 text-brand border-border rounded focus:ring-brand" />
                  <span className="text-sm font-bold text-warning flex items-center gap-2">
                    <Zap size={16} aria-hidden="true" />
                    {t('common.test_data')}
                  </span>
                </label>
              </div>
            </div>
          </div>

          <div className="shrink-0 p-4 main-640:p-5 border-t border-border bg-surface flex flex-wrap items-center justify-between gap-4">
            <div>
              {Object.keys(errors).length > 0 && (
                <p className="text-sm text-danger font-bold flex items-center gap-1">
                  <AlertCircle size={14} />
                  {t('orders.fill_required_fields')}
                </p>
              )}
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={onClose} className="px-6 py-2.5 main-640:px-8 main-640:py-3 text-content-muted font-bold hover:text-content transition-colors text-sm main-640:text-base rounded-xl hover:bg-surface-muted">
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                disabled={isSubmitting || imagesBusy}
                className="bg-brand text-white px-8 py-2.5 main-640:px-12 main-640:py-3 rounded-xl font-bold hover:bg-brand/90 shadow-lg shadow-brand/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed text-sm main-640:text-base"
              >
                {imagesBusy ? t('orders.images.waiting_upload') : isSubmitting ? t('orders.saving') : t('orders.confirm_create_order')}
              </button>
            </div>
          </div>
        </form>
        )}
      </motion.div>

      {isQuickAddOpen && (
        <QuickAddCustomerModal
          tenantId={tenantId}
          onClose={() => setIsQuickAddOpen(false)}
          onAdded={(customer) => {
            setCustomers((prev) => [customer, ...prev]);
            setValue('customerId' as any, customer.id, { shouldValidate: true });
            setIsQuickAddOpen(false);
          }}
        />
      )}
    </div>
  );
}
