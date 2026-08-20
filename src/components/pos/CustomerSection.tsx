import React, { useState, Fragment } from 'react';
import { Customer } from '../../types/supabase';
import { formatSaudiPhone } from '../../utils/phoneUtils';
import { Search, Plus, UserPlus, Save, Loader2, X, Check, ChevronsUpDown } from 'lucide-react';
import { supabase } from '../../lib/supabase/client';
import { Combobox, Transition, Dialog } from '@headlessui/react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';
import { useDirection } from '../../lib/direction';
import { useToast } from '../../contexts/ToastContext';

interface CustomerSectionProps {
  tenantId: string;
  customers: Customer[];
  selectedCustomer: Customer | null;
  setSelectedCustomer: (c: Customer | null) => void;
  onCustomerAdded: () => void;
}

export default function CustomerSection({ 
  tenantId, 
  customers, 
  selectedCustomer, 
  setSelectedCustomer,
  onCustomerAdded
}: CustomerSectionProps) {
  const { t, dir } = useDirection();
  const { error: toastError } = useToast();
  const [query, setQuery] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isWorking, setIsWorking] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, boolean>>({});

  // New Customer Form
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const [newVat, setNewVat] = useState('');
  // Measurements
  const [length, setLength] = useState('');
  const [shoulder, setShoulder] = useState('');
  const [chest, setChest] = useState('');
  const [sleeve, setSleeve] = useState('');

  const filteredCustomers = query === ''
    ? customers
    : customers.filter((customer) => {
        return customer.name.toLowerCase().includes(query.toLowerCase()) || 
               customer.phone.includes(query);
      });

  const handleSaveCustomer = async () => {
    const missing: string[] = [];
    const errors: Record<string, boolean> = {};
    if (!newName.trim()) {
      errors.name = true;
      missing.push(t('pos.customer_name'));
    }
    if (!newPhone.trim()) {
      errors.phone = true;
      missing.push(t('login.phone'));
    }
    setFieldErrors(errors);
    if (missing.length > 0) {
      toastError(t('pos.missing_fields_prompt', { fields: missing.join(t('common.list_separator')) }));
      return;
    }

    setIsWorking(true);
    try {
      const newCustomer = {
        tenant_id: tenantId,
        name: newName,
        phone: formatSaudiPhone(newPhone),
        vat_number: newVat || undefined,
        measurements: {
          thobe: {
            length: length ? Number(length) : undefined,
            shoulder: shoulder ? Number(shoulder) : undefined,
            chest: chest ? Number(chest) : undefined,
            sleeve: sleeve ? Number(sleeve) : undefined,
          }
        },
        is_test: false
      };

      const { data, error } = await supabase
        .from('customers')
        .insert([newCustomer])
        .select()
        .single();

      if (error) throw error;

      setIsModalOpen(false);
      setNewName('');
      setNewPhone('');
      setNewVat('');
      setLength('');
      setShoulder('');
      setChest('');
      setSleeve('');
      setFieldErrors({});

      onCustomerAdded();
      if (data) setSelectedCustomer(data as Customer);
      
    } catch (error: any) {
      console.error('Error saving customer:', error);
      alert(t('pos.save_customer_failed', { error: error.message }));
    } finally {
      setIsWorking(false);
    }
  };

  return (
    <div className="bg-surface rounded-2xl shadow-sm border border-border p-5">
      <div className="flex items-center justify-between mb-5">
        <h2 className="text-lg font-bold text-content flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-brand/10 flex items-center justify-center">
            <UserPlus className="text-brand" size={18} />
          </div>
          {t('pos.customer_and_measurements')}
        </h2>
      </div>

      <div className="flex items-center gap-2">
        <div className="flex-1">
          <Combobox value={selectedCustomer} onChange={setSelectedCustomer}>
            <div className="relative mt-1">
              <div className="relative w-full cursor-default overflow-hidden rounded-xl bg-surface-muted border border-border text-right focus-within:ring-2 focus-within:ring-brand focus-within:border-brand transition-all">
                <Search className="absolute right-3 top-1/2 -translate-y-1/2 text-content-muted pointer-events-none" size={18} />
                <Combobox.Input
                  className="w-full border-none py-3 pl-10 pr-10 text-sm leading-5 text-content focus:ring-0 bg-transparent font-medium"
                  displayValue={(customer: Customer | null) => customer?.name || ''}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('pos.search_customer_placeholder')}
                  dir={dir}
                />
                <Combobox.Button className="absolute inset-y-0 left-0 flex items-center pr-2">
                  <ChevronsUpDown
                    className="h-5 w-5 text-content-muted"
                    aria-hidden="true"
                  />
                </Combobox.Button>
                {selectedCustomer && (
                  <button 
                    onClick={() => setSelectedCustomer(null)}
                    className="absolute left-8 top-1/2 -translate-y-1/2 text-content-muted hover:text-danger transition-colors"
                  >
                    <X size={16} />
                  </button>
                )}
              </div>
              <Transition
                as={Fragment}
                leave="transition ease-in duration-100"
                leaveFrom="opacity-100"
                leaveTo="opacity-0"
                afterLeave={() => setQuery('')}
              >
                <Combobox.Options className="absolute mt-2 max-h-60 w-full overflow-auto rounded-xl bg-surface py-1 text-base shadow-xl border border-border ring-1 ring-black/5 focus:outline-none sm:text-sm z-50 divide-y divide-surface-muted">
                  {filteredCustomers.length === 0 && query !== '' ? (
                    <div className="relative cursor-default select-none py-4 px-4 text-content-muted text-center">
                      {t('common.no_results')}
                    </div>
                  ) : (
                    filteredCustomers.map((customer) => (
                      <Combobox.Option
                        key={customer.id}
                        className={({ active }) =>
                          `relative cursor-default select-none py-3 px-4 ${
                            active ? 'bg-brand/10' : 'text-content'
                          }`
                        }
                        value={customer}
                      >
                        {({ selected, active }) => (
                          <div className="flex justify-between items-center">
                            <div className="flex flex-col text-right">
                              <span className={`block truncate text-base ${selected ? 'font-bold text-brand' : 'font-semibold'}`}>
                                {customer.name}
                              </span>
                              <span className={`block truncate text-xs ${active ? 'text-brand/70' : 'text-content-muted'}`}>
                                {customer.phone}
                              </span>
                            </div>
                            {selected && (
                              <span className="flex items-center pl-3 text-brand">
                                <Check className="h-5 w-5" aria-hidden="true" />
                              </span>
                            )}
                          </div>
                        )}
                      </Combobox.Option>
                    ))
                  )}
                </Combobox.Options>
              </Transition>
            </div>
          </Combobox>
        </div>

        <button 
          onClick={() => setIsModalOpen(true)}
          className="mt-1 h-12 w-12 flex items-center justify-center bg-brand text-white rounded-xl hover:bg-brand/90 transition-all shadow-sm shrink-0"
          title={t('pos.add_new_customer')}
        >
          <Plus size={24} />
        </button>
      </div>

      {/* Add Customer Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <Dialog
            static
            as={motion.div}
            open={isModalOpen}
            onClose={() => setIsModalOpen(false)}
            className="relative z-50"
          >
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/40 backdrop-blur-sm"
              aria-hidden="true"
            />

            <div className="fixed inset-0 flex items-center justify-center p-4">
              <Dialog.Panel
                as={motion.div}
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.95, y: 20 }}
                className="mx-auto max-w-xl w-full rounded-2xl bg-surface p-6 shadow-2xl border border-border"
                dir={dir}
              >
                <div className="flex justify-between items-center mb-6">
                  <Dialog.Title className="text-xl font-bold text-content">{t('pos.add_new_customer')}</Dialog.Title>
                  <button onClick={() => setIsModalOpen(false)} className="text-content-muted hover:text-danger p-1">
                    <X size={24} />
                  </button>
                </div>

                <div className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-1.5 md:col-span-2">
                      <label className="text-sm font-bold text-content">{t('pos.customer_name')} <span className="text-danger">*</span></label>
                      <input
                        type="text"
                        aria-invalid={fieldErrors.name}
                        value={newName}
                        onChange={e => {
                          setNewName(e.target.value);
                          if (fieldErrors.name) setFieldErrors({ ...fieldErrors, name: false });
                        }}
                        className={cn(
                          "w-full p-3 rounded-xl border border-border bg-surface-muted focus:bg-surface focus:border-brand focus:ring-1 focus:ring-brand outline-none transition-all text-content",
                          fieldErrors.name && "ring-2 ring-danger border-danger"
                        )}
                        placeholder={t('pos.enter_name_placeholder')}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-bold text-content">{t('login.phone')} <span className="text-danger">*</span></label>
                      <input
                        type="text"
                        aria-invalid={fieldErrors.phone}
                        value={newPhone}
                        onChange={e => {
                          setNewPhone(formatSaudiPhone(e.target.value));
                          if (fieldErrors.phone) setFieldErrors({ ...fieldErrors, phone: false });
                        }}
                        onBlur={e => setNewPhone(formatSaudiPhone(e.target.value))}
                        className={cn(
                          "w-full p-3 rounded-xl border border-border bg-surface-muted focus:bg-surface focus:border-brand focus:ring-1 focus:ring-brand outline-none transition-all text-content",
                          fieldErrors.phone && "ring-2 ring-danger border-danger"
                        )}
                        placeholder="05xxxxxxxx"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-sm font-bold text-content">{t('pos.vat_number')} <span className="text-content-muted font-normal">{t('pos.companies_only')}</span></label>
                      <input 
                        type="text" 
                        value={newVat} onChange={e => setNewVat(e.target.value)}
                        className="w-full p-3 rounded-xl border border-border bg-surface-muted focus:bg-surface focus:border-brand focus:ring-1 focus:ring-brand outline-none transition-all text-content" 
                        placeholder={t('pos.vat_number_placeholder')}
                      />
                    </div>
                  </div>

                  <div className="bg-surface-muted p-4 rounded-xl border border-border">
                    <h4 className="text-sm font-bold text-content mb-4 flex items-center gap-2">
                      <div className="w-1 h-4 bg-brand rounded-full" />
                      {t('measurements.record_optional')}
                    </h4>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-content-muted">{t('measurements.length')}</label>
                        <input type="number" value={length} onChange={e => setLength(e.target.value)} placeholder="0" className="w-full p-2.5 text-center rounded-lg border border-border bg-surface focus:border-brand outline-none text-content" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-content-muted">{t('measurements.shoulder')}</label>
                        <input type="number" value={shoulder} onChange={e => setShoulder(e.target.value)} placeholder="0" className="w-full p-2.5 text-center rounded-lg border border-border bg-surface focus:border-brand outline-none text-content" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-content-muted">{t('measurements.chest')}</label>
                        <input type="number" value={chest} onChange={e => setChest(e.target.value)} placeholder="0" className="w-full p-2.5 text-center rounded-lg border border-border bg-surface focus:border-brand outline-none text-content" />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs font-bold text-content-muted">{t('measurements.sleeve')}</label>
                        <input type="number" value={sleeve} onChange={e => setSleeve(e.target.value)} placeholder="0" className="w-full p-2.5 text-center rounded-lg border border-border bg-surface focus:border-brand outline-none text-content" />
                      </div>
                    </div>
                  </div>

                  <div className="flex gap-3 pt-2">
                    <button 
                      onClick={handleSaveCustomer}
                      disabled={isWorking}
                      className="flex-1 bg-brand text-white py-3.5 rounded-xl font-bold flex items-center justify-center gap-2 hover:bg-brand/90 transition-all disabled:opacity-50 shadow-md shadow-brand/20"
                    >
                      {isWorking ? <Loader2 size={18} className="animate-spin" /> : <Save size={18} />}
                      {t('pos.save_customer_and_start_order')}
                    </button>
                    <button 
                      onClick={() => setIsModalOpen(false)}
                      disabled={isWorking}
                      className="px-6 py-3.5 rounded-xl font-bold text-content-muted hover:bg-surface-muted transition-all"
                    >
                      {t('common.cancel')}
                    </button>
                  </div>
                </div>
              </Dialog.Panel>
            </div>
          </Dialog>
        )}
      </AnimatePresence>
    </div>
  );
}
