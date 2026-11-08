// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { test, expect, vi, afterEach, beforeAll } from 'vitest';
import { ready } from '../../i18n/config';
import CustomerMeasurementsForm from './CustomerMeasurementsForm';

// react-i18next needs an initialized i18next instance before any `t()` call
// resolves a real string instead of the raw key -- see src/i18n/createI18n.ts's
// own comment ("Callers must await `ready` before their first render").
beforeAll(async () => {
  await ready;
});

// No `globals: true` in vitest.config.ts, so @testing-library/react's
// auto-cleanup never registers -- see VoiceMicButton.test.tsx/AdminBlogEditor.test.tsx
// for the same pattern.
afterEach(() => {
  cleanup();
});

const GET_RESPONSE = {
  customer_name: 'أحمد',
  shop_name: 'محل الاختبار',
  shop_logo_url: null,
  measurement_unit: 'cm',
  measurements: { chest: 52 },
};

// Code review finding (Important #1): after a successful save, the success
// message replaced the Save button but nothing reset `saved` -- so an edit
// made right after saving had no way to be saved again, while the page kept
// showing "saved successfully".
test('editing a value after a successful save brings the Save button back instead of still claiming "saved"', async () => {
  const fetchMock = vi.spyOn(global, 'fetch')
    .mockResolvedValueOnce({ ok: true, json: async () => GET_RESPONSE } as any) // initial GET
    .mockResolvedValueOnce({ ok: true, json: async () => ({ ok: true }) } as any); // POST on save

  render(<CustomerMeasurementsForm token="test-token" />);

  const saveButton = await screen.findByText('حفظ المقاسات');
  fireEvent.click(saveButton);

  await waitFor(() => expect(screen.getByText('تم حفظ مقاساتك بنجاح.')).toBeInTheDocument());
  expect(screen.queryByText('حفظ المقاسات')).toBeNull();

  // Edit a value via VisualMeasurements (a real option button, not a mock).
  fireEvent.click(screen.getByText('صيني'));

  expect(screen.queryByText('تم حفظ مقاساتك بنجاح.')).toBeNull();
  expect(screen.getByText('حفظ المقاسات')).toBeInTheDocument();
  expect(fetchMock).toHaveBeenCalledTimes(2); // no extra network call just from editing
});
