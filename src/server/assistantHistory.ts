/**
 * The assistant's past conversations (seen-ai-assistant-redesign-task.md 2-4).
 *
 * Everything here runs with the service role, so every read and write is
 * filtered by the signed-in person's own uid and shop -- that filter is the
 * whole access rule (the tables have no RLS policy and no API grants).
 * The small pure helpers at the top are tested alone.
 */

export const HISTORY_DAYS = 30;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REPLY_ID = /^[A-Za-z0-9_-]{8,64}$/;

export const isConversationId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
export const isReplyId = (value: unknown): value is string => typeof value === 'string' && REPLY_ID.test(value);

/** The list's title: the first question, on one line, cut at 80 characters. */
export function conversationTitle(question: string): string {
  const line = question.replace(/\s+/g, ' ').trim();
  if (!line) return '…';
  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

/**
 * Whether the question just sent still needs storing. A retry sends the
 * same request again; if the last stored message is already this question
 * (its reply never arrived), it is not stored twice.
 */
export function needsStoring(lastStored: { role: string; content: string } | null | undefined, question: string): boolean {
  return !(lastStored && lastStored.role === 'user' && lastStored.content === question);
}

export interface StoredReply {
  text: string;
  toolResults: Array<{ name: string; result: unknown }>;
  toolErrors: string[];
}

export interface HistoryOwner {
  tenantId: string;
  userId: string;
}

/**
 * Opens (or finds) the conversation and stores the question. Returns false,
 * without writing, when the id belongs to someone else.
 */
export async function storeQuestion(db: any, owner: HistoryOwner, conversationId: string, question: string): Promise<boolean> {
  const { data: existing, error } = await db
    .from('assistant_conversations')
    .select('id, tenant_id, user_id')
    .eq('id', conversationId)
    .maybeSingle();
  if (error) throw error;

  if (existing) {
    if (existing.user_id !== owner.userId || existing.tenant_id !== owner.tenantId) return false;
  } else {
    const { error: insertErr } = await db.from('assistant_conversations').insert({
      id: conversationId,
      tenant_id: owner.tenantId,
      user_id: owner.userId,
      title: conversationTitle(question),
    });
    if (insertErr) throw insertErr;
  }

  const { data: last } = await db
    .from('assistant_messages')
    .select('role, content')
    .eq('conversation_id', conversationId)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (needsStoring(last, question)) {
    const { error: msgErr } = await db.from('assistant_messages').insert({
      conversation_id: conversationId, role: 'user', content: question.slice(0, 20000),
    });
    if (msgErr) throw msgErr;
  }
  await db.from('assistant_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
  return true;
}

/** Stores a finished reply under a conversation this person owns (checked by storeQuestion). */
export async function storeReply(db: any, conversationId: string, reply: StoredReply, replyId: string | null): Promise<void> {
  if (!reply.text && reply.toolResults.length === 0 && reply.toolErrors.length === 0) return;
  const { error } = await db.from('assistant_messages').insert({
    conversation_id: conversationId,
    role: 'assistant',
    content: reply.text.slice(0, 20000),
    tool_results: reply.toolResults,
    tool_errors: reply.toolErrors,
    reply_id: replyId,
  });
  if (error) throw error;
  await db.from('assistant_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
}

const cutoff = () => new Date(Date.now() - HISTORY_DAYS * 86_400_000).toISOString();

/** This person's conversations from the last 30 days, newest first. */
export async function listConversations(db: any, owner: HistoryOwner) {
  const { data, error } = await db
    .from('assistant_conversations')
    .select('id, title, updated_at')
    .eq('user_id', owner.userId)
    .eq('tenant_id', owner.tenantId)
    .gte('updated_at', cutoff())
    .order('updated_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data || []).map((c: any) => ({ id: c.id, title: c.title, updatedAt: c.updated_at }));
}

/** One of this person's conversations with its messages, or null if it is not theirs (or gone). */
export async function readConversation(db: any, owner: HistoryOwner, conversationId: string) {
  const { data: conv, error } = await db
    .from('assistant_conversations')
    .select('id, title, updated_at')
    .eq('id', conversationId)
    .eq('user_id', owner.userId)
    .eq('tenant_id', owner.tenantId)
    .gte('updated_at', cutoff())
    .maybeSingle();
  if (error) throw error;
  if (!conv) return null;
  const { data: rows, error: msgErr } = await db
    .from('assistant_messages')
    .select('role, content, tool_results, tool_errors, reply_id, created_at')
    .eq('conversation_id', conversationId)
    .order('id', { ascending: true })
    .limit(400);
  if (msgErr) throw msgErr;
  return {
    id: conv.id,
    title: conv.title,
    messages: (rows || []).map((m: any) => ({
      role: m.role,
      content: m.content,
      ...(m.role === 'assistant' ? {
        toolResults: Array.isArray(m.tool_results) ? m.tool_results : [],
        ...(m.tool_errors?.length ? { toolErrors: m.tool_errors } : {}),
        ...(m.reply_id ? { id: m.reply_id } : {}),
        at: new Date(m.created_at).getTime(),
      } : {}),
    })),
  };
}

/** Deletes one of this person's conversations. True if something was deleted. */
export async function deleteConversation(db: any, owner: HistoryOwner, conversationId: string): Promise<boolean> {
  const { data, error } = await db
    .from('assistant_conversations')
    .delete()
    .eq('id', conversationId)
    .eq('user_id', owner.userId)
    .eq('tenant_id', owner.tenantId)
    .select('id');
  if (error) throw error;
  return Array.isArray(data) && data.length > 0;
}
