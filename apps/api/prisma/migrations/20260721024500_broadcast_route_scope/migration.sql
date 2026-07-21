-- Targeted messaging by route (FEATURES.md §11): a broadcast can address the families of one
-- bus route's riders.

-- AlterTable
ALTER TABLE "Broadcast" ADD COLUMN "routeId" TEXT;
