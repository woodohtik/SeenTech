/**
 * Whether the assistant can answer at all: at least one provider the chat
 * route would try (the active one, then the fallback order) has a saved,
 * configured key. Mirrors the candidate list in POST /api/chat, so the
 * launcher is shown exactly when a question could get past the 503
 * "not configured" refusal.
 */
export function candidateProviderKeys(settings: { active_provider?: string | null; fallback_order?: unknown }): string[] {
  return Array.from(new Set([
    settings.active_provider,
    ...(Array.isArray(settings.fallback_order) ? settings.fallback_order : []),
  ].filter((k): k is string => typeof k === 'string' && k.length > 0)));
}

export function hasReadyProvider(
  settings: { active_provider?: string | null; fallback_order?: unknown },
  credRows: ReadonlyArray<{ provider_key: string; is_configured?: boolean | null; api_key_encrypted?: string | null }> | null | undefined,
): boolean {
  const keys = new Set(candidateProviderKeys(settings));
  return (credRows || []).some((c) => keys.has(c.provider_key) && Boolean(c.is_configured) && Boolean(c.api_key_encrypted));
}
