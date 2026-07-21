-- Closing a term or a year is an act, not a date elapsing. Existing rows are all open, which is
-- the correct reading of history: nothing has ever been closed because closing did not exist.
ALTER TABLE "AcademicYear" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedById" TEXT;

ALTER TABLE "Term" ADD COLUMN     "closedAt" TIMESTAMP(3),
ADD COLUMN     "closedById" TEXT;
