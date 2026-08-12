import React from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Database } from '../../types/supabase';

// DB Type mapped to Form schema
type CustomerInsert = Database['public']['Tables']['customers']['Insert'];

const customerSchema = z.object({
  name: z.string().min(2, 'validation.customer_name_min'),
  phone: z.string().min(9, 'validation.mobile_too_short'),
  email: z.string().email('validation.email_not_valid').optional().or(z.literal('')),
  notes: z.string().optional()
});

type CustomerFormData = z.infer<typeof customerSchema>;

interface CustomerFormProps {
  initialData?: Partial<CustomerFormData>;
  onSubmit: (data: CustomerFormData) => void;
  isLoading?: boolean;
}

export function CustomerForm({ initialData, onSubmit, isLoading }: CustomerFormProps) {
  const { t } = useTranslation();
  const { register, handleSubmit, formState: { errors } } = useForm<CustomerFormData>({
    resolver: zodResolver(customerSchema),
    defaultValues: {
      name: initialData?.name || '',
      phone: initialData?.phone || '',
      email: initialData?.email || '',
      notes: initialData?.notes || ''
    },
  });

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6 max-w-lg bg-white p-6 rounded-lg shadow-sm border border-gray-200">
      <h2 className="text-xl font-bold text-gray-900 mb-4">{t('customers.form_title')}</h2>
      
      <div>
        <label className="block text-sm font-medium text-gray-700">{t('common.name')}</label>
        <input
          {...register('name')}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          placeholder={t('customers.name_placeholder')}
        />
        {errors.name && <p className="mt-1 text-sm text-red-600">{t(errors.name.message as string)}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">{t('customers.mobile')}</label>
        <input
          {...register('phone')}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          placeholder="0500000000"
        />
        {errors.phone && <p className="mt-1 text-sm text-red-600">{t(errors.phone.message as string)}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">{t('customers.email_optional')}</label>
        <input
          {...register('email')}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
          placeholder="test@example.com"
        />
        {errors.email && <p className="mt-1 text-sm text-red-600">{t(errors.email.message as string)}</p>}
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700">{t('customers.notes')}</label>
        <textarea
          {...register('notes')}
          rows={3}
          className="mt-1 block w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 sm:text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={isLoading}
        className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
      >
        {isLoading ? t('common.saving') : t('customers.save_customer')}
      </button>
    </form>
  );
}
