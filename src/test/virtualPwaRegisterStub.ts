// vitest.config.ts aliases the real "virtual:pwa-register" specifier (only
// resolvable inside vite-plugin-pwa's actual build, deliberately excluded
// from this test config, see that file's own header comment) to this stub,
// so files importing it can load under vitest at all. Tests that care about
// its behavior replace this with their own vi.mock('virtual:pwa-register').
export function registerSW(_options?: unknown): (reload?: boolean) => Promise<void> {
  return async () => {};
}
