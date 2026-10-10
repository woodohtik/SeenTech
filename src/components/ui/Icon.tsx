import React from 'react';
import { seenIconRegistry, type SeenIconName } from './seenIcons';
import {
  Home,
  Monitor,
  UserCircle,
  ShoppingBag,
  Package,
  Briefcase,
  BarChart3,
  Settings,
  LayoutDashboard,
  Users,
  Store,
  FileText,
  MapPin,
  Palette,
  Printer,
  Bell,
  MessageSquare,
  Shield,
  CreditCard,
  Database,
  Scissors,
  Calendar,
  Layers,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';

// Central name -> lucide component registry (seen-icon-replacement-task.md
// Phase 2). Call sites reference icons by name instead of importing from
// lucide-react directly, so swapping icon libraries later is a change to
// this one file instead of every consumer. Add new icons here as call sites
// migrate -- there's no need to register the whole lucide set up front.
const ICONS = {
  home: Home,
  monitor: Monitor,
  'user-circle': UserCircle,
  'shopping-bag': ShoppingBag,
  package: Package,
  briefcase: Briefcase,
  'bar-chart-3': BarChart3,
  settings: Settings,
  'layout-dashboard': LayoutDashboard,
  users: Users,
  store: Store,
  'file-text': FileText,
  'map-pin': MapPin,
  palette: Palette,
  printer: Printer,
  bell: Bell,
  'message-square': MessageSquare,
  shield: Shield,
  'credit-card': CreditCard,
  database: Database,
  scissors: Scissors,
  calendar: Calendar,
  layers: Layers,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS | SeenIconName;

export interface IconProps extends Omit<LucideProps, 'ref'> {
  name: IconName;
}

// سين v5.1 (seen-design-system-v5.1-task.md بند 4): يحقن نص SVG خام من
// seenIconRegistry مباشرة في الصفحة، بعد استبدال width/height الثابتة في
// الملف الأصلي بالمقاس المطلوب -- stroke="currentColor" موجود سلفاً بكل
// ملف، فيرث لون النص المحيط تلقائياً (رمادي 600 للعادي، أزرق 600 للنشط،
// بحسب DESIGN.md §8)، بلا أي حاجة لتمرير prop لون صريح من كل نقطة استخدام.
function SeenSvgIcon({ raw, size, className, style }: { raw: string; size: string | number; className?: string; style?: React.CSSProperties }) {
  const sized = raw
    .replace(/width="[^"]*"/, `width="${size}"`)
    .replace(/height="[^"]*"/, `height="${size}"`);
  return (
    <span
      className={className}
      style={{ display: 'inline-flex', width: size, height: size, ...style }}
      dangerouslySetInnerHTML={{ __html: sized }}
    />
  );
}

// size/strokeWidth defaults match lucide's own defaults and the sidebar's
// pre-existing convention -- the point is every future call site gets the
// same values by construction instead of picking its own. Falls through to
// seenIconRegistry (design-system/icons/) for any name not in the lucide
// ICONS map above, so one <Icon name="..."/> call site works for both
// sources without the caller needing to know which library an icon came
// from.
export function Icon({ name, size = 20, strokeWidth = 2, className, style, ...props }: IconProps) {
  const Component = (ICONS as Record<string, LucideIcon>)[name as string];
  if (Component) {
    return <Component size={size} strokeWidth={strokeWidth} className={className} style={style} {...props} />;
  }
  const raw = seenIconRegistry[name as string];
  if (raw) {
    return <SeenSvgIcon raw={raw} size={size} className={className} style={style} />;
  }
  if (process.env.NODE_ENV !== 'production') {
    console.warn(`[Icon] Unknown icon name: "${name}"`);
  }
  return null;
}
