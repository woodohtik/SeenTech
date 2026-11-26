// @vitest-environment jsdom
import React from 'react';
import { afterEach, beforeAll, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import ar from '../../i18n/locales/ar.json';
import { CustomerStylePreferences } from './CustomerStylePreferences';

// seen-merchant-trial-test-2026-11-26.md, phase 2 item 3: the profile said
// "round neck, normal sleeve, no pocket" from the old fields, against what
// was saved. It reads the saved style fields now.
beforeAll(async () => {
  await i18n.use(initReactI18next).init({ lng: 'ar', resources: { ar: { translation: ar } }, interpolation: { escapeValue: false } });
});
afterEach(cleanup);

test('shows the saved cutting, padding and closure', () => {
  render(<CustomerStylePreferences measurements={{ cuttingType: 'saudi', collarPadding: 'hard', closureType: 'buttons', closureVisibility: 'visible' }} />);
  expect(screen.getByText(ar.customers.cutting_saudi)).toBeTruthy();
  expect(screen.getByText(ar.orders.padding_hard)).toBeTruthy();
  expect(screen.getByText(ar.inventory.button)).toBeTruthy();
});

test('nothing saved reads "not specified", never an invented default', () => {
  render(<CustomerStylePreferences measurements={{}} />);
  expect(screen.getAllByText(ar.orders.not_specified)).toHaveLength(4);
});
