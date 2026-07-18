-- AlterTable
ALTER TABLE "ReleaseLog" ADD COLUMN     "clientRef" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseLog_schoolId_clientRef_key" ON "ReleaseLog"("schoolId", "clientRef");

