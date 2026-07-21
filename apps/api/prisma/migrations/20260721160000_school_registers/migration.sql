-- The registers an inspection asks for, which the software did not hold: the log book, the duty
-- roster, lesson-note vetting, the discipline book, the visitors book, and daily feeding money.

-- CreateEnum
CREATE TYPE "LogBookKind" AS ENUM ('GENERAL', 'VISIT', 'INCIDENT', 'ABSENCE', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "VettingStatus" AS ENUM ('SUBMITTED', 'APPROVED', 'RETURNED');

-- CreateEnum
CREATE TYPE "DisciplineOutcome" AS ENUM ('RECORDED', 'WARNED', 'PARENT_INFORMED', 'SUSPENDED', 'RESOLVED');

-- CreateTable
CREATE TABLE "LogBookEntry" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "entryDate" TIMESTAMP(3) NOT NULL,
    "kind" "LogBookKind" NOT NULL DEFAULT 'GENERAL',
    "body" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LogBookEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DutyRoster" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DutyRoster_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LessonNote" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "classId" TEXT,
    "subjectId" TEXT,
    "weekOf" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "fileKey" TEXT,
    "fileName" TEXT,
    "status" "VettingStatus" NOT NULL DEFAULT 'SUBMITTED',
    "vettedById" TEXT,
    "vettedAt" TIMESTAMP(3),
    "comment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonNote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DisciplineEntry" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "occurredOn" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "actionTaken" TEXT,
    "outcome" "DisciplineOutcome" NOT NULL DEFAULT 'RECORDED',
    "guardianInformedAt" TIMESTAMP(3),
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DisciplineEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VisitorLog" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "organisation" TEXT,
    "purpose" TEXT NOT NULL,
    "toSee" TEXT,
    "arrivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "departedAt" TIMESTAMP(3),
    "badgeNo" TEXT,
    "recordedById" TEXT NOT NULL,

    CONSTRAINT "VisitorLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeedingRecord" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "onDate" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "collectedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedingRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LogBookEntry_schoolId_entryDate_idx" ON "LogBookEntry"("schoolId", "entryDate");

-- CreateIndex
CREATE INDEX "DutyRoster_schoolId_startDate_idx" ON "DutyRoster"("schoolId", "startDate");

-- CreateIndex
CREATE INDEX "LessonNote_schoolId_weekOf_idx" ON "LessonNote"("schoolId", "weekOf");

-- CreateIndex
CREATE INDEX "LessonNote_schoolId_teacherId_idx" ON "LessonNote"("schoolId", "teacherId");

-- CreateIndex
CREATE INDEX "DisciplineEntry_schoolId_occurredOn_idx" ON "DisciplineEntry"("schoolId", "occurredOn");

-- CreateIndex
CREATE INDEX "DisciplineEntry_schoolId_studentId_idx" ON "DisciplineEntry"("schoolId", "studentId");

-- CreateIndex
CREATE INDEX "VisitorLog_schoolId_arrivedAt_idx" ON "VisitorLog"("schoolId", "arrivedAt");

-- CreateIndex
CREATE INDEX "FeedingRecord_schoolId_onDate_idx" ON "FeedingRecord"("schoolId", "onDate");

-- CreateIndex
CREATE UNIQUE INDEX "FeedingRecord_studentId_onDate_key" ON "FeedingRecord"("studentId", "onDate");

-- AddForeignKey
ALTER TABLE "DutyRoster" ADD CONSTRAINT "DutyRoster_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LessonNote" ADD CONSTRAINT "LessonNote_teacherId_fkey" FOREIGN KEY ("teacherId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DisciplineEntry" ADD CONSTRAINT "DisciplineEntry_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedingRecord" ADD CONSTRAINT "FeedingRecord_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Every one of these is tenant-owned, so every one needs BOTH a policy and a grant. Only the
-- grant fails loudly; a missing policy fails open, and silently.
ALTER TABLE "LogBookEntry" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "LogBookEntry";
CREATE POLICY tenant_isolation ON "LogBookEntry"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

ALTER TABLE "DutyRoster" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DutyRoster";
CREATE POLICY tenant_isolation ON "DutyRoster"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

ALTER TABLE "LessonNote" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "LessonNote";
CREATE POLICY tenant_isolation ON "LessonNote"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

ALTER TABLE "DisciplineEntry" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "DisciplineEntry";
CREATE POLICY tenant_isolation ON "DisciplineEntry"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

ALTER TABLE "VisitorLog" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "VisitorLog";
CREATE POLICY tenant_isolation ON "VisitorLog"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

ALTER TABLE "FeedingRecord" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "FeedingRecord";
CREATE POLICY tenant_isolation ON "FeedingRecord"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'eyo_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "LogBookEntry" TO eyo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "DutyRoster" TO eyo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "LessonNote" TO eyo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "DisciplineEntry" TO eyo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "VisitorLog" TO eyo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON "FeedingRecord" TO eyo_app;
  END IF;
END
$$;
