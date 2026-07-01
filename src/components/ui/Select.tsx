import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '../../lib/utils';

interface SelectOption {
  value: string;
  label: string;
  icon?: React.ReactNode;
}

interface SelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  label?: string;
}

export default function Select({ 
  options, 
  value, 
  onChange, 
  placeholder = 'اختر...', 
  className,
  label 
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  const selectedOption = options.find(opt => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={cn("relative w-full text-right", className)} ref={containerRef} dir="rtl">
      {label && (
        <label className="block text-xs font-black text-content-muted uppercase tracking-widest mb-2 px-1">
          {label}
        </label>
      )}
      
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-full h-[var(--size-button-height)] bg-surface border border-border dark:border-gray-800 rounded-[var(--radius-md)] px-4 text-[var(--size-text-base)] font-semibold transition-all outline-none focus:outline-none focus:ring-2 focus:ring-brand/20 focus:border-brand flex items-center justify-between group",
          isOpen ? "border-brand shadow-md shadow-brand/5 bg-surface" : "hover:border-brand/20 hover:bg-surface-muted/30",
          className
        )}
      >
        <span className={cn(
          "text-sm truncate flex-1 block text-right flex items-center gap-3 pe-8",
          selectedOption ? "text-content" : "text-content-muted"
        )}>
          {selectedOption?.icon && (
            <span className="w-4 h-4 flex items-center justify-center flex-shrink-0 text-gray-400 group-hover:text-brand transition-colors [&>svg]:w-4 [&>svg]:h-4">
              {selectedOption.icon}
            </span>
          )}
          <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
        </span>
        <div className="absolute top-1/2 -translate-y-1/2 left-4 text-gray-400 group-hover:text-brand transition-colors flex-shrink-0">
          <motion.div
            animate={{ rotate: isOpen ? 180 : 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <ChevronDown size={16} />
          </motion.div>
        </div>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
            className="absolute z-50 w-full mt-1.5 bg-surface rounded-xl border border-border dark:border-gray-800 shadow-lg drop-shadow-sm overflow-hidden max-h-64 overflow-y-auto p-1.5"
          >
            <div className="space-y-0.5">
              {options.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={cn(
                    "w-full text-right px-3 py-2 rounded-lg text-sm font-semibold transition-all flex items-center justify-between group/item",
                    value === option.value 
                      ? "bg-brand/10 text-brand font-bold" 
                      : "text-content hover:bg-surface-muted hover:text-content dark:hover:bg-gray-800"
                  )}
                >
                  <span className="flex items-center gap-3">
                    {option.icon && (
                      <span className={cn(
                        "w-4 h-4 flex items-center justify-center flex-shrink-0 transition-colors [&>svg]:w-4 [&>svg]:h-4",
                        value === option.value ? "text-brand" : "text-gray-400 group-hover/item:text-brand"
                      )}>
                        {option.icon}
                      </span>
                    )}
                    <span>{option.label}</span>
                  </span>
                  
                  {value === option.value && (
                    <motion.div layoutId="check">
                      <Check size={14} className="text-brand w-3.5 h-3.5" />
                    </motion.div>
                  )}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
