import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { User, Mail, Smartphone, X, Store, Key } from 'lucide-react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Role, Branch } from '../types';
import { cn } from '../lib/utils';
import { supabase } from '../lib/supabase/client';
import { useAuth } from '../contexts/AuthContext';
import { generateSecurePin, hashPin } from '../services/staffService';
import { useDirection } from '../lib/direction';
import { getFriendlyErrorMessage } from '../lib/appErrors';
import { IconInput } from './ui/IconInput';
import { VoiceMicButton } from './ui/VoiceMicButton';
import { isSpeechRecognitionSupported } from '../hooks/useSpeechRecognition';
import { PasswordInput } from './ui/PasswordInput';
import { SmartSelect } from './ui/SmartSelect';
import { staffRoleForSave } from '../services/permissionService';
import { UserFacingError } from '../lib/userFacingError';

const phoneRegex = /^(\+?\d{1,3}[- ]?)?\d{10}$/;

const baseStaffSchema = z.object({
  // Messages are i18n keys, translated at the render site so they follow language changes.
  name: z.string().min(2, "validation.name_min_two_chars"),
  email: z.string().email("validation.invalid_email"),
  phone: z.string().regex(phoneRegex, "validation.phone_format"),
  role: z.string().min(1, "validation.required"),
  branchId: z.string().min(1, "validation.required"),
  pin: z.string().length(4, "validation.pin_four_digits").regex(/^\d+$/, "validation.digits_only").optional().or(z.literal('')),
  password: z.string().min(6, "saas.password_too_short"),
});

interface AddEmployeeModalProps {
  isOpen: boolean;
  onClose: () => void;
  tenantId: string;
  roles: Role[];
  branches: Branch[];
  onSuccess: () => void;
  currentStaffName?: string;
  currentStaffEmail?: string;
}

