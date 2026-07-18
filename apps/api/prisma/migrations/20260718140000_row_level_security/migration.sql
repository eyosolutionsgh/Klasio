-- Row-Level Security (docs/03 §3.3).
--
-- Tenant isolation was a hand-written `where: { schoolId }` in every query. That holds until one
-- query forgets, and the failure mode is one school reading another school's children. These
-- policies make the database refuse instead: a forgotten filter returns nothing rather than
-- everything.
--
-- Deliberately NOT forced. Policies apply to ordinary roles but are bypassed by the table owner,
-- which is what lets migrations and the seed keep working. The safety therefore depends on the
-- API connecting as a NON-OWNER role (eyo_app) — see docs and .env.example. Connecting the API
-- as the owner would silently disable every policy below.
--
-- Role creation and its password are an ops step, not a migration: a migration should not need
-- CREATEROLE, and secrets do not belong in version control. The grants below are skipped when
-- the role is absent so this migration still runs clean on a fresh CI database.

CREATE OR REPLACE FUNCTION app_current_school() RETURNS text
  LANGUAGE sql STABLE AS $$ SELECT NULLIF(current_setting('app.school_id', true), '') $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app') THEN
    GRANT USAGE ON SCHEMA public TO eyo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO eyo_app;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO eyo_app;
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public '
            'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO eyo_app';
  END IF;
END
$$;

ALTER TABLE "AcademicYear" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AcademicYear";
CREATE POLICY tenant_isolation ON "AcademicYear"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "Announcement" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Announcement";
CREATE POLICY tenant_isolation ON "Announcement"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "AssessmentComponent" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AssessmentComponent";
CREATE POLICY tenant_isolation ON "AssessmentComponent"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "AttendanceRecord" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AttendanceRecord";
CREATE POLICY tenant_isolation ON "AttendanceRecord"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AuditLog";
CREATE POLICY tenant_isolation ON "AuditLog"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "BankDeposit" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "BankDeposit";
CREATE POLICY tenant_isolation ON "BankDeposit"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "ClassRoom" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ClassRoom";
CREATE POLICY tenant_isolation ON "ClassRoom"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "DismissalRequest" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DismissalRequest";
CREATE POLICY tenant_isolation ON "DismissalRequest"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "FeeItem" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FeeItem";
CREATE POLICY tenant_isolation ON "FeeItem"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "GatewayAccount" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "GatewayAccount";
CREATE POLICY tenant_isolation ON "GatewayAccount"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "GradingScheme" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "GradingScheme";
CREATE POLICY tenant_isolation ON "GradingScheme"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "Guardian" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Guardian";
CREATE POLICY tenant_isolation ON "Guardian"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "GuardianOtp" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "GuardianOtp";
CREATE POLICY tenant_isolation ON "GuardianOtp"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "Invoice" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Invoice";
CREATE POLICY tenant_isolation ON "Invoice"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "LedgerEntry" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "LedgerEntry";
CREATE POLICY tenant_isolation ON "LedgerEntry"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "Level" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Level";
CREATE POLICY tenant_isolation ON "Level"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "MessageTemplate" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MessageTemplate";
CREATE POLICY tenant_isolation ON "MessageTemplate"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "PaymentIntent" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PaymentIntent";
CREATE POLICY tenant_isolation ON "PaymentIntent"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "PickupCredential" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PickupCredential";
CREATE POLICY tenant_isolation ON "PickupCredential"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "PickupDelegate" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PickupDelegate";
CREATE POLICY tenant_isolation ON "PickupDelegate"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "Receipt" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Receipt";
CREATE POLICY tenant_isolation ON "Receipt"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "ReleaseLog" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ReleaseLog";
CREATE POLICY tenant_isolation ON "ReleaseLog"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "ScheduledJob" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "ScheduledJob";
CREATE POLICY tenant_isolation ON "ScheduledJob"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "Score" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Score";
CREATE POLICY tenant_isolation ON "Score"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "SmsMessage" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SmsMessage";
CREATE POLICY tenant_isolation ON "SmsMessage"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "Student" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Student";
CREATE POLICY tenant_isolation ON "Student"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "StudentDocument" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StudentDocument";
CREATE POLICY tenant_isolation ON "StudentDocument"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "StudentFeeItem" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StudentFeeItem";
CREATE POLICY tenant_isolation ON "StudentFeeItem"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "Subject" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Subject";
CREATE POLICY tenant_isolation ON "Subject"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "TermReport" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "TermReport";
CREATE POLICY tenant_isolation ON "TermReport"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "User";
CREATE POLICY tenant_isolation ON "User"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
ALTER TABLE "WebhookEvent" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "WebhookEvent";
CREATE POLICY tenant_isolation ON "WebhookEvent"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

-- The tenant root: a school may only ever see itself.
ALTER TABLE "School" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "School";
CREATE POLICY tenant_isolation ON "School"
  USING ("id" = app_current_school())
  WITH CHECK ("id" = app_current_school());

-- Term hangs off AcademicYear rather than carrying schoolId itself.
ALTER TABLE "Term" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Term";
CREATE POLICY tenant_isolation ON "Term"
  USING (EXISTS (SELECT 1 FROM "AcademicYear" y
                 WHERE y."id" = "Term"."academicYearId" AND y."schoolId" = app_current_school()))
  WITH CHECK (EXISTS (SELECT 1 FROM "AcademicYear" y
                      WHERE y."id" = "Term"."academicYearId" AND y."schoolId" = app_current_school()));

-- The student-guardian link is scoped through the student.
ALTER TABLE "StudentGuardian" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StudentGuardian";
CREATE POLICY tenant_isolation ON "StudentGuardian"
  USING (EXISTS (SELECT 1 FROM "Student" s
                 WHERE s."id" = "StudentGuardian"."studentId" AND s."schoolId" = app_current_school()))
  WITH CHECK (EXISTS (SELECT 1 FROM "Student" s
                      WHERE s."id" = "StudentGuardian"."studentId" AND s."schoolId" = app_current_school()));
