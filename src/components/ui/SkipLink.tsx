import { useTranslation } from 'react-i18next';

/**
 * The first thing Tab reaches: a jump past the sidebar to the page's content
 * (WCAG 2.4.1; ux-ui-audit B3). Hidden until it has focus.
 * `targetId` is the content area's id; it must take focus (tabIndex={-1}).
 */
export function SkipLink({ targetId }: { targetId: string }) {
  const { t } = useTranslation();
  return (
    <a
      href={`#${targetId}`}
      onClick={(e) => {
        // The router would read the hash as a route: move focus by hand.
        e.preventDefault();
        const target = document.getElementById(targetId);
        target?.focus();
        target?.scrollIntoView({ block: 'start' });
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-[300] focus:inline-flex focus:min-h-12 focus:items-center focus:rounded-[8px] focus:bg-surface focus:px-5 focus:text-base focus:font-semibold focus:text-brand focus:shadow-lg"
    >
      {t('common.skip_to_content')}
    </a>
  );
}

export default SkipLink;
