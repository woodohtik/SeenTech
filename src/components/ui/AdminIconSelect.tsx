import React, { forwardRef } from 'react';
import { cn } from '../../lib/utils';
import { ChevronDown, LucideIcon } from 'lucide-react';

export interface AdminIconSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  startIcon?: LucideIcon;
  error?: boolean;
}

export const AdminIconSelect = forwardRef<HTMLSelectElement, AdminIconSelectProps>(
  ({ className, startIcon: StartIcon, error, children, disabled, ...props }, ref) => {
    return (
      <div 
        className={cn(
          "flex items-center w-full bg-surface rounded-lg overflow-hidden transition-all border border-border shadow-sm relative group",
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
        <select
          ref={ref}
          disabled={disabled}
          className={cn(
            "flex-1 w-full bg-transparent border-none h-11 outline-none text-sm font-bold appearance-none cursor-pointer disabled:cursor-not-allowed z-10 relative",
            "truncate whitespace-nowrap overflow-hidden transition-colors",
            StartIcon ? "ps-1 pe-10" : "ps-4 pe-10"
          )}
          {...props}
        >
          {children}
        </select>
        <div className="absolute end-3 top-1/2 -translate-y-1/2 pointer-events-none text-content-muted shrink-0 flex items-center justify-center z-0 group-focus-within:text-brand transition-colors">
          <ChevronDown size={18} className="stroke-[2.5] opacity-70" />
        </div>
      </div>
    );
  }
);

AdminIconSelect.displayName = 'AdminIconSelect';
