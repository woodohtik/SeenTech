import { supabase } from '../lib/supabase/client';

export const logEmployeeAction = async (
  tenantId: string,
  staffId: string,
  staffName: string,
  action: string,
  details: string,
  branchId?: string,
  branchName?: string,
  previousValue?: any,
  newValue?: any
) => {
  try {
    // Audit log entry
    await supabase.from('employee_activity_logs').insert({
      tenant_id: tenantId,
      staff_id: staffId,
      staff_name: staffName,
      branch_id: branchId || null,
      branch_name: branchName || null,
      action,
      details,
      previous_value: previousValue || null,
      new_value: newValue || null,
      occurred_at: new Date().toISOString()
    });

    // Alert for Sensitive Operations
    const sensitiveActions = ['delete_invoice', 'manual_price_edit'];
    if (sensitiveActions.includes(action)) {
      await supabase.from('notifications').insert({
        tenant_id: tenantId,
        title: 'تنبيه عملية حساسة',
        message: `الموظف ${staffName} قام بتنفيذ عملية حساسة: ${action === 'delete_invoice' ? 'حذف فاتورة' : 'تعديل السعر يدوياً'}. التفاصيل: ${details}`,
        type: 'alert',
        status: 'unread',
        created_at: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error('Failed to log employee activity:', error);
  }
};
