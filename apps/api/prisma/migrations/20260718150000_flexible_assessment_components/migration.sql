-- Assessment components were school-wide, capped at one exam, and weighted by two constants.
-- That forces every class and subject to carry the same four columns, which is not how a school
-- marks: JHS 2 Science has a practical that Twi does not, and a subject may have three tests and
-- two papers.
--
-- Components now carry a category instead of an isExam flag (any number of each), and optional
-- subject/level scope that narrows from the school downwards. Weights move onto the school.

CREATE TYPE "AssessmentCategory" AS ENUM ('CONTINUOUS', 'EXAM');

ALTER TABLE "AssessmentComponent"
  ADD COLUMN "category" "AssessmentCategory" NOT NULL DEFAULT 'CONTINUOUS',
  ADD COLUMN "subjectId" TEXT,
  ADD COLUMN "levelId" TEXT,
  ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- Preserve what each component already meant.
UPDATE "AssessmentComponent" SET "category" = 'EXAM' WHERE "isExam" = true;

ALTER TABLE "AssessmentComponent" DROP COLUMN "isExam";

-- The old name uniqueness was school-wide, which now blocks "Project" existing for two subjects.
ALTER TABLE "AssessmentComponent" DROP CONSTRAINT IF EXISTS "AssessmentComponent_schoolId_name_key";

ALTER TABLE "AssessmentComponent"
  ADD CONSTRAINT "AssessmentComponent_subjectId_fkey"
    FOREIGN KEY ("subjectId") REFERENCES "Subject"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "AssessmentComponent_levelId_fkey"
    FOREIGN KEY ("levelId") REFERENCES "Level"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "AssessmentComponent_schoolId_subjectId_levelId_idx"
  ON "AssessmentComponent"("schoolId", "subjectId", "levelId");

ALTER TABLE "School"
  ADD COLUMN "sbaWeight" INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN "examWeight" INTEGER NOT NULL DEFAULT 70;