export default function AddEmployeeModal({ 
  isOpen, 
  onClose, 
  tenantId, 
  roles, 
  branches, 
  onSuccess,
  currentStaffName,
  currentStaffEmail
}: AddEmployeeModalProps) {
  const { t, dir } = useDirection();
  // Unsupported browsers render VoiceMicButton as null -- without this
  // gate, IconInput's endIcon would still count as present and show a
  // blank bordered icon box where none existed before voice input.
  const voiceSupported = isSpeechRecognitionSupported();
  const { user: currentAuthUser } = useAuth();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const errorRef = useRef<HTMLDivElement>(null);
  // The message sits by the save button; bring it into view when it appears.
  useEffect(() => { if (errorMsg) errorRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [errorMsg]);
  const [enablePin, setEnablePin] = useState(false);

  const { register, handleSubmit, control, formState: { errors }, reset, setValue } = useForm({
    resolver: zodResolver(baseStaffSchema),
    defaultValues: {
      name: '',
      email: '',
      phone: '',
      role: '',
      branchId: '',
      pin: '',
      password: '',
    }
  });

  const onSubmit = async (data: any) => {
    setIsSubmitting(true);
    setErrorMsg('');
    try {
      if (!data.password || data.password.length < 6) {
        setErrorMsg(t('staff.password_invalid'));
        setIsSubmitting(false);
        return;
      }

      // 1. Multi-tenant Email Validation
      // Check if email exists in staff table
      const { data: existingStaff, error: checkErr } = await supabase
        .from('staff')
        .select('id, tenant_id, uid')
        .eq('email', data.email.toLowerCase());

      if (checkErr) throw checkErr;

      if (existingStaff && existingStaff.length > 0) {
        // Condition 1: Same tenant
        const sameTenant = existingStaff.find(s => s.tenant_id === tenantId);
        if (sameTenant) {
          setErrorMsg(t('staff.email_already_used_in_shop'));
          setIsSubmitting(false);
          return;
        }
      }

      // seen-merchant-trial-test-2026-11-26.md: never the person's own sign-in
      // (the browser fills this form with the owner's email and password).
      const ownEmails = [currentAuthUser?.email, currentStaffEmail].filter(Boolean).map((e) => String(e).toLowerCase());
      if (ownEmails.includes(data.email.toLowerCase())) {
        setErrorMsg(t('staff.own_email_not_allowed'));
        setIsSubmitting(false);
        return;
      }

      let hashedPin = null;
      if (enablePin && data.pin && data.pin.length === 4) {
        hashedPin = await hashPin(data.pin);
      }

      const VALID_DB_ROLES = [
        'super_admin', 'support_tech', 'billing_admin', 'owner', 'admin', 'manager',
        'cashier', 'tailor', 'accountant', 'branch_manager', 'warehouse_manager'
      ];
      const dbRoleValue = VALID_DB_ROLES.includes(data.role) ? data.role : staffRoleForSave(data.role, roles.find(r => r.roleKey === data.role) as any);
      const selectedRole = roles.find(r => r.roleKey === data.role);
      const isUuid = (val: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);
      const validRoleId = selectedRole?.id && isUuid(selectedRole.id) ? selectedRole.id : null;

      // One request: the server makes the sign-in account, the users row and
      // the staff row together, and undoes the account if anything fails --
      // the browser can't write another person's users row (that 403 left a
      // half-made account and "email already used" on the next try).
      const { data: { session } } = await supabase.auth.getSession();
      const createRes = await fetch('/api/staff/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`,
        },
        body: JSON.stringify({
          email: data.email.toLowerCase(),
          password: data.password,
          name: data.name,
          phone: data.phone,
          role: dbRoleValue,
          roleId: validRoleId,
          branchId: data.branchId || null,
          pinHash: hashedPin,
        })
      });
      const createResult = await createRes.json().catch(() => ({}));
      if (!createRes.ok) {
        setErrorMsg(createRes.status === 409
          ? t('staff.email_belongs_to_another_account')
          : createRes.status === 403
            ? t('staff.no_permission_to_add')
            : getFriendlyErrorMessage(new UserFacingError(createResult?.kind === 'validation' ? 'validation' : createResult?.kind === 'rate_limited' ? 'rate_limited' : 'server')));
        setIsSubmitting(false);
        return;
      }

      reset();
      setEnablePin(false);
      onSuccess();

    } catch (error: any) {
      console.error('Error adding employee:', JSON.stringify(error));
      setErrorMsg(getFriendlyErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 main-640:p-6" dir={dir}>
      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
      />
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="bg-surface rounded-3xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto relative z-10 border border-border"
      >
        <div className="p-6 border-b border-border flex justify-between items-center bg-surface-muted">
          <h2 className="text-xl font-black text-content">{t('saas.add_member_new')}</h2>
          <button aria-label={t('common.close')} onClick={onClose} className="p-2 hover:bg-surface rounded-full transition-colors shadow-sm min-w-11 min-h-11 inline-flex items-center justify-center">
            <X size={24} className="text-content-muted" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit(onSubmit)} autoComplete="off" className="p-8 space-y-6">

          <IconInput
            {...register('name')}
            label={t('common.full_name')}
            startIcon={User}
            error={errors.name?.message ? t(errors.name.message as string) : undefined}
            endIcon={voiceSupported ? <VoiceMicButton onResult={(text) => setValue('name', text)} /> : undefined}
          />

          <div className="space-y-1.5">
            <label className="block text-sm font-black uppercase px-1 text-content-muted">{t('staff.job_role')}</label>
            <Controller
              name="role"
              control={control}
              render={({ field }) => (
                <SmartSelect
                  value={field.value}
                  onChange={field.onChange}
                  startIcon={User}
                  error={!!errors.role}
                  options={[
                    { value: '', label: t('common.select_role') },
                    ...roles.map(role => ({ value: role.roleKey, label: role.name }))
                  ]}
                />
              )}
            />
            {errors.role && <p className="text-sm text-danger font-bold px-1">{t(errors.role.message as string)}</p>}
          </div>

          <div className="space-y-1.5">
            <label className="block text-sm font-black uppercase px-1 text-content-muted">{t('common.branch')}</label>
            <Controller
              name="branchId"
              control={control}
              render={({ field }) => (
                <SmartSelect
                  value={field.value}
                  onChange={field.onChange}
                  startIcon={Store}
                  error={!!errors.branchId}
                  options={[
                    { value: '', label: t('common.select_branch') },
                    ...branches.map(branch => ({ value: branch.id, label: branch.name }))
                  ]}
                />
              )}
            />
            {errors.branchId && <p className="text-sm text-danger font-bold px-1">{t(errors.branchId.message as string)}</p>}
          </div>

          <IconInput
            {...register('email')}
            // Not the person's own saved sign-in (seen-merchant-trial-test-2026-11-26.md).
            autoComplete="off"
            data-lpignore="true"
            label={t('staff.email_required_label')}
            startIcon={Mail}
            error={errors.email?.message ? t(errors.email.message as string) : undefined}
            dir="ltr"
            placeholder="user@example.com"
          />

          <PasswordInput
            {...register('password')}
            autoComplete="new-password"
            label={t('staff.password_required_label')}
            error={errors.password?.message ? t(errors.password.message as string) : undefined}
            dir="ltr"
            placeholder="••••••••"
          />

          <IconInput
            {...register('phone')}
            label={t('onboarding.fields.phone')}
            startIcon={Smartphone}
            error={errors.phone?.message ? t(errors.phone.message as string) : undefined}
            dir="ltr"
            placeholder="+966500000000"
          />

          <div className="p-4 bg-surface-muted rounded-2xl space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-bold text-content cursor-pointer select-none" onClick={() => setEnablePin(!enablePin)}>
                {t('staff.enable_quick_pin')}
              </label>
              <button
                type="button"
                role="switch"
                aria-checked={enablePin}
                onClick={() => setEnablePin(!enablePin)}
                className={cn(
                  "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                  enablePin ? "bg-brand" : "bg-content-muted/30"
                )}
              >
                <span
                  className={cn(
                    "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                    enablePin ? "-translate-x-6 rtl:translate-x-6" : "-translate-x-1 rtl:translate-x-1"
                  )}
                />
              </button>
            </div>

            {enablePin && (
              <div className="pt-2 border-t border-border">
                <IconInput
                  {...register('pin')}
                  type="password"
                  label={t('staff.pin_code_four_digits')}
                  startIcon={Key}
                  error={errors.pin?.message ? t(errors.pin.message as string) : undefined}
                  maxLength={4}
                  placeholder="****"
                  className="tracking-[1em]"
                />
              </div>
            )}
          </div>

          {errorMsg && (
            <div ref={errorRef} role="alert" className="p-4 bg-[var(--seen-danger-bg)] text-danger rounded-2xl border border-danger/20 font-bold text-sm">
              {errorMsg}
            </div>
          )}

          <button 
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-brand text-white py-4 rounded-2xl font-black hover:bg-brand/90 shadow-xl shadow-brand/10 transition-all hover:scale-105 active:scale-95 mt-4 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {isSubmitting ? (
              <>
                <svg className="animate-spin h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                <span>{t('common.saving')}</span>
              </>
            ) : (
              t('staff.confirm_add')
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
