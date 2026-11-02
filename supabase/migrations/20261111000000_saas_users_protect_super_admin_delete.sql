-- يمنع حذف أي صف saas_users بدور super_admin (حتى من قِبل super_admin آخر)
-- -- طلب المستخدم: "الأعضاء الوحيدين الذين لا أستطيع حذفهم هم المدير العام".
-- محظور على مستوى RLS نفسه، لا الواجهة فقط، فلا يمكن تجاوزه عبر استدعاء
-- مباشر لواجهة Supabase REST. السياسة القديمة FOR ALL تُستبدَل بسياسات لكل
-- عملية على حدة لأن سياسات RLS المتعددة لنفس الأمر تُجمَع بـOR، فإبقاء FOR
-- ALL القديمة بجانب سياسة DELETE أضيق كان سيُبطل التقييد.

DROP POLICY IF EXISTS saas_users_super_admin_all ON saas_users;

CREATE POLICY saas_users_super_admin_select ON saas_users
    FOR SELECT USING (app_is_super_admin());

CREATE POLICY saas_users_super_admin_insert ON saas_users
    FOR INSERT WITH CHECK (app_is_super_admin());

CREATE POLICY saas_users_super_admin_update ON saas_users
    FOR UPDATE USING (app_is_super_admin()) WITH CHECK (app_is_super_admin());

CREATE POLICY saas_users_super_admin_delete ON saas_users
    FOR DELETE USING (app_is_super_admin() AND role <> 'super_admin');
