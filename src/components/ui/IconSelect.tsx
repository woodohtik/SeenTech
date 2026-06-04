import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ChevronDown, Check } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface SelectOption {
  value: string;
  label: string;
  icon?: React.ComponentType<{ className?: string }> | React.ReactNode;
}

export interface IconSelectProps {
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  error?: string;
  icon?: React.ComponentType<{ className?: string }> | React.ReactNode;
  disabled?: boolean;
  containerClassName?: string;
  wrapperClassName?: string;
  className?: string;
}

export const IconSelect: React.FC<IconSelectProps> = ({
  options,
  value,
  onChange,
  placeholder = 'اختر...',
  label,
  error,
  icon: StartIcon,
  disabled = false,
  containerClassName,
  wrapperClassName,
  className,
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOption = options.find((opt) => opt.value === value);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const renderIcon = (iconToRender: React.ComponentType<{ className?: string }> | React.ReactNode, customClasses = "w-5 h-5") => {
    if (!iconToRender) return null;
    if (React.isValidElement(iconToRender)) {
      return React.cloneElement(iconToRender as React.ReactElement<any>, {
        className: cn("transition-colors", customClasses, (iconToRender.props as any)?.className)
      });
    }
    if (
      typeof iconToRender === 'function' || 
      (typeof iconToRender === 'object' && iconToRender !== null && ('$$typeof' in iconToRender || 'prototype' in iconToRender || 'render' in iconToRender))
    ) {
      const IconComponent = iconToRender as React.ComponentType<any>;
      return <IconComponent className={cn("transition-colors", customClasses)} />;
    }
    return iconToRender;
  };

  const handlesSelectClick = () => {
    if (disabled) return;
    setIsOpen(!isOpen);
  };

  const hasStartIcon = !!StartIcon;

  return (
    <div className={cn("relative w-full text-start flex flex-col gap-1.5", containerClassName)} ref={containerRef}>
      {label && (
        <label 
          className={cn(
            "block text-xs font-black uppercase tracking-widest px-1 transition-colors select-none",
            disabled ? "text-content-muted/50" : "text-content-muted hover:text-content",
            error ? "text-red-500" : ""
          )}
        >
          {label}
        </label>
      )}

      <button
        type="button"
        disabled={disabled}
        onClick={handlesSelectClick}
        className={cn(
          "group flex items-center w-full h-[var(--size-button-height,42px)] min-h-[40px] bg-surface border rounded-xl overflow-hidden transition-all duration-200 text-start outline-none focus:outline-none focus:ring-2",
          disabled && "opacity-50 cursor-not-allowed bg-surface-muted/30",
          isOpen && !error && "border-brand ring-2 ring-brand/20 bg-surface",
          error 
            ? "border-red-500 ring-2 ring-red-500/10 focus:ring-2 focus:ring-red-500/20 focus:border-red-600" 
            : "border-border dark:border-gray-800 focus:ring-brand/20 focus:border-brand hover:border-border-hover dark:hover:border-gray-700",
          wrapperClassName
        )}
      >
        {/* Start Icon Section: logically aligned via flex context */}
        {hasStartIcon && (
          <div 
            className={cn(
              "flex items-center justify-center h-full px-3.5 bg-surface-muted/10 border-e transition-all duration-200",
              error 
                ? "text-red-500 border-red-500/20 bg-red-50/5" 
                : "text-gray-400 dark:text-gray-500 border-border dark:border-gray-800 group-focus-within:border-brand/40 group-focus-within:text-brand bg-surface-muted/20",
              isOpen && !error && "border-brand/40 text-brand"
            )}
          >
            {renderIcon(StartIcon, "w-5 h-5")}
          </div>
        )}

        {/* Selected Option Content Area */}
        <span 
          className={cn(
            "flex-1 h-full flex items-center px-3 text-sm font-semibold truncate",
            selectedOption ? "text-content" : "text-content-muted/50",
            className
          )}
        >
          {selectedOption ? (
            <span className="flex items-center gap-2">
              {selectedOption.icon && renderIcon(selectedOption.icon, "w-4 h-4 text-gray-400")}
              <span>{selectedOption.label}</span>
            </span>
          ) : (
            placeholder
          )}
        </span>

        {/* End Chevron Section */}
        <div 
          className={cn(
            "flex items-center justify-center h-full px-3 text-gray-400 transition-colors duration-200 border-s border-border/40 dark:border-gray-800/40",
            isOpen && "text-brand"
          )}
        >
          <motion.div
            animate={{ rotate: isOpen ? 180 : 0 }}
            transition={{ duration: 0.2, ease: "easeOut" }}
          >
            <ChevronDown size={16} className="stroke-[2.5]" />
          </motion.div>
        </div>
      </button>

      {/* Options Listbox Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.12, ease: "easeOut" }}
            className="absolute z-50 w-full top-full mt-1.5 bg-surface rounded-xl border border-border dark:border-gray-800 shadow-lg drop-shadow-sm overflow-hidden p-1.5"
            style={{ maxHeight: '260px', overflowY: 'auto' }}
          >
            <div className="space-y-0.5">
              {options.length === 0 ? (
                <div className="text-center py-4 text-xs font-semibold text-content-muted">
                  لا توجد خيارات متاحة
                </div>
              ) : (
                options.map((option) => {
                  const isSelected = value === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      onClick={() => {
                        onChange(option.value);
                        setIsOpen(false);
                      }}
                      className={cn(
                        "w-full text-start px-3 py-2.5 rounded-lg text-sm font-semibold transition-all flex items-center justify-between group/item",
                        isSelected 
                          ? "bg-brand/10 text-brand font-bold" 
                          : "text-content hover:bg-surface-muted hover:text-content dark:hover:bg-gray-800"
                      )}
                    >
                      <span className="flex items-center gap-3">
                        {option.icon && (
                          <span className={cn(
                            "w-4 h-4 flex items-center justify-center flex-shrink-0 transition-colors [&>svg]:w-4 [&>svg]:h-4",
                            isSelected ? "text-brand" : "text-gray-400 group-hover/item:text-brand"
                          )}>
                            {renderIcon(option.icon, "w-4 h-4")}
                          </span>
                        )}
                        <span>{option.label}</span>
                      </span>
                      
                      {isSelected && (
                        <motion.div layoutId={`check-${placeholder.replace(/\s+/g, '-')}`}>
                          <Check size={14} className="text-brand w-3.5 h-3.5 stroke-[3]" />
                        </motion.div>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error Message */}
      {error && (
        <span className="text-xs font-semibold text-red-500 px-1 mt-0.5 animate-fadeIn">
          {error}
        </span>
      )}
    </div>
  );
};
