import React, { forwardRef } from 'react';
import { cn } from '../../lib/utils';

export interface IconInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  label?: string;
  error?: string;
  startIcon?: React.ComponentType<{ className?: string }> | React.ReactNode;
  endIcon?: React.ComponentType<{ className?: string }> | React.ReactNode;
  containerClassName?: string;
  wrapperClassName?: string;
}

export const IconInput = forwardRef<HTMLInputElement, IconInputProps>(({
  label,
  error,
  startIcon: StartIcon,
  endIcon: EndIcon,
  containerClassName,
  wrapperClassName,
  className,
  id,
  type = 'text',
  disabled,
  ...props
}, ref) => {
  
  const renderIcon = (icon: React.ComponentType<{ className?: string }> | React.ReactNode) => {
    if (!icon) return null;
    if (React.isValidElement(icon)) {
      return React.cloneElement(icon as React.ReactElement<any>, {
        className: cn("w-5 h-5 transition-colors", (icon.props as any)?.className)
      });
    }
    if (
      typeof icon === 'function' || 
      (typeof icon === 'object' && icon !== null && ('$$typeof' in icon || 'prototype' in icon || 'render' in icon))
    ) {
      const IconComponent = icon as React.ComponentType<any>;
      return <IconComponent className="w-5 h-5 transition-colors" />;
    }
    return icon;
  };

  const hasStartIcon = !!StartIcon;
  const hasEndIcon = !!EndIcon;

  return (
    <div className={cn("w-full text-start flex flex-col gap-1.5", containerClassName)}>
      {label && (
        <label 
          htmlFor={id} 
          className={cn(
            "block text-xs font-black uppercase tracking-widest px-1 transition-colors select-none",
            disabled ? "text-content-muted/50" : "text-content-muted hover:text-content",
            error ? "text-red-500" : ""
          )}
        >
          {label}
        </label>
      )}

      <div 
        className={cn(
          "group flex items-center w-full h-[var(--size-button-height,42px)] min-h-[40px] bg-surface border rounded-xl overflow-hidden transition-all duration-200",
          disabled && "opacity-50 cursor-not-allowed bg-surface-muted/30",
          error 
            ? "border-red-500 ring-2 ring-red-500/10 focus-within:ring-2 focus-within:ring-red-500/20 focus-within:border-red-600" 
            : "border-border dark:border-gray-800 focus-within:ring-2 focus-within:ring-brand/20 focus-within:border-brand hover:border-border-hover dark:hover:border-gray-700",
          wrapperClassName
        )}
      >
        {/* Start Icon Wrapper: logically aligned via flex context */}
        {hasStartIcon && (
          <div 
            className={cn(
              "flex items-center justify-center h-full px-3.5 bg-surface-muted/10 border-e transition-all duration-200",
              error 
                ? "text-red-500 border-red-500/20 bg-red-50/5" 
                : "text-gray-400 dark:text-gray-500 border-border dark:border-gray-800 group-focus-within:border-brand/40 group-focus-within:text-brand bg-surface-muted/20"
            )}
          >
            {renderIcon(StartIcon)}
          </div>
        )}

        {/* Input area */}
        <input
          ref={ref}
          id={id}
          type={type}
          disabled={disabled}
          className={cn(
            "flex-1 h-full min-w-0 bg-transparent px-3 text-sm text-content outline-none border-none placeholder:text-content-muted/40 font-semibold focus:ring-0 focus:border-none",
            disabled && "cursor-not-allowed",
            className
          )}
          {...props}
        />

        {/* End Icon Wrapper: logically aligned via flex context */}
        {hasEndIcon && (
          <div 
            className={cn(
              "flex items-center justify-center h-full px-3.5 bg-surface-muted/10 border-s transition-all duration-200",
              error 
                ? "text-red-500 border-red-500/20 bg-red-50/5" 
                : "text-gray-400 dark:text-gray-500 border-border dark:border-gray-800 group-focus-within:border-brand/40 group-focus-within:text-brand bg-surface-muted/20"
            )}
          >
            {renderIcon(EndIcon)}
          </div>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <span className="text-xs font-semibold text-red-500 px-1 mt-0.5 animate-fadeIn">
          {error}
        </span>
      )}
    </div>
  );
});

IconInput.displayName = 'IconInput';
