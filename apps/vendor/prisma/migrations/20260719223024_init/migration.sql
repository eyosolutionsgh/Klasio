-- CreateEnum
CREATE TYPE "Tier" AS ENUM ('BASIC', 'MEDIUM', 'ADVANCED');

-- CreateTable
CREATE TABLE "VendorUser" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Licence" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "licenceId" TEXT NOT NULL,
    "tier" "Tier" NOT NULL,
    "studentCap" INTEGER,
    "extraEntitlements" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "issuedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "graceDays" INTEGER NOT NULL DEFAULT 30,
    "signed" TEXT NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "issuedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Licence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Heartbeat" (
    "id" TEXT NOT NULL,
    "clientId" TEXT,
    "schoolSlug" TEXT,
    "licenceId" TEXT,
    "state" TEXT,
    "tierInForce" "Tier",
    "tierLicensed" "Tier",
    "students" INTEGER,
    "studentCap" INTEGER,
    "verifiedWith" TEXT,
    "appVersion" TEXT,
    "raw" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Heartbeat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorUser_email_key" ON "VendorUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Client_slug_key" ON "Client"("slug");

-- CreateIndex
CREATE INDEX "Client_slug_idx" ON "Client"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Licence_licenceId_key" ON "Licence"("licenceId");

-- CreateIndex
CREATE INDEX "Licence_clientId_createdAt_idx" ON "Licence"("clientId", "createdAt");

-- CreateIndex
CREATE INDEX "Licence_expiresAt_idx" ON "Licence"("expiresAt");

-- CreateIndex
CREATE INDEX "Heartbeat_clientId_receivedAt_idx" ON "Heartbeat"("clientId", "receivedAt");

-- CreateIndex
CREATE INDEX "Heartbeat_receivedAt_idx" ON "Heartbeat"("receivedAt");

-- AddForeignKey
ALTER TABLE "Licence" ADD CONSTRAINT "Licence_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Licence" ADD CONSTRAINT "Licence_issuedById_fkey" FOREIGN KEY ("issuedById") REFERENCES "VendorUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Heartbeat" ADD CONSTRAINT "Heartbeat_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;
