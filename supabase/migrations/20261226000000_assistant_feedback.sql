-- =============================================================================
-- seen-ai-assistant-redesign-task.md 2-1: rating the assistant's answers.
--
-- One row per rated reply per person: "useful" or "not useful", with an
-- optional comment. Founder's decision (2026-11-20): the question and the
-- names of the tools the reply used are kept, the answer text is not -- the
-- answer carries the shop's own figures, and the super admin reading these
-- does not need them to see which questions go wrong.
--
-- Written and read only by the server (service role): /api/assistant-feedback
-- for the shop's staff, /api/super-admin/assistant-feedback for the platform.
-- RLS on with no policy, and no grants to the API roles, so nothing reaches
-- it through PostgREST.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.assistant_feedback (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL,
  -- The client's id for the reply, so rating the same reply again changes
  -- the rating instead of adding a row.
  message_key  text NOT NULL CHECK (char_length(message_key) BETWEEN 8 AND 64),
  rating       smallint NOT NULL CHECK (rating IN (-1, 1)),
  comment      text CHECK (comment IS NULL OR char_length(comment) <= 500),
  question     text CHECK (question IS NULL OR char_length(question) <= 1000),
  tool_names   text[] NOT NULL DEFAULT '{}' CHECK (cardinality(tool_names) <= 12),
  page         text CHECK (page IS NULL OR char_length(page) <= 32),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, message_key)
);

CREATE INDEX IF NOT EXISTS assistant_feedback_created_idx
  ON public.assistant_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS assistant_feedback_tenant_created_idx
  ON public.assistant_feedback (tenant_id, created_at DESC);

ALTER TABLE public.assistant_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.assistant_feedback FROM PUBLIC, anon, authenticated;
