-- CreateTable
CREATE TABLE "GuardianOtp" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuardianOtp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuardianOtp_phone_createdAt_idx" ON "GuardianOtp"("phone", "createdAt");

-- CreateIndex
CREATE INDEX "GuardianOtp_guardianId_idx" ON "GuardianOtp"("guardianId");

-- AddForeignKey
ALTER TABLE "GuardianOtp" ADD CONSTRAINT "GuardianOtp_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
