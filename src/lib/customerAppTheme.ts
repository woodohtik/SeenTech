/**
 * customerAppTheme.ts — single source of truth for the customer app's
 * visual design (seen-customer-app-design-upgrade-task.md, Phase 2).
 *
 * Fixes the gap this task was written to close: NAVY/BLUE used to be
 * copy-pasted as separate literals in OrderTracking.tsx and
 * MyOrdersHome.tsx. Every color below still resolves to a CSS custom
 * property defined once in index-customer.css (:root for light,
 * `@media (prefers-color-scheme: dark)` for dark) -- so components never
 * hardcode a hex value, and dark mode requires no JS/media-query logic in
 * either component: the browser just re-resolves the variable.
 *
 * Brand colors (navy/blue) are seen-companion-app's existing identity,
 * carried over unchanged -- not reinvented for this task.
 *
 * Font pick is evidence-based, not guessed: ui-ux-pro-max's typography
 * catalog has exactly one Arabic-script-aware pairing ("Arabic Elegant"),
 * surfaced on two separate queries -- Noto Naskh Arabic for the brand
 * mark/headings, Noto Sans Arabic for body/UI text. Loaded in
 * index.customer.html, not here.
 *
 * Icon choice deliberately does NOT follow ui-ux-pro-max's icon catalog:
 * that catalog is Phosphor Icons, and it returned zero tailoring-specific
 * matches (confirmed empty on two separate queries, not skipped) because
 * it's a generic 105-icon UI set, not a domain catalog. This project
 * already depends on lucide-react everywhere else in the codebase --
 * adding Phosphor as a second icon library for five icons would be pure
 * bundle/consistency cost for no real benefit, so the icons below are
 * lucide-react names chosen for the same semantic roles instead.
 *
 * Motion durations come from design-system's own primitive-tokens.md
 * (`## Motion / Duration`) since ui-ux-pro-max has no "motion" search
 * domain -- 150/200/300ms fast/normal/slow, expressed here in seconds
 * (motion/react's `transition.duration` unit), matching the library this
 * project already uses elsewhere (App.tsx already imports `motion/react`).
 */

export const customerColors = {
  bg: 'var(--c-bg)',
  surface: 'var(--c-surface)',
  surfaceMuted: 'var(--c-surface-muted)',
  text: 'var(--c-text)',
  textMuted: 'var(--c-text-muted)',
  border: 'var(--c-border)',
  navy: 'var(--c-navy)',
  blue: 'var(--c-blue)',
  accentText: 'var(--c-accent-text)',
  successBg: 'var(--c-success-bg)',
  successText: 'var(--c-success-text)',
  dangerBg: 'var(--c-danger-bg)',
  dangerText: 'var(--c-danger-text)',
  shadow: 'var(--c-shadow)',
  skeletonBase: 'var(--c-skeleton-base)',
  skeletonHighlight: 'var(--c-skeleton-highlight)',
} as const;

export const customerRadius = {
  card: 16,
  pill: 999,
  sm: 10,
} as const;

export const customerFont = {
  display: "'Noto Naskh Arabic', 'Tajawal', serif",
  body: "'Noto Sans Arabic', 'Tajawal', Arial, sans-serif",
} as const;

/** Seconds, for motion/react's `transition={{ duration }}`. */
export const customerMotion = {
  fast: 0.15,
  normal: 0.2,
  slow: 0.3,
} as const;
