import React from 'react';
import { useTranslation } from 'react-i18next';
import { formatCurrency, cn } from '../lib/utils';
import { CurrencySymbol } from './CurrencySymbol';

interface PriceDisplayProps {
  amount: number;
  className?: string;
  symbolClassName?: string;
  showSymbol?: boolean;
}

/**
 * PriceDisplay renders a formatted price with the custom currency symbol.
 * In Arabic locale, the symbol is explicitly positioned to the left of the number
 * to maintain legal and branding requirements.
 */
export const PriceDisplay: React.FC<PriceDisplayProps> = ({ 
  amount, 
  className, 
  symbolClassName,
  showSymbol = true 
}) => {
  const { i18n } = useTranslation();
  const isAr = i18n.language === 'ar' || i18n.language?.startsWith('ar-');

  return (
    <span className={cn("inline-flex items-center gap-1.5", className)} dir={isAr ? "rtl" : "ltr"}>
      {!isAr && showSymbol && (
        <span className={cn("text-[0.8em] font-bold text-gray-500 mr-1", symbolClassName)}>
          SAR
        </span>
      )}

      <span className="font-semibold text-gray-900 tabular-nums leading-none">
        {formatCurrency(amount)}
      </span>
      
      {isAr && showSymbol && (
        <CurrencySymbol className={cn("h-[1.1em] w-auto shrink-0", symbolClassName)} />
      )}
    </span>
  );
};
