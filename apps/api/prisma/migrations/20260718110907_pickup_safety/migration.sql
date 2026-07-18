-- CreateEnum
CREATE TYPE "ReleaseMethod" AS ENUM ('QR', 'PIN', 'OVERRIDE');

-- CreateEnum
CREATE TYPE "DismissalStatus" AS ENUM ('PENDING', 'APPROVED', 'DECLINED');

-- CreateTable
CREATE TABLE "PickupDelegate" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PickupDelegate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PickupCredential" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "guardianId" TEXT,
    "delegateId" TEXT,
    "token" TEXT NOT NULL,
    "pinHash" TEXT NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "PickupCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseLog" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "collectedBy" TEXT NOT NULL,
    "collectorKind" TEXT NOT NULL,
    "collectorId" TEXT,
    "method" "ReleaseMethod" NOT NULL,
    "overrideReason" TEXT,
    "releasedById" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DismissalRequest" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "forDate" TIMESTAMP(3) NOT NULL,
    "details" TEXT NOT NULL,
    "status" "DismissalStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DismissalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PickupDelegate_schoolId_studentId_idx" ON "PickupDelegate"("schoolId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "PickupCredential_guardianId_key" ON "PickupCredential"("guardianId");

-- CreateIndex
CREATE UNIQUE INDEX "PickupCredential_delegateId_key" ON "PickupCredential"("delegateId");

-- CreateIndex
CREATE UNIQUE INDEX "PickupCredential_token_key" ON "PickupCredential"("token");

-- CreateIndex
CREATE INDEX "PickupCredential_schoolId_idx" ON "PickupCredential"("schoolId");

-- CreateIndex
CREATE INDEX "ReleaseLog_schoolId_releasedAt_idx" ON "ReleaseLog"("schoolId", "releasedAt");

-- CreateIndex
CREATE INDEX "ReleaseLog_studentId_idx" ON "ReleaseLog"("studentId");

-- CreateIndex
CREATE INDEX "DismissalRequest_schoolId_forDate_idx" ON "DismissalRequest"("schoolId", "forDate");

-- CreateIndex
CREATE INDEX "DismissalRequest_studentId_idx" ON "DismissalRequest"("studentId");

-- AddForeignKey
ALTER TABLE "PickupDelegate" ADD CONSTRAINT "PickupDelegate_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupCredential" ADD CONSTRAINT "PickupCredential_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PickupCredential" ADD CONSTRAINT "PickupCredential_delegateId_fkey" FOREIGN KEY ("delegateId") REFERENCES "PickupDelegate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseLog" ADD CONSTRAINT "ReleaseLog_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DismissalRequest" ADD CONSTRAINT "DismissalRequest_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DismissalRequest" ADD CONSTRAINT "DismissalRequest_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "Guardian"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
