// scripts/vite-i18n-core.ts: the CORE_SECTIONS of one language file.
declare module 'virtual:i18n-core/*' {
  const core: Record<string, unknown>;
  export default core;
}
