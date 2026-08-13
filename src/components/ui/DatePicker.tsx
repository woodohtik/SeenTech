import React, { useState, useRef, useEffect } from 'react';
import { Calendar as CalendarIcon, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';

interface DatePickerProps {
  value: string; // YYYY-MM-DD
  onChange: (value: string) => void;
  id?: string;
  className?: string;
}

export function DatePicker({ value, onChange, id, className }: DatePickerProps) {
  const { t, i18n } = useTranslation();
  const isRtl = i18n.language === 'ar';
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

  // Helper arrays for months and weekdays in both Arabic and English
  const arabicMonths = [
    'يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو',
    'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'
  ];
  
  const englishMonths = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];

  const arabicWeekDays = ['أح', 'اث', 'ثل', 'أر', 'خم', 'جم', 'سب'];
  const englishWeekDays = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

  const months = isRtl ? arabicMonths : englishMonths;
  const weekDays = isRtl ? arabicWeekDays : englishWeekDays;

  // Format selected date for display button
  const formatDisplayDate = (dateStr: string) => {
    if (!dateStr) return isRtl ? 'اختر التاريخ' : 'Select Date';
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    
    const day = date.getDate();
    const month = months[date.getMonth()];
    const year = date.getFullYear();
    
    return isRtl ? `${day} ${month} ${year}` : `${month} ${day}, ${year}`;
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

  const handleSelectDay = (dateString: string) => {
    onChange(dateString);
    setIsOpen(false);
  };

  return (
    <div className={cn("relative inline-block w-full", className)} ref={containerRef}>
      {/* Hidden real input so automated query selectors matching `#report-date-input` or class still work */}
      <input 
        type="hidden" 
        id={id} 
        value={value} 
        onChange={(e) => onChange(e.target.value)} 
      />

      {/* Button Trigger */}
      <button
        type="button"
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
          "flex items-center gap-3 w-full bg-surface border-2 border-transparent focus:border-brand/40 hover:bg-surface-muted/30 rounded-2xl px-4 h-12 text-sm font-bold text-content transition-all shadow-inner shadow-black/5 outline-none cursor-pointer text-right justify-between",
          isOpen && "border-brand/40 bg-surface"
        )}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <CalendarIcon size={18} className="text-content-muted shrink-0" />
          <span className="truncate">{formatDisplayDate(value)}</span>
        </div>
        <span className="text-[10px] text-brand bg-brand/10 hover:bg-brand/20 transition-all rounded-lg px-2 py-0.5 shrink-0">
          {isRtl ? 'تغيير' : 'Change'}
        </span>
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
              "absolute z-50 mt-1 w-72 bg-surface border border-border shadow-xl rounded-2xl p-4 overflow-hidden focus:outline-none",
              isRtl ? "right-0" : "left-0"
            )}
          >
            {/* Header Controls */}
            <div className="flex items-center justify-between mb-4">
              <button
                type="button"
                onClick={isRtl ? handleNextMonth : handlePrevMonth}
                className="p-1.5 hover:bg-surface-muted rounded-xl text-content-muted hover:text-content transition-all outline-none"
              >
                <ChevronRight size={16} />
              </button>
              
              <span className="text-xs font-black text-content uppercase tracking-wider">
                {months[month]} {year}
              </span>
              
              <button
                type="button"
                onClick={isRtl ? handlePrevMonth : handleNextMonth}
                className="p-1.5 hover:bg-surface-muted rounded-xl text-content-muted hover:text-content transition-all outline-none"
              >
                <ChevronLeft size={16} />
              </button>
            </div>

            {/* Weekdays row */}
            <div className="grid grid-cols-7 gap-1 text-center mb-1">
              {weekDays.map((wd, index) => (
                <span 
                  key={index} 
                  className="text-[10px] font-black text-content-muted uppercase tracking-wider py-1"
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
                
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSelectDay(cell.dateString)}
                    className={cn(
                      "h-8 w-8 mx-auto flex items-center justify-center text-xs font-bold rounded-xl transition-all outline-none cursor-pointer",
                      cell.isCurrentMonth 
                        ? "text-content hover:bg-brand/10 hover:text-brand" 
                        : "text-content-muted/30 hover:bg-surface-muted",
                      isSelected && "bg-brand text-brand-foreground font-black shadow-lg shadow-brand/20 hover:bg-brand hover:text-brand-foreground",
                      isTodayStr && !isSelected && "border-2 border-brand/20 text-brand font-black"
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
                className="text-[10px] font-black text-brand hover:underline"
              >
                {isRtl ? 'اليوم' : 'Today'}
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-[10px] font-black text-content-muted hover:text-content"
              >
                {isRtl ? 'إغلاق' : 'Close'}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
