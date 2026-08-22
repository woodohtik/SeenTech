-- B-3 (security-fix-tasklist.md): both policies were created without
-- `TO authenticated`, so they applied to PUBLIC -- including anon. Verified
-- live on the linked project (pg_policies): both still read exactly as in
-- wdooh-database-schema.sql.
--
-- saas_settings_read_any let any unauthenticated visitor read every row in
-- saas_settings (key/value/updated_by), including the `temp_passwords` key
-- referenced elsewhere in the app (SaaSTeamManagement.tsx stores a
-- uid -> boolean map there, not actual password values -- but it's still
-- internal platform state with no reason to be world-readable).
--
-- saas_security_logs_insert let anon insert arbitrary rows into a table
-- that's supposed to be an audit trail of real security events -- so
-- anyone could forge log entries, or flood the table.

DROP POLICY IF EXISTS saas_settings_read_any ON saas_settings;
CREATE POLICY saas_settings_read_any ON saas_settings FOR SELECT TO authenticated USING (TRUE);

DROP POLICY IF EXISTS saas_security_logs_insert ON saas_security_logs;
CREATE POLICY saas_security_logs_insert ON saas_security_logs FOR INSERT TO authenticated
  WITH CHECK (user_id = app_current_uid());
