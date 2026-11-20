import { describe, expect, it } from 'vitest';
import { conversationTitle, isConversationId, isReplyId, needsStoring } from './assistantHistory';

describe('isConversationId', () => {
  it('accepts a UUID and nothing else', () => {
    expect(isConversationId('3f2b8c1e-9a4d-4c7e-8b21-5d6f7a8b9c0d')).toBe(true);
    expect(isConversationId('3f2b8c1e9a4d4c7e8b215d6f7a8b9c0d')).toBe(false);
    expect(isConversationId("'; delete from x; --")).toBe(false);
    expect(isConversationId(undefined)).toBe(false);
  });
});

describe('isReplyId', () => {
  it('accepts the browser reply ids', () => {
    expect(isReplyId('3f2b8c1e-9a4d-4c7e-8b21-5d6f7a8b9c0d')).toBe(true);
    expect(isReplyId('rmk2abc123xyz')).toBe(true);
    expect(isReplyId('short')).toBe(false);
  });
});

describe('conversationTitle', () => {
  it('is the question on one line, cut at 80 characters', () => {
    expect(conversationTitle('  كم مبيعات\nاليوم؟ ')).toBe('كم مبيعات اليوم؟');
    const long = conversationTitle('س'.repeat(200));
    expect(long).toHaveLength(80);
    expect(long.endsWith('…')).toBe(true);
    expect(conversationTitle('   ')).toBe('…');
  });
});

describe('needsStoring', () => {
  it('does not store a retried question twice', () => {
    expect(needsStoring({ role: 'user', content: 'كم مبيعات اليوم؟' }, 'كم مبيعات اليوم؟')).toBe(false);
  });

  it('stores a new question, or the same question asked again after a reply', () => {
    expect(needsStoring(null, 'سؤال')).toBe(true);
    expect(needsStoring({ role: 'assistant', content: 'رد' }, 'سؤال')).toBe(true);
    expect(needsStoring({ role: 'user', content: 'سؤال آخر' }, 'سؤال')).toBe(true);
  });
});
