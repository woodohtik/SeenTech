-- Rollback of 20270124000000_customers_view_measurements.sql.
DELETE FROM public.role_default_permissions WHERE permission_key = 'customers.view_measurements';
