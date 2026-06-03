import React, { Fragment, useState } from 'react';
import { Combobox, Listbox, Transition } from '@headlessui/react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useTranslation } from 'react-i18next';

export interface SelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

interface SmartSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  name?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  error?: boolean;
}

export function SmartSelect({
  options,
  value,
  onChange,
  placeholder = 'اختر...',
  className,
  name,
  searchPlaceholder = 'ابحث...',
  disabled = false,
  error = false,
}: SmartSelectProps) {
  const { i18n } = useTranslation();
  const [query, setQuery] = useState('');
  const dir = i18n.language === 'en' ? 'ltr' : 'rtl';

  const selectedOption = options.find((opt) => String(opt.value) === String(value)) || null;

  // Use Combobox if > 10 options, otherwise Listbox
  const useCombobox = options.length > 10;

  const filteredOptions =
    query === ''
      ? options
      : options.filter((option) =>
          option.label.toLowerCase().includes(query.toLowerCase())
        );

  const containerClasses = 'relative w-full text-right';

  const buttonClasses = cn(
    'relative w-full cursor-default h-[var(--size-input-height)] rounded-[var(--radius-md)] border border-border dark:border-gray-800 bg-surface px-4 text-[var(--size-text-base)] font-semibold outline-none transition-all shadow-sm focus:border-brand focus:ring-2 focus:ring-brand/20',
    dir === 'rtl' ? 'text-right pr-4 pl-10' : 'text-left pl-4 pr-10',
    disabled && 'opacity-50 cursor-not-allowed bg-slate-50 dark:bg-gray-900',
    error && 'border-danger focus:border-danger focus:ring-2 focus:ring-danger/20',
    className
  );

  const popoverClasses = cn(
    'absolute left-0 right-0 z-[100] mt-1.5 max-h-64 overflow-y-auto rounded-xl bg-surface p-1.5 text-sm shadow-xl border border-border dark:border-gray-800 focus:outline-none scrollbar-hide',
    dir === 'rtl' ? 'text-right font-sans' : 'text-left font-sans'
  );

  const transitionProps = {
    leave: 'transition ease-in duration-100',
    leaveFrom: 'opacity-100 translate-y-0 scale-100',
    leaveTo: 'opacity-0 -translate-y-2 scale-95',
    enter: 'transition ease-out duration-150',
    enterFrom: 'opacity-0 -translate-y-2 scale-95',
    enterTo: 'opacity-100 translate-y-0 scale-100',
  };

  if (useCombobox) {
    return (
      <div className={containerClasses} dir={dir}>
        <Combobox value={selectedOption} onChange={(opt: SelectOption | null) => {
          if (opt !== null && opt !== undefined) {
             onChange(opt.value);
          }
        }} disabled={disabled} name={name}>
          <div className="relative">
            <Combobox.Input
              className={buttonClasses}
              displayValue={(opt: SelectOption) => opt?.label || ''}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={placeholder}
            />
            <Combobox.Button className={cn(
              "absolute inset-y-0 flex items-center transition-colors",
              dir === 'rtl' ? "left-4" : "right-4"
            )}>
              <ChevronDown className="h-4 w-4 text-gray-400 group-hover:text-brand" aria-hidden="true" />
            </Combobox.Button>
            <Transition as={Fragment} {...transitionProps} afterLeave={() => setQuery('')}>
              <Combobox.Options className={popoverClasses}>
                {filteredOptions.length === 0 && query !== '' ? (
                  <div className="relative cursor-default select-none py-3 px-4 text-content-muted text-xs font-bold">
                    {i18n.t('common.no_results', 'لا يوجد نتائج.')}
                  </div>
                ) : (
                  filteredOptions.map((option) => (
                    <Combobox.Option
                      key={option.value}
                      className={({ active }) =>
                        cn(
                          'relative cursor-default select-none py-2 px-3 rounded-lg transition-all mb-0.5 group/item flex items-center justify-between',
                          active ? 'bg-brand/10 text-brand' : 'text-content hover:bg-surface-muted dark:hover:bg-gray-800'
                        )
                      }
                      value={option}
                    >
                      {({ selected, active }) => (
                        <>
                          <span
                            className={cn(
                              'block truncate flex items-center gap-3 text-sm',
                              selected ? 'font-bold' : 'font-semibold'
                            )}
                          >
                            {option.icon && (
                              <span className={cn(
                                "w-4 h-4 flex items-center justify-center flex-shrink-0 transition-colors [&>svg]:w-4 [&>svg]:h-4",
                                selected ? "text-brand" : "text-gray-400 group-hover/item:text-brand"
                              )}>
                                {option.icon}
                              </span>
                            )}
                            {option.label}
                          </span>
                          {selected ? (
                            <span
                              className={cn(
                                'flex items-center',
                                dir === 'rtl' ? 'left-3' : 'right-3',
                                active ? 'text-brand' : 'text-brand'
                              )}
                            >
                              <Check className="h-4 w-4 text-brand" aria-hidden="true" />
                            </span>
                          ) : null}
                        </>
                      )}
                    </Combobox.Option>
                  ))
                )}
              </Combobox.Options>
            </Transition>
          </div>
        </Combobox>
      </div>
    );
  }

  // Fallback to Listbox for fewer items
  return (
    <div className={containerClasses} dir={dir}>
      <Listbox value={value} onChange={onChange} disabled={disabled} name={name}>
        <div className="relative group">
          <Listbox.Button className={buttonClasses}>
            <span className={cn('block truncate flex items-center gap-3 text-sm', !selectedOption && 'text-gray-400')}>
              {selectedOption?.icon && (
                <span className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-gray-400 group-hover:text-brand transition-colors [&>svg]:w-4 [&>svg]:h-4">
                  {selectedOption.icon}
                </span>
              )}
              {selectedOption ? selectedOption.label : placeholder}
            </span>
            <span className={cn(
              "pointer-events-none absolute inset-y-0 flex items-center transition-colors",
              dir === 'rtl' ? "left-4 px-1" : "right-4 px-1"
            )}>
              <ChevronDown className="h-4 w-4 text-gray-400 group-hover:text-brand" aria-hidden="true" />
            </span>
          </Listbox.Button>
          <Transition as={Fragment} {...transitionProps}>
            <Listbox.Options className={popoverClasses}>
              {options.map((option) => (
                <Listbox.Option
                   key={option.value}
                   className={({ active }) =>
                     cn(
                       'relative cursor-default select-none py-2 px-3 rounded-lg transition-all mb-0.5 group/item flex items-center justify-between',
                       active ? 'bg-brand/10 text-brand' : 'text-content hover:bg-surface-muted dark:hover:bg-gray-800'
                     )
                   }
                   value={option.value}
                >
                  {({ selected, active }) => (
                    <>
                      <span
                        className={cn(
                          'block truncate flex items-center gap-3 text-sm',
                          selected ? 'font-bold' : 'font-semibold'
                        )}
                      >
                        {option.icon && (
                          <span className={cn(
                            "w-4 h-4 flex items-center justify-center flex-shrink-0 transition-colors [&>svg]:w-4 [&>svg]:h-4",
                            selected ? "text-brand" : "text-gray-400 group-hover/item:text-brand"
                          )}>
                            {option.icon}
                          </span>
                        )}
                        {option.label}
                      </span>
                      {selected ? (
                        <span
                          className={cn(
                            'flex items-center',
                            dir === 'rtl' ? 'left-3' : 'right-3',
                            active ? 'text-brand' : 'text-brand'
                          )}
                        >
                          <Check className="h-4 w-4 text-brand" aria-hidden="true" />
                        </span>
                      ) : null}
                    </>
                  )}
                </Listbox.Option>
              ))}
            </Listbox.Options>
          </Transition>
        </div>
      </Listbox>
    </div>
  );
}

export default SmartSelect;
