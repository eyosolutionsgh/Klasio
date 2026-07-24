-- CreateEnum
CREATE TYPE "CanteenTxnType" AS ENUM ('TOPUP', 'SPEND', 'REVERSAL');

-- CreateTable
CREATE TABLE "CanteenTxn" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "type" "CanteenTxnType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "reversedId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanteenTxn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CanteenTxn_schoolId_studentId_idx" ON "CanteenTxn"("schoolId", "studentId");

-- Row-level security: tenant-owned, so it needs both a policy and a grant.
ALTER TABLE "CanteenTxn" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CanteenTxn";
CREATE POLICY tenant_isolation ON "CanteenTxn"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "CanteenTxn" TO eyo_app;
  END IF;
END
$$;

-- Grant the canteen permissions to the finance presets on schools that already exist. Fresh
-- installs get them from ROLE_PRESETS; appended only where absent, so a re-run is a no-op.
UPDATE "StaffRole"
  SET permissions = permissions || ARRAY['canteen.view','canteen.manage']
  WHERE "presetKey" IN ('BURSAR','ACCOUNTS_CLERK') AND NOT ('canteen.manage' = ANY("permissions"));
