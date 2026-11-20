import React from 'react';
import { Link } from 'react-router-dom';
import {
  BarChart3, Boxes, ClipboardList, Compass, Receipt, Scale, Sparkles, Trophy, Truck, Users, Wallet,
} from 'lucide-react';
import { cn } from '../../lib/utils';
import { parseMarkdown, type Inline } from './markdown';
import type { IconKey } from './catalog';

/**
 * The assistant's mark. A plain star for now: public/Logo.svg is a bitmap
 * inside an SVG and cannot be tinted. Swap this one component when a vector
 * of the Seen glyph exists.
 */
export function AssistantMark({ size = 22, className }: { size?: number; className?: string }) {
  return <Sparkles size={size} className={className} aria-hidden="true" />;
}

const ICONS: Record<IconKey, React.ComponentType<{ size?: number; className?: string }>> = {
  orders: ClipboardList,
  sales: Wallet,
  stock: Boxes,
  customers: Users,
  suppliers: Truck,
  compare: Scale,
  report: BarChart3,
  invoice: Receipt,
  guide: Compass,
  top: Trophy,
};

export function CatalogIcon({ name, size = 24, className }: { name: IconKey; size?: number; className?: string }) {
  const Icon = ICONS[name];
  return <Icon size={size} className={className} aria-hidden="true" />;
}

/** A square icon-only button. Every one carries a name for screen readers. */
export const IconButton = React.forwardRef<HTMLButtonElement, React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  /** 48 for the main controls, 44 for the secondary ones under a reply. */
  size?: 44 | 48;
}>(function IconButton({ label, size = 48, className, children, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title={label}
      className={cn(
        "shrink-0 flex items-center justify-center rounded-[12px] text-content-muted transition-colors",
        "hover:bg-surface-muted hover:text-content disabled:opacity-50 disabled:pointer-events-none",
        size === 48 ? "w-12 h-12" : "w-11 h-11",
        className
      )}
      {...rest}
    >
      {children}
    </button>
  );
});

function renderInline(nodes: Inline[], onNavigate?: () => void): React.ReactNode {
  return nodes.map((node, i) => {
    if (node.type === 'text') return <React.Fragment key={i}>{node.text}</React.Fragment>;
    if (node.type === 'strong') {
      return <strong key={i} className="font-semibold">{renderInline(node.children, onNavigate)}</strong>;
    }
    return (
      <Link key={i} to={node.href} onClick={onNavigate} className="font-semibold text-brand underline underline-offset-4">
        {renderInline(node.children, onNavigate)}
      </Link>
    );
  });
}

/**
 * The assistant's reply, formatted: paragraphs, bold, lists, and links to
 * pages inside the app. Built as React elements from parsed data; no HTML
 * string is ever set.
 */
export function Markdown({ source, onNavigate }: { source: string; onNavigate?: () => void }) {
  const blocks = React.useMemo(() => parseMarkdown(source), [source]);
  return (
    <div className="flex flex-col gap-2 text-[15px] leading-[1.65] text-content break-words">
      {blocks.map((block, i) => {
        if (block.type === 'list') {
          const Tag = block.ordered ? 'ol' : 'ul';
          return (
            <Tag key={i} start={block.ordered && block.start !== 1 ? block.start : undefined} className={cn("m-0 ps-6 flex flex-col gap-0.5", block.ordered ? "list-decimal" : "list-disc")}>
              {block.items.map((item, j) => <li key={j}>{renderInline(item, onNavigate)}</li>)}
            </Tag>
          );
        }
        if (block.type === 'heading') {
          return <p key={i} className="m-0 font-semibold">{renderInline(block.children, onNavigate)}</p>;
        }
        return <p key={i} className="m-0 whitespace-pre-line">{renderInline(block.children, onNavigate)}</p>;
      })}
    </div>
  );
}
