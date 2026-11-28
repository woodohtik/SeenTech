-- seen-open-verticals-task.md, wave 1 (shared item 2): appointments -- a
-- women's shop's fittings, a furniture shop's measurement visit, pickup,
-- delivery and installation -- for a customer and (optionally) one order.
-- A fitting's note and the count of fittings live here, on the order's
-- appointments. The reminder is a WhatsApp message the staff send from the
-- app (wa.me), as every message today.
--
-- Read: orders.view; book / change / remove: orders.create or orders.edit.
--
-- Test: supabase/tests/appointments_test.sql
-- Rollback: supabase/rollbacks/20270124_appointments.down.sql

CREATE TABLE IF NOT EXISTS public.appointments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id    uuid REFERENCES public.branches(id) ON DELETE SET NULL,
  customer_id  uuid REFERENCES public.customers(id) ON DELETE CASCADE,
  order_id     uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  kind         text NOT NULL CHECK (kind IN ('fitting', 'measurement_visit', 'pickup', 'delivery', 'installation', 'other')),
  starts_at    timestamptz NOT NULL,
  duration_min integer NOT NULL DEFAULT 30 CHECK (duration_min BETWEEN 5 AND 600),
  address      text,
  staff_id     uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  status       text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'done', 'cancelled', 'no_show')),
  notes        text CHECK (notes IS NULL OR length(notes) <= 500),
  created_by   uuid REFERENCES public.staff(id) ON DELETE SET NULL DEFAULT public.app_current_staff_id(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_appointments_tenant_time ON public.appointments (tenant_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_appointments_order ON public.appointments (order_id) WHERE order_id IS NOT NULL;

ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS appointments_read ON public.appointments;
CREATE POLICY appointments_read ON public.appointments FOR SELECT
  USING (app_is_super_admin() OR (tenant_id = app_current_tenant_id() AND app_has_permission('orders.view')));

-- Its customer and order are the shop's own.
DROP POLICY IF EXISTS appointments_insert ON public.appointments;
CREATE POLICY appointments_insert ON public.appointments FOR INSERT
  WITH CHECK (tenant_id = app_current_tenant_id()
              AND (app_has_permission('orders.create') OR app_has_permission('orders.edit'))
              AND (customer_id IS NULL OR EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_id AND c.tenant_id = appointments.tenant_id))
              AND (order_id IS NULL OR EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND o.tenant_id = appointments.tenant_id)));
DROP POLICY IF EXISTS appointments_update ON public.appointments;
CREATE POLICY appointments_update ON public.appointments FOR UPDATE
  USING (tenant_id = app_current_tenant_id() AND (app_has_permission('orders.create') OR app_has_permission('orders.edit')))
  WITH CHECK (tenant_id = app_current_tenant_id()
              AND (customer_id IS NULL OR EXISTS (SELECT 1 FROM public.customers c WHERE c.id = customer_id AND c.tenant_id = appointments.tenant_id))
              AND (order_id IS NULL OR EXISTS (SELECT 1 FROM public.orders o WHERE o.id = order_id AND o.tenant_id = appointments.tenant_id)));
DROP POLICY IF EXISTS appointments_delete ON public.appointments;
CREATE POLICY appointments_delete ON public.appointments FOR DELETE
  USING (tenant_id = app_current_tenant_id() AND (app_has_permission('orders.create') OR app_has_permission('orders.edit')));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.appointments TO authenticated;
