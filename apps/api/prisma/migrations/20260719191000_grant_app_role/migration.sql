-- Grant the app role on every table, and make future tables inherit it.
--
-- Row-level security only bites when the API connects as eyo_app, but a policy is not a
-- permission: eyo_app also needs SELECT/INSERT/UPDATE/DELETE on the table itself. The RLS
-- migration granted those, and set ALTER DEFAULT PRIVILEGES so new tables would be covered — but
-- both were inside `IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app')`, and on any
-- database where the role was created *after* that migration ran, neither ever happened.
--
-- The symptom is not a security hole; it is the opposite, and it appears only when the next table
-- is added: `permission denied for table SocialAccount`, from a query that looks perfectly
-- correct. Which is exactly how it was found.
--
-- Re-running the grants here fixes existing installs, and re-running ALTER DEFAULT PRIVILEGES
-- means the next migration to add a table does not have to remember any of this.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app') THEN
    GRANT USAGE ON SCHEMA public TO eyo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eyo_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eyo_app;
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
            'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eyo_app';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
            'GRANT USAGE, SELECT ON SEQUENCES TO eyo_app';
  END IF;
END
$$;
