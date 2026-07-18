-- Prisma created the old school-wide name uniqueness as an INDEX, so DROP CONSTRAINT in the
-- previous migration was a no-op. Dropping it for real: a component name must be reusable
-- across subjects ("Project" in Science and in Twi are different columns).
DROP INDEX IF EXISTS "AssessmentComponent_schoolId_name_key";
