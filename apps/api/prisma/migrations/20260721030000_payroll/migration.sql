-- Payroll (FEATURES.md §17): pay profiles, monthly runs, and lines that snapshot every figure
-- at computation time — a later salary change must never rewrite an approved month.

-- CreateEnum
CREATE TYPE "PayRunStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateTable
CREATE TABLE "StaffPayProfile" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "basicSalary" DECIMAL(12,2) NOT NULL,
    "allowances" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "payoutMethod" TEXT NOT NULL DEFAULT 'BANK',
    "payoutAccount" TEXT,
    "payoutName" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaffPayProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PayRun" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "status" "PayRunStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "PayRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PayRunLine" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "payRunId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "roleName" TEXT,
    "basic" DECIMAL(12,2) NOT NULL,
    "allowances" DECIMAL(12,2) NOT NULL,
    "gross" DECIMAL(12,2) NOT NULL,
    "ssnitEmployee" DECIMAL(12,2) NOT NULL,
    "taxable" DECIMAL(12,2) NOT NULL,
    "paye" DECIMAL(12,2) NOT NULL,
    "otherDeductions" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(12,2) NOT NULL,
    "ssnitEmployer" DECIMAL(12,2) NOT NULL,
    "payoutMethod" TEXT NOT NULL DEFAULT 'BANK',
    "payoutAccount" TEXT,
    "payoutName" TEXT,

    CONSTRAINT "PayRunLine_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StaffPayProfile_userId_key" ON "StaffPayProfile"("userId");
CREATE INDEX "StaffPayProfile_schoolId_idx" ON "StaffPayProfile"("schoolId");
CREATE UNIQUE INDEX "PayRun_schoolId_period_key" ON "PayRun"("schoolId", "period");
CREATE UNIQUE INDEX "PayRunLine_payRunId_userId_key" ON "PayRunLine"("payRunId", "userId");
CREATE INDEX "PayRunLine_schoolId_idx" ON "PayRunLine"("schoolId");

-- AddForeignKey
ALTER TABLE "StaffPayProfile" ADD CONSTRAINT "StaffPayProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PayRunLine" ADD CONSTRAINT "PayRunLine_payRunId_fkey" FOREIGN KEY ("payRunId") REFERENCES "PayRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- A tenant table needs BOTH of the following, and only one of them fails loudly.
ALTER TABLE "StaffPayProfile" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "StaffPayProfile";
CREATE POLICY tenant_isolation ON "StaffPayProfile"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

ALTER TABLE "PayRun" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PayRun";
CREATE POLICY tenant_isolation ON "PayRun"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

ALTER TABLE "PayRunLine" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PayRunLine";
CREATE POLICY tenant_isolation ON "PayRunLine"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "StaffPayProfile" TO eyo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "PayRun" TO eyo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "PayRunLine" TO eyo_app;
  END IF;
END
$$;
