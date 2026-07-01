import React, { forwardRef } from 'react';
import { cn } from '../../lib/utils';
import { LucideIcon } from 'lucide-react';

export interface AdminIconInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'prefix'> {
  startIcon?: LucideIcon;
  endIcon?: React.ReactNode; 
  error?: boolean;
}

export const AdminIconInput = forwardRef<HTMLInputElement, AdminIconInputProps>(
  ({ className, startIcon: StartIcon, endIcon, error, disabled, ...props }, ref) => {
    return (
      <div 
        className={cn(
          "flex items-center w-full bg-surface rounded-lg overflow-hidden transition-all border border-border shadow-sm group",
          "focus-within:ring-2 focus-within:ring-brand focus-within:border-brand hover:border-gray-300 dark:hover:border-gray-700",
          error && "border-danger focus-within:border-danger focus-within:ring-danger",
          disabled && "opacity-50 cursor-not-allowed bg-surface-muted",
          className
        )}
      >
        {StartIcon && (
          <div className="flex items-center justify-center ps-4 pe-3 text-content-muted shrink-0 pointer-events-none group-focus-within:text-brand transition-colors">
            <StartIcon size={18} className={cn(error && "text-danger")} />
          </div>
        )}
        <input
          ref={ref}
          disabled={disabled}
          className={cn(
            "flex-1 w-full bg-transparent border-none h-11 text-sm outline-none font-bold placeholder:text-content-muted/50 disabled:cursor-not-allowed z-10",
            StartIcon ? "ps-1 pe-4" : "px-4"
          )}
          {...props}
        />
        {endIcon && (
          <div className="flex items-center justify-center pe-4 ps-2 shrink-0 transition-colors z-10">
            {endIcon}
          </div>
        )}
      </div>
    );
  }
);

AdminIconInput.displayName = 'AdminIconInput';
