import { describe, expect, it } from 'vitest';
import { candidateProviderKeys, hasReadyProvider } from './assistantReadiness';

const settings = { active_provider: 'openai', fallback_order: ['groq', 'openai', 'gemini'] };

describe('candidateProviderKeys', () => {
  it('is the active provider, then the fallback order, once each', () => {
    expect(candidateProviderKeys(settings)).toEqual(['openai', 'groq', 'gemini']);
    expect(candidateProviderKeys({ active_provider: null, fallback_order: null })).toEqual([]);
  });
});

describe('hasReadyProvider', () => {
  it('is false with no credentials at all (the production case on 2026-11-20)', () => {
    expect(hasReadyProvider(settings, [])).toBe(false);
    expect(hasReadyProvider(settings, null)).toBe(false);
  });

  it('needs a saved key that is marked configured', () => {
    expect(hasReadyProvider(settings, [{ provider_key: 'openai', is_configured: false, api_key_encrypted: 'x' }])).toBe(false);
    expect(hasReadyProvider(settings, [{ provider_key: 'openai', is_configured: true, api_key_encrypted: null }])).toBe(false);
    expect(hasReadyProvider(settings, [{ provider_key: 'openai', is_configured: true, api_key_encrypted: 'x' }])).toBe(true);
  });

  it('counts a fallback provider, but not one outside the chosen list', () => {
    expect(hasReadyProvider(settings, [{ provider_key: 'gemini', is_configured: true, api_key_encrypted: 'x' }])).toBe(true);
    expect(hasReadyProvider(settings, [{ provider_key: 'anthropic', is_configured: true, api_key_encrypted: 'x' }])).toBe(false);
  });
});
