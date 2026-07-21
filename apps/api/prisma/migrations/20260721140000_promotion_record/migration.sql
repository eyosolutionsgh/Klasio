-- What happened to a child at the end of a year. Repeating left no trace before this: promotion
-- moved a class, so a child held back was simply one whose classId did not change, and the
-- absence of a change is not a record.
CREATE TYPE "PromotionAction" AS ENUM ('PROMOTED', 'REPEATED', 'GRADUATED');

CREATE TABLE "PromotionRecord" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "action" "PromotionAction" NOT NULL,
    "fromClassId" TEXT,
    "toClassId" TEXT,
    "decidedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionRecord_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PromotionRecord_schoolId_academicYearId_idx" ON "PromotionRecord"("schoolId", "academicYearId");

CREATE UNIQUE INDEX "PromotionRecord_studentId_academicYearId_key" ON "PromotionRecord"("studentId", "academicYearId");

ALTER TABLE "PromotionRecord" ADD CONSTRAINT "PromotionRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "PromotionRecord" ADD CONSTRAINT "PromotionRecord_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A tenant table needs BOTH of the following, and only one of them fails loudly.
ALTER TABLE "PromotionRecord" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "PromotionRecord";
CREATE POLICY tenant_isolation ON "PromotionRecord"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "PromotionRecord" TO eyo_app;
  END IF;
END
$$;
