-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'STUDENT';

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "portalPinHash" TEXT;
