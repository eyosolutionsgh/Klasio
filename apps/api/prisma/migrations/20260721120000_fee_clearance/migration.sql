-- "No fees, no report card", off unless a school chooses it.
ALTER TABLE "School" ADD COLUMN     "reportsRequireFeeClearance" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "FeeClearance" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "termId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "grantedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeeClearance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FeeClearance_schoolId_termId_idx" ON "FeeClearance"("schoolId", "termId");

-- CreateIndex
CREATE UNIQUE INDEX "FeeClearance_studentId_termId_key" ON "FeeClearance"("studentId", "termId");

-- AddForeignKey
ALTER TABLE "FeeClearance" ADD CONSTRAINT "FeeClearance_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeeClearance" ADD CONSTRAINT "FeeClearance_termId_fkey" FOREIGN KEY ("termId") REFERENCES "Term"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A tenant table needs BOTH of the following, and only one of them fails loudly.
ALTER TABLE "FeeClearance" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FeeClearance";
CREATE POLICY tenant_isolation ON "FeeClearance"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "FeeClearance" TO eyo_app;
  END IF;
END
$$;
