import React from 'react';
import { ExternalLink } from 'lucide-react';
import { cn } from '../lib/utils';
import { useBranding } from '../contexts/BrandingContext';

interface BrandingProps {
  className?: string;
  light?: boolean;
  collapsed?: boolean;
}

export default function Branding({ className, light = false, collapsed = false }: BrandingProps) {
  const { settings, loading } = useBranding();

  if (loading) return null;

  const content = (
    <>
      {!collapsed && <span>Powered By</span>}
      <span className={cn("font-black", light ? "text-white" : "text-brand")}>
        Seen
      </span>
      {!collapsed && <ExternalLink size={10} className="opacity-50" />}
    </>
  );

  return (
    <div className={cn("flex items-center justify-center gap-1.5 py-4", className)}>
      <a 
        href="#" 
        target="_blank" 
        rel="noopener noreferrer"
        dir="ltr"
        className={cn(
          "flex items-center gap-1 text-[10px] font-bold tracking-wider transition-all hover:opacity-80",
          light ? "text-white/60" : "text-content-muted",
          collapsed && "flex-col gap-0.5"
        )}
      >
        {content}
      </a>
    </div>
  );
}
