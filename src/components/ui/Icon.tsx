import React from 'react';
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

export type IconName = keyof typeof ICONS;

export interface IconProps extends Omit<LucideProps, 'ref'> {
  name: IconName;
}

// size/strokeWidth defaults match lucide's own defaults and the sidebar's
// pre-existing convention -- the point is every future call site gets the
// same values by construction instead of picking its own.
export function Icon({ name, size = 20, strokeWidth = 2, ...props }: IconProps) {
  const Component = ICONS[name];
  return <Component size={size} strokeWidth={strokeWidth} {...props} />;
}
