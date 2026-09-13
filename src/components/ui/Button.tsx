import React, { forwardRef } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '../../lib/utils';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'md' | 'sm';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

// 44px minimum height on the default size — the codebase's own documented
// touch-target rationale ("مهم للجمهور 40+" / important for the 40+ audience),
// kept here so every button gets it by construction instead of by convention.
const sizeClasses: Record<ButtonSize, string> = {
  md: 'h-11 px-5 text-base rounded-2xl gap-2',
  sm: 'h-9 px-3.5 text-sm rounded-xl gap-1.5',
};

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-white hover:bg-brand/90 shadow-lg shadow-brand/10',
  secondary: 'bg-surface text-content border border-border hover:border-brand hover:text-brand',
  ghost: 'bg-transparent text-content-muted hover:text-content hover:bg-surface-muted',
  danger: 'bg-danger text-white hover:bg-danger/90 shadow-lg shadow-danger/10',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled,
  className,
  children,
  ...props
}, ref) => {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cn(
        'inline-flex items-center justify-center font-bold transition-colors duration-200 disabled:opacity-70 disabled:cursor-not-allowed',
        sizeClasses[size],
        variantClasses[variant],
        className
      )}
      {...props}
    >
      {loading && <Loader2 className="animate-spin" size={size === 'sm' ? 16 : 20} />}
      {children}
    </button>
  );
});

Button.displayName = 'Button';
