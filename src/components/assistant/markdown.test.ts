import { describe, expect, it } from 'vitest';
import { isInternalHref, markdownToPlainText, parseInline, parseMarkdown } from './markdown';

describe('parseInline', () => {
  it('reads bold without leaving the stars behind', () => {
    expect(parseInline('مبيعات اليوم **4,850 ريالاً** من 12 فاتورة')).toEqual([
      { type: 'text', text: 'مبيعات اليوم ' },
      { type: 'strong', children: [{ type: 'text', text: '4,850 ريالاً' }] },
      { type: 'text', text: ' من 12 فاتورة' },
    ]);
  });

  it('turns a link to a page inside the app into a link', () => {
    expect(parseInline('افتح [الطلبات](/orders) الآن')).toEqual([
      { type: 'text', text: 'افتح ' },
      { type: 'link', href: '/orders', children: [{ type: 'text', text: 'الطلبات' }] },
      { type: 'text', text: ' الآن' },
    ]);
  });

  it('keeps the words of an outside link but never links to it', () => {
    expect(parseInline('راجع [الموقع](https://example.com) أو [هذا](javascript:alert(1))')).toEqual([
      { type: 'text', text: 'راجع الموقع أو هذا)' },
    ]);
    expect(isInternalHref('//evil.example')).toBe(false);
    expect(isInternalHref('/reports?tab=vat')).toBe(true);
  });

  it('leaves a lone star or an unclosed bold as text', () => {
    expect(parseInline('5 * 3 = 15')).toEqual([{ type: 'text', text: '5 * 3 = 15' }]);
    expect(parseInline('**غير مغلق')).toEqual([{ type: 'text', text: '**غير مغلق' }]);
  });

  it('drops inline code marks and keeps the word', () => {
    expect(parseInline('اضغط `حفظ`')).toEqual([{ type: 'text', text: 'اضغط حفظ' }]);
  });
});

describe('parseMarkdown', () => {
  it('reads a paragraph followed by a numbered list', () => {
    const blocks = parseMarkdown('من صفحة الطلبات:\n1. اضغط «إنشاء طلب جديد».\n2. اختر الزبون.\n3. احفظ.');
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: 'paragraph', children: [{ type: 'text', text: 'من صفحة الطلبات:' }] });
    expect(blocks[1]).toMatchObject({ type: 'list', ordered: true });
    expect((blocks[1] as any).items).toHaveLength(3);
  });

  it('reads bullets written with a dash, a star or a dot', () => {
    const blocks = parseMarkdown('- أول\n* ثانٍ\n• ثالث');
    expect(blocks).toEqual([
      {
        type: 'list', ordered: false, start: 1,
        items: [[{ type: 'text', text: 'أول' }], [{ type: 'text', text: 'ثانٍ' }], [{ type: 'text', text: 'ثالث' }]],
      },
    ]);
  });

  it('keeps counting when a nested bullet list splits a numbered list', () => {
    const blocks = parseMarkdown('1. انتقل للمخزون.\n2. اضغط «إضافة».\n3. أدخل التفاصيل:\n- الاسم\n- السعر\n4. اضغط حفظ.');
    expect(blocks.map((b) => b.type)).toEqual(['list', 'list', 'list']);
    expect(blocks[2]).toMatchObject({ type: 'list', ordered: true, start: 4 });
    expect(markdownToPlainText('1. أ\n- ب\n2. ج')).toBe('1. أ\n\n• ب\n\n2. ج');
  });

  it('separates paragraphs on a blank line and keeps a soft line break inside one', () => {
    const blocks = parseMarkdown('سطر أول\nسطر ثانٍ\n\nفقرة ثانية');
    expect(blocks).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'سطر أول\nسطر ثانٍ' }] },
      { type: 'paragraph', children: [{ type: 'text', text: 'فقرة ثانية' }] },
    ]);
  });

  it('starts a new list when the kind changes, and reads a heading', () => {
    const blocks = parseMarkdown('## الخطوات\n1. واحد\n- نقطة');
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'list', 'list']);
    expect((blocks[1] as any).ordered).toBe(true);
    expect((blocks[2] as any).ordered).toBe(false);
  });

  it('reads bold inside a list item', () => {
    const blocks = parseMarkdown('1. اضغط **حفظ**');
    expect((blocks[0] as any).items[0]).toEqual([
      { type: 'text', text: 'اضغط ' },
      { type: 'strong', children: [{ type: 'text', text: 'حفظ' }] },
    ]);
  });

  it('handles empty and partial input while a reply is still streaming', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('مبيعات اليوم **4')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: 'مبيعات اليوم **4' }] },
    ]);
  });
});

describe('markdownToPlainText', () => {
  it('gives the words without any marks', () => {
    expect(markdownToPlainText('الإجمالي **4,850**\n\n1. أول\n2. ثانٍ')).toBe('الإجمالي 4,850\n\n1. أول\n2. ثانٍ');
  });
});
