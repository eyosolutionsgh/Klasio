-- The step between generating a report and releasing it: the head reading it. Existing rows are
-- unvetted, which is the honest reading — nothing has been vetted because vetting did not exist.
ALTER TABLE "TermReport" ADD COLUMN     "vettedAt" TIMESTAMP(3),
ADD COLUMN     "vettedById" TEXT;
