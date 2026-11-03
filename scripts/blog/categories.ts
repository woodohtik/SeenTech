export interface CategoryDef {
  slug: string;
  label: string;
  icon: string;
}

// Icon markup copied verbatim (whitespace normalized) from the chip nav in
// seen-blog-reference/01_المدونة_من_الخارج.html lines 204-270.
export const CATEGORIES: readonly CategoryDef[] = [
  {
    slug: 'management',
    label: 'إدارة محل التفصيل',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M3 21l18 0" /><path d="M3 7v1a3 3 0 0 0 6 0v-1m0 1a3 3 0 0 0 6 0v-1m0 1a3 3 0 0 0 6 0v-1h-18l2 -4h14l2 4" /><path d="M5 21l0 -10.15" /><path d="M19 21l0 -10.15" /><path d="M9 21v-4a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2v4" /></svg>',
  },
  {
    slug: 'orders',
    label: 'الطلبات والتسليم',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 7h10a2 2 0 0 1 2 2v10a2 2 0 0 1 -2 2h-10a2 2 0 0 1 -2 -2v-10a2 2 0 0 1 2 -2"/><path d="M12 3v4"/><path d="M9 14h6"/><path d="M9 17h3"/><path d="M12 10.5h.01"/></svg>',
  },
  {
    slug: 'measurements',
    label: 'المقاسات',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 11m-7 0a7 7 0 1 0 14 0a7 7 0 1 0 -14 0"/><path d="M10 11m-2.5 0a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0 -5 0"/><path d="M17 11v8h4"/><path d="M13.5 19v-2"/><path d="M10 18v.01"/></svg>',
  },
  {
    slug: 'software',
    label: 'اختيار البرنامج',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M9 5h-2a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2 -2v-12a2 2 0 0 0 -2 -2h-2" /><path d="M9 5a2 2 0 0 1 2 -2h2a2 2 0 0 1 2 2a2 2 0 0 1 -2 2h-2a2 2 0 0 1 -2 -2" /><path d="M9 14l2 2l4 -4" /></svg>',
  },
  {
    slug: 'season',
    label: 'الموسم: رمضان والعيد',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M4 7a2 2 0 0 1 2 -2h12a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-12a2 2 0 0 1 -2 -2l0 -12" /><path d="M16 3l0 4" /><path d="M8 3l0 4" /><path d="M4 11l16 0" /><path d="M8 15h2v2h-2l0 -2" /></svg>',
  },
  {
    slug: 'e-invoicing',
    label: 'الفوترة الإلكترونية',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M14 3v4a1 1 0 0 0 1 1h4" /><path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2" /><path d="M9 7l1 0" /><path d="M9 13l6 0" /><path d="M13 17l2 0" /></svg>',
  },
  {
    slug: 'womens',
    label: 'المشغل النسائي',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 3h5l1.5 4l3.5 5l-1.5 1.5l-1.5 -2l1.5 9.5h-12l1.5 -9.5l-1.5 2l-1.5 -1.5l3.5 -5z"/><path d="M12 6v15"/></svg>',
  },
  {
    slug: 'curtains',
    label: 'الستائر والتنجيد',
    icon: '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 4h18"/><path d="M5 4h5c0 4 -1 7 -3 9c1 2 1 5 1 7h-3z"/><path d="M19 4h-5c0 4 1 7 3 9c-1 2 -1 5 -1 7h3z"/></svg>',
  },
];

export function getCategory(slug: string): CategoryDef | undefined {
  return CATEGORIES.find(c => c.slug === slug);
}
