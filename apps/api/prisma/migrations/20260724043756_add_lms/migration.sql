-- CreateTable
CREATE TABLE "Lesson" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lesson_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "instructions" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "points" INTEGER NOT NULL DEFAULT 100,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "score" INTEGER,
    "feedback" TEXT,
    "gradedById" TEXT,
    "gradedAt" TIMESTAMP(3),

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lesson_schoolId_classId_idx" ON "Lesson"("schoolId", "classId");

-- CreateIndex
CREATE INDEX "Assignment_schoolId_classId_idx" ON "Assignment"("schoolId", "classId");

-- CreateIndex
CREATE INDEX "Submission_schoolId_assignmentId_idx" ON "Submission"("schoolId", "assignmentId");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_assignmentId_studentId_key" ON "Submission"("assignmentId", "studentId");

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Row-level security: each is tenant-owned, so each needs a policy and a grant.
ALTER TABLE "Lesson" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Lesson";
CREATE POLICY tenant_isolation ON "Lesson"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

ALTER TABLE "Assignment" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Assignment";
CREATE POLICY tenant_isolation ON "Assignment"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

ALTER TABLE "Submission" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Submission";
CREATE POLICY tenant_isolation ON "Submission"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "Lesson" TO eyo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "Assignment" TO eyo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "Submission" TO eyo_app;
  END IF;
END
$$;

-- Grant the LMS permissions to the teaching presets on schools that already exist. Fresh installs
-- get them from ROLE_PRESETS; appended only where absent, so a re-run is a no-op.
UPDATE "StaffRole"
  SET permissions = permissions || ARRAY['lms.view','lms.manage']
  WHERE "presetKey" IN ('HEAD','ASSISTANT_HEAD','HEAD_OF_DEPARTMENT','CLASS_TEACHER','SUBJECT_TEACHER')
    AND NOT ('lms.manage' = ANY("permissions"));
