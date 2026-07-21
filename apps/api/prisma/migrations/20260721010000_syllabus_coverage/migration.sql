-- Syllabus coverage (FEATURES.md §6): topics per subject and level, marked covered per class.

-- CreateTable
CREATE TABLE "SyllabusTopic" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyllabusTopic_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SyllabusCoverage" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "coveredById" TEXT NOT NULL,
    "coveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyllabusCoverage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyllabusTopic_schoolId_subjectId_levelId_idx" ON "SyllabusTopic"("schoolId", "subjectId", "levelId");
CREATE UNIQUE INDEX "SyllabusCoverage_topicId_classId_key" ON "SyllabusCoverage"("topicId", "classId");
CREATE INDEX "SyllabusCoverage_schoolId_classId_idx" ON "SyllabusCoverage"("schoolId", "classId");

-- AddForeignKey
ALTER TABLE "SyllabusTopic" ADD CONSTRAINT "SyllabusTopic_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SyllabusTopic" ADD CONSTRAINT "SyllabusTopic_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SyllabusCoverage" ADD CONSTRAINT "SyllabusCoverage_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "SyllabusTopic"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SyllabusCoverage" ADD CONSTRAINT "SyllabusCoverage_classId_fkey" FOREIGN KEY ("classId") REFERENCES "ClassRoom"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A tenant table needs BOTH of the following, and only one of them fails loudly.
ALTER TABLE "SyllabusTopic" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SyllabusTopic";
CREATE POLICY tenant_isolation ON "SyllabusTopic"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

ALTER TABLE "SyllabusCoverage" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SyllabusCoverage";
CREATE POLICY tenant_isolation ON "SyllabusCoverage"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "SyllabusTopic" TO eyo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "SyllabusCoverage" TO eyo_app;
  END IF;
END
$$;
