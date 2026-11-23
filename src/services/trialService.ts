/**
 * trialService
 * ------------
 * seen-readiness-fixes-task.md P6 (PLATFORM-19): the trial is started, locked
 * and extended by the database (the sign-up trigger, trial_lock_sweep,
 * admin_extend_trial). The client wrappers that used to live here
 * (startTrial, activateSubscription, captureTrialLead, hasUsedTrial,
 * seedTrialData, computeTrialStatus) were never called by any screen and
 * were removed; has_used_trial and start_tenant_trial are server-only now
 * (20270110000000). What is left is the disabled test-data wipe below.
 */

import i18n from 'i18next';

/**
 * DISABLED (seen-cto-sprint0-critical-fixes-task.md item 6, BO-14):
 * this used to run ~12 sequential, non-atomic client-side deletes across
 * orders/customers/inventory/suppliers/staff/notifications/tax_invoices,
 * including two hard-coded fallbacks that deleted ANY row matching
 * phone IN ('0599999999','0588888888') or sku IN ('COT-WHT','BTN-SDF')
 * regardless of is_test -- a real customer or product that happens to
 * use one of those exact values was deleted outright. It also deleted
 * tax_invoices (issued ZATCA e-invoices) for any order flagged is_test,
 * and orders.is_test was (until item 5 of the same task) settable by
 * any staff member, making "flag then wipe" a real fiscal-record-
 * destruction path. Every delete's error was only console.warn'd, never
 * aborting, so a partial failure still reported {success:true}.
 *
 * Stopped outright rather than rewritten: a correct replacement (a
 * transactional, owner-only SECURITY DEFINER RPC touching only rows
 * actually created by the data-seed, never tax_invoices) needs its own
 * dedicated task, not a same-day patch under this emergency sprint.
 */
export async function deleteTestDataForTenant(_tenantId: string): Promise<{ success: boolean; deletedCount: number; error?: string }> {
  return { success: false, deletedCount: 0, error: i18n.t('common.delete_test_data_disabled', 'هذه الميزة معطَّلة مؤقتاً حالياً لإعادة تصميمها بشكل أكثر أماناً.') };
}

