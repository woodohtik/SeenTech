-- =============================================================================
-- seen-ai-assistant-redesign-task.md 2-4: the assistant's past conversations.
--
-- Founder's decisions (2026-11-20):
--  * kept for 30 days from the last message, then deleted;
--  * each person sees only their own conversations -- not the shop owner,
--    not other staff.
--
-- The server writes both tables while it answers (/api/chat) and serves
-- them through /api/assistant/conversations, always filtered by the
-- signed-in person. RLS on with no policy and no grants to the API roles,
-- so nothing reaches them through PostgREST; there is no path by which an
-- owner's session could read a cashier's rows.
--
-- The conversation id is made by the browser (a UUID) so the first message
-- can name it; the server refuses to write into an id that belongs to
-- someone else.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.assistant_conversations (
  id          uuid PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  title       text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_conversations_user_updated_idx
  ON public.assistant_conversations (user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS assistant_conversations_updated_idx
  ON public.assistant_conversations (updated_at);

CREATE TABLE IF NOT EXISTS public.assistant_messages (
  id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id  uuid NOT NULL REFERENCES public.assistant_conversations(id) ON DELETE CASCADE,
  role             text NOT NULL CHECK (role IN ('user', 'assistant')),
  content          text NOT NULL DEFAULT '' CHECK (char_length(content) <= 20000),
  -- The cards the reply showed, exactly as the tools returned them.
  tool_results     jsonb NOT NULL DEFAULT '[]'::jsonb,
  tool_errors      text[] NOT NULL DEFAULT '{}',
  -- The browser's id for an assistant reply, so a reopened reply can still be rated.
  reply_id         text CHECK (reply_id IS NULL OR char_length(reply_id) BETWEEN 8 AND 64),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_messages_conversation_idx
  ON public.assistant_messages (conversation_id, id);

ALTER TABLE public.assistant_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.assistant_messages ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.assistant_conversations FROM PUBLIC, anon, authenticated;
REVOKE ALL ON public.assistant_messages FROM PUBLIC, anon, authenticated;

-- 30 days after the last message the whole conversation goes (its messages
-- follow through the cascade). Hourly, with the same guarded pg_cron
-- pattern as 20261017030000_stock_operations_cleanup.sql; the server also
-- never lists anything older, so a missing pg_cron only delays the delete.
CREATE OR REPLACE FUNCTION public.cleanup_assistant_conversations() RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  DELETE FROM public.assistant_conversations WHERE updated_at < now() - interval '30 days';
$$;

REVOKE EXECUTE ON FUNCTION public.cleanup_assistant_conversations() FROM PUBLIC, anon, authenticated;

DO $outer$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule('seen_assistant_conversations_cleanup', '17 * * * *', $cron$SELECT public.cleanup_assistant_conversations();$cron$);
  END IF;
END $outer$;
