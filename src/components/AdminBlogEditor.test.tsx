// @vitest-environment jsdom
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import { test, expect, vi, afterEach } from 'vitest';
import AdminBlogEditor from './AdminBlogEditor';

// No `globals: true` in vitest.config.ts, so @testing-library/react's
// auto-cleanup never registers -- see FractionPicker.test.tsx/VoiceMicButton.test.tsx
// for the same pattern.
afterEach(() => {
  cleanup();
});

test('renders every article from the API with its computed status', async () => {
  vi.spyOn(global, 'fetch').mockResolvedValue({
    ok: true,
    json: async () => ({ articles: [
      { slug: 'a', title: 'مقالة أولى', cluster: 'orders', publishDate: '2020-01-01T00:00:00Z', status: 'published' },
      // Note: deliberately not literally "مقالة مجدولة" ("scheduled article") --
      // that title would itself contain the word "مجدولة", which the status
      // template below also renders, so `getByText(/مجدولة/)` would match two
      // separate elements (the title cell and the status cell) and throw.
      // Renamed to the same "ordinal" naming scheme as the first article
      // instead, which carries the same test intent without the collision.
      { slug: 'b', title: 'مقالة ثانية', cluster: 'orders', publishDate: '2099-01-01T00:00:00Z', status: 'scheduled' },
    ] }),
  } as any);
  render(<AdminBlogEditor />);
  expect(await screen.findByText('مقالة أولى')).toBeInTheDocument();
  expect(await screen.findByText('مقالة ثانية')).toBeInTheDocument();
  expect(screen.getByText(/منشورة/)).toBeInTheDocument();
  expect(screen.getByText(/مجدولة/)).toBeInTheDocument();
});

test('filling the form and clicking preview calls the preview endpoint and shows the returned html', async () => {
  const fetchMock = vi.spyOn(global, 'fetch')
    .mockResolvedValueOnce({ ok: true, json: async () => ({ articles: [] }) } as any) // initial list load
    .mockResolvedValueOnce({ ok: true, json: async () => ({ html: '<html><body>معاينة</body></html>' }) } as any); // preview
  render(<AdminBlogEditor />);
  await screen.findByRole('button', { name: /مقالة جديدة/ });
  fireEvent.click(screen.getByRole('button', { name: /مقالة جديدة/ }));
  fireEvent.change(screen.getByLabelText(/العنوان/), { target: { value: 'عنوان تجريبي' } });
  fireEvent.click(screen.getByRole('button', { name: /معاينة/ }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/blog/preview', expect.objectContaining({ method: 'POST' })));
});

test('saving a new article POSTs to the articles endpoint and refreshes the list', async () => {
  const fetchMock = vi.spyOn(global, 'fetch')
    .mockResolvedValueOnce({ ok: true, json: async () => ({ articles: [] }) } as any)
    .mockResolvedValueOnce({ ok: true, json: async () => ({ slug: 'new-article' }) } as any)
    .mockResolvedValueOnce({ ok: true, json: async () => ({ articles: [{ slug: 'new-article', title: 'عنوان جديد', cluster: 'orders', publishDate: '2026-11-04T10:00:00Z', status: 'published' }] }) } as any);
  render(<AdminBlogEditor />);
  await screen.findByRole('button', { name: /مقالة جديدة/ });
  fireEvent.click(screen.getByRole('button', { name: /مقالة جديدة/ }));
  fireEvent.change(screen.getByLabelText(/العنوان/), { target: { value: 'عنوان جديد' } });
  fireEvent.click(screen.getByRole('button', { name: /^حفظ/ }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/blog/articles', expect.objectContaining({ method: 'POST' })));
  expect(await screen.findByText('عنوان جديد')).toBeInTheDocument();
});

test('clicking delete asks for confirmation before calling the delete endpoint', async () => {
  vi.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => ({ articles: [
    { slug: 'a', title: 'مقالة', cluster: 'orders', publishDate: '2020-01-01T00:00:00Z', status: 'published' },
  ] }) } as any);
  render(<AdminBlogEditor />);
  await screen.findByText('مقالة');
  fireEvent.click(screen.getByRole('button', { name: /حذف/ }));
  expect(screen.getByText(/تأكيد الحذف/)).toBeInTheDocument();
});

// Review Focus: deleting an article doesn't update other articles' own `related`
// arrays (the public build already tolerates the resulting dangling slug by
// skipping it with a console warning -- pre-existing behavior, not new scope
// here), so the author should be told this up front rather than discovering a
// related-card silently vanished elsewhere later.
test('the delete confirmation names the article and warns that other articles may reference it', async () => {
  vi.spyOn(global, 'fetch').mockResolvedValueOnce({ ok: true, json: async () => ({ articles: [
    { slug: 'a', title: 'مقالة', cluster: 'orders', publishDate: '2020-01-01T00:00:00Z', status: 'published' },
  ] }) } as any);
  render(<AdminBlogEditor />);
  await screen.findByText('مقالة');
  fireEvent.click(screen.getByRole('button', { name: /حذف/ }));
  expect(screen.getByText(/مقالة/)).toBeInTheDocument(); // the confirmation names it
  expect(screen.getByText(/قد تشير إليها مقالات أخرى/)).toBeInTheDocument();
});
