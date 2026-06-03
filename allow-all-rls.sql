-- ==========================================
-- سكربت لفتح جميع الصلاحيات في قاعدة البيانات
-- (للاستخدام في بيئة التطوير والتجربة)
-- ==========================================

DO $$
DECLARE
    tbl_name text;
BEGIN
    FOR tbl_name IN (SELECT tablename FROM pg_tables WHERE schemaname = 'public') 
    LOOP
        -- تفعيل الـ RLS لتجنب الأخطاء
        EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY;', tbl_name);
        
        -- إزالة أي سياسة سابقة بنفس الاسم
        EXECUTE format('DROP POLICY IF EXISTS allow_all ON %I;', tbl_name);
        
        -- إنشاء سياسة جديدة تسمح بقراءة وإضافة وتعديل وحذف البيانات للجميع
        EXECUTE format('CREATE POLICY allow_all ON %I FOR ALL USING (true) WITH CHECK (true);', tbl_name);
    END LOOP;
END
$$;
