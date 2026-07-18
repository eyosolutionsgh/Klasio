-- CreateEnum
CREATE TYPE "SmsStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "Level" ADD COLUMN     "gradingSchemeId" TEXT;

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "smsCredits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "smsSenderId" TEXT;

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "exitDate" TIMESTAMP(3),
ADD COLUMN     "exitReason" TEXT;

-- CreateTable
CREATE TABLE "SmsMessage" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "SmsStatus" NOT NULL DEFAULT 'QUEUED',
    "provider" TEXT NOT NULL DEFAULT 'mock',
    "providerRef" TEXT,
    "cost" INTEGER NOT NULL DEFAULT 1,
    "batchId" TEXT,
    "error" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SmsMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SmsMessage_schoolId_createdAt_idx" ON "SmsMessage"("schoolId", "createdAt");

-- CreateIndex
CREATE INDEX "SmsMessage_schoolId_batchId_idx" ON "SmsMessage"("schoolId", "batchId");

-- AddForeignKey
ALTER TABLE "Level" ADD CONSTRAINT "Level_gradingSchemeId_fkey" FOREIGN KEY ("gradingSchemeId") REFERENCES "GradingScheme"("id") ON DELETE SET NULL ON UPDATE CASCADE;
