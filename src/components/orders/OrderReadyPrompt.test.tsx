// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeAll, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from '../../i18n/locales/ar.json';

const opened = vi.fn();
vi.mock('../../utils/whatsapp', async (orig) => ({ ...(await orig<typeof import('../../utils/whatsapp')>()), openWhatsApp: (a: unknown) => { opened(a); return true; } }));
import { OrderReadyPrompt, readyMessage } from './OrderReadyPrompt';

// seen-merchant-trial-test-2026-11-26.md, phase 2 item 6: an order reaching
// "ready" offers to tell the customer, with the shop's "order ready" template.
beforeAll(async () => {
  await i18n.use(initReactI18next).init({ lng: 'ar', resources: { ar: { translation: ar } }, interpolation: { escapeValue: false } });
});
afterEach(() => { cleanup(); opened.mockReset(); });

const ORDER = { customerName: 'فيصل', orderNumber: 7, totalAmount: 250, trackingToken: 'tok', phone: '0500000123' };

test('the message is the "order ready" template, filled', () => {
  const text = readyMessage(ORDER);
  expect(text).toContain('فيصل');
  expect(text).toContain('7');
  expect(text).toContain('/track/tok');
});

test('"send" opens WhatsApp to the customer with that message', () => {
  const onClose = vi.fn();
  render(<OrderReadyPrompt order={ORDER} onClose={onClose} />);
  fireEvent.click(screen.getByRole('button', { name: ar.orders.ready_prompt_send }));
  expect(opened).toHaveBeenCalledWith({ phone: '0500000123', message: readyMessage(ORDER), kind: 'customer' });
  expect(onClose).toHaveBeenCalled();
});

test('no mobile number: says so, no send button', () => {
  render(<OrderReadyPrompt order={{ ...ORDER, phone: '' }} onClose={() => {}} />);
  expect(screen.getByText(ar.orders.ready_prompt_no_phone)).toBeTruthy();
  expect(screen.queryByRole('button', { name: ar.orders.ready_prompt_send })).toBeNull();
});
