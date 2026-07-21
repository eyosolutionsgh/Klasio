-- Mock examination series: not terms, and not assessment components either. A candidate sits
-- several inside one term, and none of them may fold into the terminal report.

-- CreateTable
CREATE TABLE "MockSeries" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sittingOn" TIMESTAMP(3),
    "classId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MockSeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MockResult" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MockResult_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MockSeries_schoolId_academicYearId_idx" ON "MockSeries"("schoolId", "academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "MockSeries_schoolId_academicYearId_name_key" ON "MockSeries"("schoolId", "academicYearId", "name");

-- CreateIndex
CREATE INDEX "MockResult_schoolId_seriesId_idx" ON "MockResult"("schoolId", "seriesId");

-- CreateIndex
CREATE UNIQUE INDEX "MockResult_seriesId_studentId_subjectId_key" ON "MockResult"("seriesId", "studentId", "subjectId");

-- AddForeignKey
ALTER TABLE "MockSeries" ADD CONSTRAINT "MockSeries_academicYearId_fkey" FOREIGN KEY ("academicYearId") REFERENCES "AcademicYear"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MockResult" ADD CONSTRAINT "MockResult_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "MockSeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MockResult" ADD CONSTRAINT "MockResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MockResult" ADD CONSTRAINT "MockResult_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- A tenant table needs BOTH of the following, and only one of them fails loudly.
ALTER TABLE "MockSeries" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MockSeries";
CREATE POLICY tenant_isolation ON "MockSeries"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

ALTER TABLE "MockResult" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "MockResult";
CREATE POLICY tenant_isolation ON "MockResult"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "MockSeries" TO eyo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "MockResult" TO eyo_app;
  END IF;
END
$$;
