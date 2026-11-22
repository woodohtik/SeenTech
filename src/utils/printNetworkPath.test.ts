// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

// seen-readiness-fixes-task.md P4 (OPERATIONS-12): with no paired print
// agent, the cloud cannot reach a shop's network printer -- say what to do.
vi.mock('i18next', () => ({ default: { t: (k: string) => k } }));
vi.mock('./printRelayClient', () => ({ isRelayPaired: () => false, authedJsonHeaders: async () => ({}) }));

import { isLocalServer, probeNetworkPrinter } from './printerDiscovery';

afterEach(() => vi.restoreAllMocks());

describe('network printing without a paired agent', () => {
  it('tells a local install from the cloud', () => {
    for (const h of ['localhost', '127.0.0.1', '192.168.1.20', '10.0.0.5', '172.20.1.1', 'pos.local']) expect(isLocalServer(h)).toBe(true);
    for (const h of ['www.seentech.io', 'staging.seentech.io', '172.40.1.1', '8.8.8.8']) expect(isLocalServer(h)).toBe(false);
  });

  it('on the cloud site, the probe says to pair the agent and calls no server', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch');
    // jsdom's page is on localhost; ask as the cloud site would.
    Object.defineProperty(window, 'location', { value: { hostname: 'www.seentech.io' }, configurable: true });
    expect(await probeNetworkPrinter('192.168.1.50')).toEqual({ ok: false, message: 'printing.pair_agent_for_network' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
