-- AlterTable
ALTER TABLE "Level" ADD COLUMN     "code" TEXT;

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "admissionNoFormat" TEXT NOT NULL DEFAULT '{YYYY}-{####}',
ADD COLUMN     "admissionNoNext" INTEGER NOT NULL DEFAULT 1;


-- Existing schools keep numbering where they left off.
--
-- The counter is seeded past the highest number already issued rather than from the row count:
-- a school that has withdrawn students has gaps, and counting rows would hand the next child a
-- number somebody already has.
UPDATE "School" s SET "admissionNoNext" = COALESCE((
  SELECT MAX(NULLIF(REGEXP_REPLACE(st."admissionNo", '\D', '', 'g'), '')::bigint)
  FROM "Student" st WHERE st."schoolId" = s.id
), 0) + 1;
