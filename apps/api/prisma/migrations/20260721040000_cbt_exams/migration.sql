-- Computer-based tests and question banks (FEATURES.md §5, exams.cbt).

-- CreateEnum
CREATE TYPE "CbtExamStatus" AS ENUM ('DRAFT', 'OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "QuestionBank" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "levelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionBank_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "options" TEXT[],
    "correctIndex" INTEGER NOT NULL,
    "explanation" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CbtExam" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "bankId" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "questionCount" INTEGER NOT NULL,
    "status" "CbtExamStatus" NOT NULL DEFAULT 'DRAFT',
    "componentId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CbtExam_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CbtAttempt" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "answers" JSONB,
    "score" INTEGER,
    "total" INTEGER,

    CONSTRAINT "CbtAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuestionBank_schoolId_subjectId_levelId_idx" ON "QuestionBank"("schoolId", "subjectId", "levelId");
CREATE INDEX "Question_schoolId_bankId_idx" ON "Question"("schoolId", "bankId");
CREATE INDEX "CbtExam_schoolId_classId_idx" ON "CbtExam"("schoolId", "classId");
CREATE UNIQUE INDEX "CbtAttempt_examId_studentId_key" ON "CbtAttempt"("examId", "studentId");
CREATE INDEX "CbtAttempt_schoolId_examId_idx" ON "CbtAttempt"("schoolId", "examId");

-- AddForeignKey
ALTER TABLE "QuestionBank" ADD CONSTRAINT "QuestionBank_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "QuestionBank" ADD CONSTRAINT "QuestionBank_levelId_fkey" FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Question" ADD CONSTRAINT "Question_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "QuestionBank"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CbtExam" ADD CONSTRAINT "CbtExam_bankId_fkey" FOREIGN KEY ("bankId") REFERENCES "QuestionBank"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CbtAttempt" ADD CONSTRAINT "CbtAttempt_examId_fkey" FOREIGN KEY ("examId") REFERENCES "CbtExam"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CbtAttempt" ADD CONSTRAINT "CbtAttempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A tenant table needs BOTH of the following, and only one of them fails loudly.
ALTER TABLE "QuestionBank" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "QuestionBank";
CREATE POLICY tenant_isolation ON "QuestionBank"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

ALTER TABLE "Question" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Question";
CREATE POLICY tenant_isolation ON "Question"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

ALTER TABLE "CbtExam" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CbtExam";
CREATE POLICY tenant_isolation ON "CbtExam"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

ALTER TABLE "CbtAttempt" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "CbtAttempt";
CREATE POLICY tenant_isolation ON "CbtAttempt"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "QuestionBank" TO eyo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "Question" TO eyo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "CbtExam" TO eyo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "CbtAttempt" TO eyo_app;
  END IF;
END
$$;
