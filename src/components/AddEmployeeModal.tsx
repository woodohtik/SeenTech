import React, { useState, forwardRef, Fragment } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { User, Mail, Smartphone, Shield, X, Lock, Eye, EyeOff, ChevronDown, Briefcase, Store, Hash, Check } from 'lucide-react';
import { useForm, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { cn } from '../lib/utils';
import { Role, Branch } from '../types';
import { supabase } from '../lib/supabase/client';
import { getAuth, createUserWithEmailAndPassword } from 'firebase/auth';
import { initializeApp, deleteApp } from 'firebase/app';
import { finalConfig } from '../lib/firebase';
import { generateSecurePin, hashPin } from '../services/staffService';
import { Listbox, Transition } from '@headlessui/react';

const IconInput = forwardRef<HTMLInputElement, any>(({ icon: Icon, error, type = 'text', rightElement, dir, className, ...props }, ref) => {
  return (
    <div className={cn(
      "flex items-center overflow-hidden border rounded-2xl bg-surface-muted transition-all focus-within:ring-2 focus-within:border-brand",
      error ? "border-red-500 ring-red-500/20" : "border-border"
    )}>
      {Icon && (
        <div className="flex items-center justify-center px-4 py-4 border-e border-border bg-surface/50 text-content-muted">
          <Icon size={20} />
        </div>
      )}
      <input 
        ref={ref}
        type={type}
        dir={dir}
        className={cn(
          "flex-1 bg-transparent py-4 px-4 font-bold outline-none text-content placeholder:text-content-muted/50 w-full",
          className
        )}
        {...props}
      />
      {rightElement && (
        <div className="border-s border-border bg-surface/50 flex">
          {rightElement}
        </div>
      )}
    </div>
  );
});

const PasswordInput = forwardRef<HTMLInputElement, any>(({ error, ...props }, ref) => {
  const [show, setShow] = useState(false);
  return (
    <IconInput
      ref={ref}
      type={show ? 'text' : 'password'}
      icon={Lock}
      error={error}
      rightElement={
        <button
          type="button"
          onClick={() => setShow(!show)}
          className="px-4 py-4 flex items-center justify-center text-content-muted hover:text-content hover:bg-surface transition-colors"
        >
          {show ? <EyeOff size={20} /> : <Eye size={20} />}
        </button>
      }
      {...props}
    />
  );
});

const IconSelect = forwardRef<any, any>(({ icon: Icon, error, options, value, onChange, name, ...props }, ref) => {
  const selectedOption = options.find((opt: any) => String(opt.value) === String(value));
  
  return (
    <Listbox value={value} onChange={onChange} name={name}>
      {({ open }) => (
        <div className={cn(
          "flex items-center overflow-visible border rounded-2xl bg-surface-muted transition-all focus-within:ring-2 focus-within:border-brand",
          open ? "ring-2 border-brand" : (error ? "border-red-500 ring-red-500/20" : "border-border")
        )}>
          {Icon && (
            <div className="flex items-center justify-center px-4 py-4 border-e border-border bg-surface/50 text-content-muted rounded-s-2xl">
              <Icon size={20} />
            </div>
          )}
          <div className="relative flex-1">
            <Listbox.Button className="w-full text-start bg-transparent py-4 ps-4 pe-10 font-bold outline-none text-content truncate cursor-pointer">
              <span className={cn("block truncate", !selectedOption?.value && "text-content-muted")}>
                {selectedOption ? selectedOption.label : 'اختر...'}
              </span>
              <span className="absolute inset-y-0 end-0 flex items-center justify-center pe-4 pointer-events-none text-content-muted">
                <ChevronDown size={20} className={cn("transition-transform duration-200", open && "rotate-180")} />
              </span>
            </Listbox.Button>
            
            <Transition
              as={Fragment}
              leave="transition ease-in duration-100"
              leaveFrom="opacity-100"
              leaveTo="opacity-0"
            >
              <Listbox.Options className="absolute z-[200] mt-1 max-h-60 w-full overflow-auto rounded-xl bg-surface p-2 text-base shadow-2xl border border-border focus:outline-none sm:text-sm">
                {options.map((opt: any, index: number) => {
                  if (!opt.value) return null; // skip placeholder option
                  return (
                    <Listbox.Option
                      key={index}
                      className={({ active }) =>
                        cn(
                          'relative cursor-pointer select-none py-3 ps-10 pe-4 rounded-lg transition-colors font-bold',
                          active ? 'bg-brand/10 text-brand' : 'text-content hover:bg-surface-muted'
                        )
                      }
                      value={opt.value}
                    >
                      {({ selected, active }) => (
                        <>
                          <span className={cn('block truncate', selected ? 'font-black text-brand' : '')}>
                            {opt.label}
                          </span>
                          {selected ? (
                            <span
                              className={cn(
                                'absolute inset-y-0 start-0 flex items-center ps-3',
                                active ? 'text-brand' : 'text-brand'
                              )}
                            >
                              <Check className="h-5 w-5" aria-hidden="true" />
                            </span>
                          ) : null}
                        </>
                      )}
                    </Listbox.Option>
                  );
                })}
              </Listbox.Options>
            </Transition>
          </div>
        </div>
      )}
    </Listbox>
  );
});

const phoneRegex = /^(\+?\d{1,3}[- ]?)?\d{10}$/;

const baseStaffSchema = z.object({
  name: z.string().min(2, "الاسم يجب أن يكون حرفين على الأقل"),
  email: z.string().email("البريد الإلكتروني غير صحيح"),
  phone: z.string().regex(phoneRegex, "رقم الهاتف غير صحيح"),
  role: z.string().min(1, "هذا الحقل مطلوب"),
  branchId: z.string().min(1, "هذا الحقل مطلوب"),
  pin: z.string().length(4, "يجب أن يكون 4 أرقام").regex(/^\d+$/, "أرقام فقط").optional().or(z.literal('')),
  password: z.string().min(6, "كلمة المرور يجب أن تكون 6 أحرف على الأقل"),
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
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [enablePin, setEnablePin] = useState(false);

  const { register, handleSubmit, control, formState: { errors }, reset } = useForm({
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
        setErrorMsg('يرجى إدخال كلمة مرور صالحة (6 أحرف على الأقل)');
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
          setErrorMsg('هذا البريد الإلكتروني مستخدم مسبقاً لموظف آخر في هذا المحل');
          setIsSubmitting(false);
          return;
        }
      }

      // 2. Create or find Auth User
      let uid = '';
      let secondaryApp: any;
      try {
        // Try to create the user using a secondary app
        secondaryApp = initializeApp(finalConfig, "SecondaryApp" + Date.now());
        const secondaryAuth = getAuth(secondaryApp);
        
        const userCredential = await createUserWithEmailAndPassword(
          secondaryAuth,
          data.email.toLowerCase(),
          data.password
        );
        
        uid = userCredential.user.uid;
        await secondaryAuth.signOut();
      } catch (authErr: any) {
        if (authErr.code === 'auth/email-already-in-use') {
          if (existingStaff && existingStaff.length > 0) {
            const staffWithUid = existingStaff.find(s => s.uid);
            if (staffWithUid) {
              uid = staffWithUid.uid;
            }
          }
          
          if (!uid) {
            // Fallback to query users table directly if not found in staff
            const { data: userRow } = await supabase.from('users').select('id').eq('email', data.email.toLowerCase()).maybeSingle();
            if (userRow) uid = userRow.id;
          }

          if (!uid) {
             setErrorMsg('البريد مستخدم في نظام المصادقة ولكن تعذر الحصول على هويته. قد يكون الحساب غير مكتمل التسجيل.');
             setIsSubmitting(false);
             return;
          }
        } else {
          throw authErr;
        }
      } finally {
        if (secondaryApp) {
          try { await deleteApp(secondaryApp); } catch(e) {}
        }
      }

      // Ensure user exists in users table
      if (uid) {
         await supabase.from('users').upsert({ id: uid, email: data.email.toLowerCase(), full_name: data.name }, { onConflict: 'id' });
      }

      // 3. Prepare PIN
      let finalPin = null;
      let hashedPin = null;
      if (enablePin && data.pin && data.pin.length === 4) {
        finalPin = data.pin;
        hashedPin = await hashPin(data.pin);
      }

      // 4. Insert Staff Record
      const VALID_DB_ROLES = [
        'super_admin', 'support_tech', 'billing_admin', 'owner', 'admin', 'manager', 
        'cashier', 'tailor', 'accountant', 'branch_manager', 'warehouse_manager'
      ];
      const dbRoleValue = VALID_DB_ROLES.includes(data.role) ? data.role : 'tailor';
      const selectedRole = roles.find(r => r.roleKey === data.role);

      const { error: insertErr } = await supabase.from('staff').insert({
        uid: uid,
        name: data.name,
        role: dbRoleValue,
        role_id: selectedRole?.id || '',
        branch_id: data.branchId,
        email: data.email.toLowerCase(),
        phone: data.phone,
        status: 'active',
        is_test: false,
        pin_hash: hashedPin,
        must_change_pin: false,
        tenant_id: tenantId,
        created_at: new Date().toISOString()
      });

      if (insertErr) throw insertErr;

      // Audit Log
      await supabase.from('audit_logs').insert({
        action: 'إضافة موظف',
        performed_by: currentStaffName || 'المدير',
        performed_by_email: currentStaffEmail || 'unknown',
        target_tenant_id: tenantId,
        details: `تم إضافة الموظف ${data.name} بنجاح`,
        timestamp: new Date().toISOString(),
        type: 'security'
      });

      reset();
      setEnablePin(false);
      onSuccess();

    } catch (error: any) {
      console.error('Error adding employee:', error);
      setErrorMsg(error.message || 'حدث خطأ غير متوقع. يرجى المحاولة مرة أخرى.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[150] flex items-center justify-center p-4 sm:p-6" dir="rtl">
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
          <h2 className="text-xl font-black text-content">إضافة موظف جديد</h2>
          <button onClick={onClose} className="p-2 hover:bg-surface rounded-full transition-colors shadow-sm">
            <X size={24} className="text-content-muted" />
          </button>
        </div>
        
        <form onSubmit={handleSubmit(onSubmit)} className="p-8 space-y-6">
          {errorMsg && (
            <div className="p-4 bg-red-50 text-red-600 rounded-2xl border border-red-200 font-bold text-sm">
              {errorMsg}
            </div>
          )}

          <div className="space-y-2">
            <label className="text-xs font-black text-content-muted uppercase tracking-widest">الاسم الكامل</label>
            <IconInput 
              {...register('name')}
              icon={User}
              error={errors.name}
            />
            {errors.name && <p className="text-xs text-red-500 font-bold">{errors.name.message as string}</p>}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black text-content-muted uppercase tracking-widest">الدور الوظيفي</label>
            <Controller
              name="role"
              control={control}
              render={({ field }) => (
                <IconSelect 
                  {...field}
                  icon={Briefcase}
                  error={errors.role}
                  options={[
                    { value: '', label: 'اختر الدور...' },
                    ...roles.map(role => ({ value: role.roleKey, label: role.name }))
                  ]}
                />
              )}
            />
            {errors.role && <p className="text-xs text-red-500 font-bold">{errors.role.message as string}</p>}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black text-content-muted uppercase tracking-widest">الفرع</label>
            <Controller
              name="branchId"
              control={control}
              render={({ field }) => (
                <IconSelect 
                  {...field}
                  icon={Store}
                  error={errors.branchId}
                  options={[
                    { value: '', label: 'اختر الفرع...' },
                    ...branches.map(branch => ({ value: branch.id, label: branch.name }))
                  ]}
                />
              )}
            />
            {errors.branchId && <p className="text-xs text-red-500 font-bold">{errors.branchId.message as string}</p>}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black text-content-muted uppercase tracking-widest">البريد الإلكتروني (إجباري)</label>
            <IconInput 
              {...register('email')}
              icon={Mail}
              error={errors.email}
              dir="ltr"
              placeholder="user@example.com"
            />
            {errors.email && <p className="text-xs text-red-500 font-bold">{errors.email.message as string}</p>}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black text-content-muted uppercase tracking-widest">كلمة المرور (إجباري)</label>
            <PasswordInput 
              {...register('password')}
              error={errors.password}
              dir="ltr"
              placeholder="••••••••"
            />
            {errors.password && <p className="text-xs text-red-500 font-bold">{errors.password.message as string}</p>}
          </div>

          <div className="space-y-2">
            <label className="text-xs font-black text-content-muted uppercase tracking-widest">رقم الهاتف</label>
            <IconInput 
              {...register('phone')}
              icon={Smartphone}
              error={errors.phone}
              dir="ltr"
              placeholder="+966500000000"
            />
            {errors.phone && <p className="text-xs text-red-500 font-bold">{errors.phone.message as string}</p>}
          </div>

          <div className="p-4 bg-surface-muted rounded-2xl space-y-4">
            <div className="flex items-center justify-between">
              <label className="text-sm font-bold text-content cursor-pointer select-none" onClick={() => setEnablePin(!enablePin)}>
                تعيين رمز دخول سريع للموظف
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
                    enablePin ? "-translate-x-6" : "-translate-x-1"
                  )}
                />
              </button>
            </div>

            {enablePin && (
              <div className="space-y-2 pt-2 border-t border-border">
                <label className="text-xs font-black text-content-muted uppercase tracking-widest">رمز الدخول (4 أرقام)</label>
                <IconInput 
                  {...register('pin')}
                  type="password"
                  icon={Shield}
                  error={errors.pin}
                  maxLength={4}
                  placeholder="****"
                  className="tracking-[1em]"
                />
                {errors.pin && <p className="text-xs text-red-500 font-bold">{errors.pin.message as string}</p>}
              </div>
            )}
          </div>

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
                <span>جاري الحفظ...</span>
              </>
            ) : (
              'تأكيد الإضافة'
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
}
