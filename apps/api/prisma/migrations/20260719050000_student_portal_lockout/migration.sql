-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "portalLockedUntil" TIMESTAMP(3),
ADD COLUMN     "portalPinFails" INTEGER NOT NULL DEFAULT 0;

