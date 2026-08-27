-- =============================================================================
--  سجل تدقيق لاستدعاءات أدوات "مساعد سين الذكي" (Data Access Tools)
--  ------------------------------------------------------------------------
--  كل استدعاء لأداة بيانات (getSalesSummary، searchInvoices، getRevenueReport، ...)
--  يُسجَّل هنا: من استدعاها، لأي مستأجر، بأي معاملات، ومتى — لمراجعة أي إساءة
--  استخدام أو تسريب محتمل لاحقاً. الوصول حصراً عبر supabaseAdmin من مسار
--  /api/chat في server.ts؛ لا وصول مباشر من المتصفح، لذا بلا سياسات RLS.
-- =============================================================================

CREATE TABLE IF NOT EXISTS assistant_tool_calls (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tenant_id   uuid NOT NULL,
  user_id     text NOT NULL,
  user_role   text NOT NULL,
  tool_name   text NOT NULL,
  params      jsonb NOT NULL DEFAULT '{}'::jsonb,
  denied      boolean NOT NULL DEFAULT false,
  deny_reason text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS assistant_tool_calls_tenant_idx ON assistant_tool_calls (tenant_id, created_at);
CREATE INDEX IF NOT EXISTS assistant_tool_calls_tool_idx ON assistant_tool_calls (tool_name, created_at);

ALTER TABLE assistant_tool_calls ENABLE ROW LEVEL SECURITY;
-- عمداً بلا أي سياسة: الوصول حصراً عبر مفتاح service_role من السيرفر.
