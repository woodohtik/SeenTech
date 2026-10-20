export interface PlanFormInput {
  id: string;
  name: string;
  price: string;
  maxStaff: string;
  maxOrders: string;
}

export type PlanFormField = 'id' | 'name' | 'price' | 'maxStaff' | 'maxOrders';

export interface PlanFormValidation {
  valid: boolean;
  errors: Partial<Record<PlanFormField, string>>;
}

/** Lowercase letters/digits/underscore, 2-40 chars, must start with a letter. Matches the existing seeded ids (free, basic). */
export const PLAN_ID_PATTERN = /^[a-z][a-z0-9_]{1,39}$/;

function isNonNegativeInteger(value: string): boolean {
  if (value.trim() === '') return false;
  const n = Number(value);
  return Number.isFinite(n) && Number.isInteger(n) && n >= 0;
}

/**
 * docs/superpowers/plans/2026-10-20-plans-management.md (Task 1) -- pure,
 * no React/Supabase dependency, so the plans-catalog create/edit modal's
 * client-side checks can be unit-tested in isolation. Mirrors the DB's own
 * CHECK constraints (price/max_staff/max_orders >= 0, max_staff/max_orders
 * additionally INTEGER) so a rejected submission never has to round-trip
 * to Postgres first. `id` is only validated when creating -- it's the PK
 * and immutable after creation, so the edit form renders it read-only and
 * this function must not block a save with a (deliberately ignored) blank.
 */
export function validatePlanForm(input: PlanFormInput, isEditing: boolean): PlanFormValidation {
  const errors: PlanFormValidation['errors'] = {};

  if (!isEditing) {
    if (!input.id.trim()) {
      errors.id = 'required';
    } else if (!PLAN_ID_PATTERN.test(input.id)) {
      errors.id = 'invalid_format';
    }
  }

  if (!input.name.trim()) {
    errors.name = 'required';
  }

  const price = Number(input.price);
  if (!Number.isFinite(price) || price < 0) {
    errors.price = 'invalid';
  }

  if (!isNonNegativeInteger(input.maxStaff)) {
    errors.maxStaff = 'invalid';
  }

  if (!isNonNegativeInteger(input.maxOrders)) {
    errors.maxOrders = 'invalid';
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
