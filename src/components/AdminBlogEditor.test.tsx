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

test('a failed save (409 slug collision) keeps the admin on the form, shows the error, and does not refresh the list', async () => {
  const fetchMock = vi.spyOn(global, 'fetch')
    .mockResolvedValueOnce({ ok: true, json: async () => ({ articles: [] }) } as any) // initial list load
    .mockResolvedValueOnce({ ok: false, status: 409, json: async () => ({ error: 'an article with this slug already exists', existingTitle: 'عنوان آخر' }) } as any); // rejected save
  render(<AdminBlogEditor />);
  await screen.findByRole('button', { name: /مقالة جديدة/ });
  fireEvent.click(screen.getByRole('button', { name: /مقالة جديدة/ }));
  fireEvent.change(screen.getByLabelText(/العنوان/), { target: { value: 'عنوان مكرر' } });
  fireEvent.click(screen.getByRole('button', { name: /^حفظ/ }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/blog/articles', expect.objectContaining({ method: 'POST' })));
  expect(await screen.findByText(/an article with this slug already exists/)).toBeInTheDocument();
  // Stayed on the form -- a failed save never silently looks like a success.
  expect(screen.getByLabelText(/العنوان/)).toHaveValue('عنوان مكرر');
  // No third call refreshing the list after the rejected save.
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test('a failed fetch (404) when opening the edit form does not open a blank form', async () => {
  const fetchMock = vi.spyOn(global, 'fetch')
    .mockResolvedValueOnce({ ok: true, json: async () => ({ articles: [
      { slug: 'a', title: 'مقالة', cluster: 'orders', publishDate: '2020-01-01T00:00:00Z', status: 'published' },
    ] }) } as any) // initial list load
    .mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ error: 'not found' }) } as any); // edit fetch
  render(<AdminBlogEditor />);
  await screen.findByText('مقالة');
  fireEvent.click(screen.getByRole('button', { name: /تعديل/ }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/blog/articles/a'));
  expect(await screen.findByText(/not found/)).toBeInTheDocument();
  // Stayed on the list -- no blank form opened on the failed fetch.
  expect(screen.queryByLabelText(/العنوان/)).not.toBeInTheDocument();
});

test('clicking edit populates the form with the fetched article (title, meta, category, publish date, related, body)', async () => {
  const fetchMock = vi.spyOn(global, 'fetch')
    .mockResolvedValueOnce({ ok: true, json: async () => ({ articles: [
      { slug: 'a', title: 'عنوان قديم', cluster: 'orders', publishDate: '2020-06-15T08:30:00Z', status: 'published' },
      { slug: 'b', title: 'مقالة أخرى', cluster: 'orders', publishDate: '2020-01-01T00:00:00Z', status: 'published' },
    ] }) } as any) // initial list load
    .mockResolvedValueOnce({ ok: true, json: async () => ({
      title: 'عنوان قديم',
      metaDescription: 'وصف قديم',
      cluster: 'orders',
      publishDate: '2020-06-15T08:30:00Z',
      related: ['b'],
      body: 'نص المقالة القديم',
    }) } as any); // edit fetch for slug 'a'
  render(<AdminBlogEditor />);
  await screen.findByText('عنوان قديم');
  fireEvent.click(screen.getAllByRole('button', { name: /تعديل/ })[0]);
  await waitFor(() => expect(fetchMock).toHaveBeenCalledWith('/api/admin/blog/articles/a'));

  expect(await screen.findByLabelText(/العنوان/)).toHaveValue('عنوان قديم');
  expect(screen.getByLabelText(/الوصف التعريفي/)).toHaveValue('وصف قديم');
  expect(screen.getByLabelText(/التصنيف/)).toHaveValue('orders');
  expect(screen.getByLabelText(/المحتوى/)).toHaveValue('نص المقالة القديم');

  // The datetime-local field's value is derived from the ISO publishDate via
  // the same local-time field math the implementation uses (asserted this
  // way, rather than a hardcoded string, so the test doesn't depend on the
  // host machine's timezone).
  const expectedLocalValue = (() => {
    const d = new Date('2020-06-15T08:30:00Z');
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  })();
  expect(screen.getByLabelText(/تاريخ النشر/)).toHaveValue(expectedLocalValue);

  // The related multi-select is pre-selected with the fetched article's own slug.
  const relatedSelect = screen.getByLabelText(/مقالات ذات صلة/) as HTMLSelectElement;
  const selectedRelated = Array.from(relatedSelect.selectedOptions).map(o => o.value);
  expect(selectedRelated).toEqual(['b']);
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
