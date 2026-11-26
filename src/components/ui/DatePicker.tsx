import React, { useState, useRef, useEffect } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';
import { isRtlLang, localeOf } from '../../lib/direction';

interface DatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  id?: string;
  className?: string;
  /** Shown on the trigger button when no date is selected yet, e.g. "من" / "إلى". */
  placeholder?: string;
  /** Extra classes for the trigger button, e.g. to match a neighbouring field. */
  triggerClassName?: string;
  /** The earliest date that can be chosen (YYYY-MM-DD), e.g. today for a delivery date. */
  minDate?: string;
}

/** Today on this device, as YYYY-MM-DD (the picker's own format). */
export function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function DatePicker({ value, onChange, id, className, placeholder, triggerClassName, minDate }: DatePickerProps) {
  const { t, i18n } = useTranslation();
  // seen-readiness-fixes-task.md P4 (UX-07): Urdu is right-to-left too, and
  // the names of months and days come from the language, not two fixed lists.
  const isRtl = isRtlLang(i18n.language);
  const locale = localeOf(i18n.language);
  const [isOpen, setIsOpen] = useState(false);
  
  // Parse initial date or default to today
  const parsedDate = value ? new Date(value) : new Date();
  const [currentMonth, setCurrentMonth] = useState(new Date(parsedDate.getFullYear(), parsedDate.getMonth(), 1));
  
  const containerRef = useRef<HTMLDivElement>(null);

  // Close calendar when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false);
    };
    document.addEventListener('keydown', handleEscape);
    return () => document.removeEventListener('keydown', handleEscape);
  }, [isOpen]);

  const months = Array.from({ length: 12 }, (_, m) =>
    new Intl.DateTimeFormat(locale, { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, m, 1))));
  // 2026-11-01 is a Sunday: the week starts on Sunday, as before.
  const weekDays = Array.from({ length: 7 }, (_, d) =>
    // Arabic "short" names are whole words ("الخميسالجمعةالسبت" ran together in
    // seven columns); its one-letter form is the usual calendar header
    // (seen-merchant-trial-test-2026-11-26.md, phase 4). Urdu's one-letter form is
    // Latin, so it keeps its names, cut to fit.
    new Intl.DateTimeFormat(locale, { weekday: i18n.language.startsWith('ar') ? 'narrow' : 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2026, 10, 1 + d))));

  // Format selected date for display button
  const formatDisplayDate = (dateStr: string) => {
    if (!dateStr) return placeholder || t('common.date_picker.select_date');
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    
    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    
    return new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(date);
  };

  // Calendar generation helpers
  const year = currentMonth.getFullYear();
  const month = currentMonth.getMonth();
  
  const firstDayIndex = new Date(year, month, 1).getDay();
  const totalDays = new Date(year, month + 1, 0).getDate();
  
  const prevMonthTotalDays = new Date(year, month, 0).getDate();

  const daysArray: { day: number; isCurrentMonth: boolean; dateString: string }[] = [];

  // Previous month filler days
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const d = prevMonthTotalDays - i;
    const prevMonthDate = new Date(year, month - 1, d);
    daysArray.push({
      day: d,
      isCurrentMonth: false,
      dateString: formatDateString(prevMonthDate)
    });
  }

  // Current month days
  for (let d = 1; d <= totalDays; d++) {
    const currentDayDate = new Date(year, month, d);
    daysArray.push({
      day: d,
      isCurrentMonth: true,
      dateString: formatDateString(currentDayDate)
    });
  }

  // Next month filler days to complete 42 cells (6 rows of 7)
  const remainingCells = 42 - daysArray.length;
  for (let d = 1; d <= remainingCells; d++) {
    const nextMonthDate = new Date(year, month + 1, d);
    daysArray.push({
      day: d,
      isCurrentMonth: false,
      dateString: formatDateString(nextMonthDate)
    });
  }

  function formatDateString(date: Date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  const handlePrevMonth = () => {
    setCurrentMonth(new Date(year, month - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentMonth(new Date(year, month + 1, 1));
  };

  const isBeforeMin = (dateString: string) => !!minDate && dateString < minDate;
  const handleSelectDay = (dateString: string) => {
    if (isBeforeMin(dateString)) return;
    onChange(dateString);
    setIsOpen(false);
  };

  return (
    <div className={cn("relative inline-block w-full", className)} ref={containerRef}>
      {/* Hidden real input so automated query selectors matching `#report-date-input` or class still work.
          Not part of the accessibility tree -- the button below is the actual interactive control. */}
      <input
        type="hidden"
        id={id}
        aria-hidden="true"
        tabIndex={-1}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />

      {/* Button Trigger */}
      <button
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={formatDisplayDate(value)}
        onClick={() => {
          setIsOpen(!isOpen);
          // Set current view month to the parsed value month when opening
          if (value) {
            const d = new Date(value);
            if (!isNaN(d.getTime())) {
              setCurrentMonth(new Date(d.getFullYear(), d.getMonth(), 1));
            }
          }
        }}
        className={cn(
          "flex items-center gap-2.5 w-full bg-surface-muted/50 hover:bg-surface-muted/80 border border-border rounded-2xl px-4 h-12 text-sm font-bold text-content transition-all shadow-inner shadow-black/5 outline-none cursor-pointer text-right justify-between",
          triggerClassName,
          isOpen && "border-brand/40 bg-surface"
        )}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <CalendarIcon size={18} className="text-content-muted shrink-0" />
          <span className="truncate">{formatDisplayDate(value)}</span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          {value && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onChange('');
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.stopPropagation();
                  e.preventDefault();
                  onChange('');
                }
              }}
              title={t('common.date_picker.clear')}
              aria-label={t('common.date_picker.clear')}
              className="p-1 text-content-muted hover:text-danger hover:bg-danger/10 rounded-full transition-all cursor-pointer"
            >
              <X size={14} />
            </span>
          )}
          <span className="text-sm text-brand bg-brand/10 hover:bg-brand/20 transition-all rounded-lg px-2 py-0.5">
            {t('common.date_picker.change')}
          </span>
        </div>
      </button>

      {/* Popover Calendar Grid */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 10, scale: 0.95 }}
            animate={{ opacity: 1, y: 4, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.95 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className={cn(
              "absolute z-50 mt-1 w-[22rem] bg-surface border border-border shadow-xl rounded-2xl p-4 overflow-hidden focus:outline-none",
              isRtl ? "right-0" : "left-0"
            )}
            role="dialog"
            aria-label={`${months[month]} ${year}`}
          >
            {/* Header Controls */}
            <div className="flex items-center justify-between mb-4">
              {/* seen-merchant-trial-test-2026-11-26.md: the first button is always the
                  previous month -- on the right in Arabic, its arrow pointing right. */}
              <button
                type="button"
                onClick={handlePrevMonth}
                aria-label={t('common.date_picker.previous_month')}
                className="min-w-11 min-h-11 inline-flex items-center justify-center hover:bg-surface-muted rounded-xl text-content-muted hover:text-content transition-all outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                {isRtl ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
              </button>

              <span className="text-sm font-black text-content uppercase">
                {months[month]} {year}
              </span>

              <button
                type="button"
                onClick={handleNextMonth}
                aria-label={t('common.date_picker.next_month')}
                className="min-w-11 min-h-11 inline-flex items-center justify-center hover:bg-surface-muted rounded-xl text-content-muted hover:text-content transition-all outline-none focus-visible:ring-2 focus-visible:ring-brand"
              >
                {isRtl ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
              </button>
            </div>

            {/* Weekdays row */}
            <div className="grid grid-cols-7 gap-1 text-center mb-1">
              {weekDays.map((wd, index) => (
                <span 
                  key={index} 
                  className="text-sm font-black text-content-muted py-1 truncate min-w-0"
                  title={wd}
                >
                  {wd}
                </span>
              ))}
            </div>

            {/* Days Grid */}
            <div className="grid grid-cols-7 gap-1 text-center">
              {daysArray.map((cell, idx) => {
                const isSelected = cell.dateString === value;
                const isTodayStr = cell.dateString === formatDateString(new Date());
                const blocked = isBeforeMin(cell.dateString);
                
                return (
                  <button
                    key={idx}
                    type="button"
                    disabled={blocked}
                    onClick={() => handleSelectDay(cell.dateString)}
                    aria-current={isTodayStr ? 'date' : undefined}
                    aria-selected={isSelected}
                    className={cn(
                      "h-10 w-10 mx-auto flex items-center justify-center text-sm font-bold rounded-xl transition-all outline-none cursor-pointer",
                      cell.isCurrentMonth 
                        ? "text-content hover:bg-brand/10 hover:text-brand" 
                        : "text-content-muted/30 hover:bg-surface-muted",
                      isSelected && "bg-brand text-white font-black shadow-lg shadow-brand/20 hover:bg-brand hover:text-white",
                      isTodayStr && !isSelected && "border-2 border-brand/20 text-brand font-black",
                      blocked && "opacity-30 cursor-not-allowed hover:bg-transparent hover:text-content-muted"
                    )}
                  >
                    {cell.day}
                  </button>
                );
              })}
            </div>
            
            {/* Quick Actions Footer */}
            <div className="border-t border-border mt-3 pt-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => handleSelectDay(formatDateString(new Date()))}
                className="text-sm font-black text-brand hover:underline"
              >
                {t('common.date_picker.today')}
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-sm font-black text-content-muted hover:text-content"
              >
                {t('common.date_picker.close')}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
