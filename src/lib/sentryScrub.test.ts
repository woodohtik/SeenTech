import { describe, expect, it } from 'vitest';
import { scrubBreadcrumb, scrubEvent, scrubText, scrubUrl, sentryEnvironment, STALE_BUILD_ERROR } from './sentryScrub';

// seen-sentry-setup-task.md section 7 (PDPL): the "canary" -- an event
// carrying every kind of personal value the app handles. Not one of them may
// reach the event that is sent.
const CANARIES = [
  '0501234567', '+966501234567', '966551234567', 'abdullah.ali@example.com', 'عبدالله علي',
  '7f3a9c2e5b8d4e1fa2c3', '4b81d0aa9c7e4f23b1d5', '300000000000003', '192.168.10.24', '85.12.4.200',
  'شركة الأناقة', 'حي النرجس', 'كتف 48',
];

function canaryEvent() {
  return {
    message: 'Order failed for 0501234567 (abdullah.ali@example.com)',
    exception: { values: [{ type: 'Error', value: 'duplicate key value violates unique constraint "customers_phone_key" Key (phone)=(+966501234567) already exists.' }] },
    request: {
      url: 'https://www.seentech.io/track/7f3a9c2e5b8d4e1fa2c3?ref=966551234567&token=4b81d0aa9c7e4f23b1d5',
      method: 'POST',
      data: { customer_name: 'عبدالله علي', phone: '0501234567' },
      cookies: { sb: 'x' },
      headers: { 'x-forwarded-for': '85.12.4.200', authorization: 'Bearer abc' },
      query_string: 'token=4b81d0aa9c7e4f23b1d5',
    },
    user: { id: 'staff-1', email: 'abdullah.ali@example.com', username: 'عبدالله علي', ip_address: '85.12.4.200' },
    extra: {
      order: { id: 'o-1', customerName: 'عبدالله علي', measurements: { shoulder: 'كتف 48' } },
      orderId: 'o-1',
      buyerTrn: '300000000000003',
      companyName: 'شركة الأناقة',
      address: 'حي النرجس',
      note: 'call +966501234567 from 192.168.10.24',
      measurements: { shoulder: 'كتف 48' },
    },
    contexts: { form: { email: 'abdullah.ali@example.com', step: 2 }, browser: { name: 'Chrome' } },
    tags: { tenant_id: 't-1', role: 'cashier', url: '/measurements/4b81d0aa9c7e4f23b1d5' },
    breadcrumbs: [
      { category: 'console', message: 'raw {"phone":"0501234567"}' },
      { category: 'fetch', data: { url: '/api/public/order-tracking/7f3a9c2e5b8d4e1fa2c3', method: 'GET', status_code: 200, request_body: '{"phone":"0501234567"}' } },
      { category: 'ui.click', message: 'button.save[text="عبدالله علي"]', data: { text: 'عبدالله علي' } },
      { category: 'navigation', data: { from: '/orders', to: '/track/7f3a9c2e5b8d4e1fa2c3' } },
    ],
  };
}

describe('the canary: no personal value reaches Sentry', () => {
  it('not one of them survives anywhere in the event', () => {
    const sent = JSON.stringify(scrubEvent(canaryEvent()));
    for (const value of CANARIES) expect(sent, value).not.toContain(value);
  });

  it('what stays is technical: ids, tags, the cleaned link, the kind of error', () => {
    const e = scrubEvent(canaryEvent())!;
    expect(e.user).toEqual({ id: 'staff-1' });
    expect(e.request).toEqual({ url: 'https://www.seentech.io/track/[token]?ref=[token]&token=[token]', method: 'POST' });
    expect(e.extra).toMatchObject({ orderId: 'o-1', order: '[removed]', measurements: '[removed]', buyerTrn: '[redacted]' });
    expect(e.exception.values[0].value).toContain('Key (phone)=[redacted]');
    expect(e.tags).toMatchObject({ tenant_id: 't-1', role: 'cashier', url: '/measurements/[token]' });
    expect(e.contexts.browser).toEqual({ name: 'Chrome' });
    expect(e.breadcrumbs.map((b: any) => b.category)).toEqual(['fetch', 'ui.click', 'navigation']);
  });

  it('no IP at all, no body, no cookies, no headers', () => {
    const e = scrubEvent(canaryEvent())!;
    expect(JSON.stringify(e)).not.toMatch(/ip_address|cookies|headers|request_body|"data"\s*:\s*\{\s*"customer/);
  });
});

describe('the pieces', () => {
  it.each([
    ['0501234567', '[phone]'],
    ['+966501234567', '[phone]'],
    ['00966501234567', '[phone]'],
    ['call 966551234567 now', 'call [phone] now'],
    ['a.b@shop.sa', '[email]'],
    ['Key (phone)=(0501234567) already exists', 'Key (phone)=[redacted] already exists'],
    ['TRN 310123456700003', 'TRN [trn]'],
    ['from 10.0.0.12', 'from [ip]'],
  ])('%s -> %s', (raw, clean) => {
    expect(scrubText(raw)).toBe(clean);
  });

  it('keeps what is not personal: an order number, an amount, a version', () => {
    expect(scrubText('order 1042 total 287.50 build f5852d3-202611251930')).toBe('order 1042 total 287.50 build f5852d3-202611251930');
  });

  it('links: tracking, measurements, partner invites, long random segments', () => {
    expect(scrubUrl('/track/abc123')).toBe('/track/[token]');
    expect(scrubUrl('https://www.seentech.io/measurements/4b81d0aa9c7e?x=1')).toBe('https://www.seentech.io/measurements/[token]?x=1');
    expect(scrubUrl('/api/x/AbCdEfGhIjKlMnOpQrStUvWx12/y')).toBe('/api/x/[token]/y');
    expect(scrubUrl('/orders?page=2')).toBe('/orders?page=2');
  });

  it('console breadcrumbs are dropped; a click keeps no text', () => {
    expect(scrubBreadcrumb({ category: 'console', message: 'x' })).toBeNull();
    expect(scrubBreadcrumb({ category: 'ui.click', message: 'div > button.pay', data: { text: 'x' } })).toEqual({ category: 'ui.click', message: 'div > button.pay' });
  });

  it('environment: production, staging (preview) or development', () => {
    expect(sentryEnvironment('production')).toBe('production');
    expect(sentryEnvironment('preview')).toBe('staging');
    expect(sentryEnvironment(undefined, 'development')).toBe('development');
  });

  it('a chunk missing after an update is recognised (sent as a warning)', () => {
    expect(STALE_BUILD_ERROR.test('Failed to fetch dynamically imported module: https://x/assets/a.js')).toBe(true);
    expect(STALE_BUILD_ERROR.test('Cannot read properties of undefined')).toBe(false);
  });
});
