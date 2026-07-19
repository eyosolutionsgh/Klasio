-- One message, several channels — and the school's own social accounts.
--
-- Broadcast does not replace what it produces: it emits an Announcement for the portals,
-- SmsMessage rows for texts, BroadcastDelivery rows for email and SocialPost rows for social.
-- Collapsing those into one delivery table would have broken the SMS credit ledger and the four
-- automated senders that write SmsMessage directly.
--
-- Every new tenant-owned table gets the standard tenant_isolation policy at the foot of this file.
-- Forgetting that is how a table silently becomes readable across schools, so it is not optional.

-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('FACEBOOK_PAGE', 'INSTAGRAM', 'X', 'TIKTOK');

-- AlterTable
ALTER TABLE "Announcement" ADD COLUMN     "broadcastId" TEXT;

-- AlterTable
ALTER TABLE "SmsMessage" ADD COLUMN     "broadcastId" TEXT;

-- CreateTable
CREATE TABLE "Broadcast" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audienceScope" TEXT NOT NULL DEFAULT 'ALL',
    "classId" TEXT,
    "levelId" TEXT,
    "recipients" TEXT[],
    "audienceRoles" TEXT[] DEFAULT ARRAY['GUARDIANS']::TEXT[],
    "channels" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "idempotencyKey" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastMedia" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "publicToken" TEXT,
    "publicTokenExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BroadcastMedia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BroadcastDelivery" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "providerRef" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),

    CONSTRAINT "BroadcastDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT,
    "tokenExpiresAt" TIMESTAMP(3),
    "scopes" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "connectedById" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialPost" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "broadcastId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'QUEUED',
    "externalId" TEXT,
    "permalink" TEXT,
    "error" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SocialPost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Broadcast_schoolId_createdAt_idx" ON "Broadcast"("schoolId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Broadcast_schoolId_idempotencyKey_key" ON "Broadcast"("schoolId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastMedia_publicToken_key" ON "BroadcastMedia"("publicToken");

-- CreateIndex
CREATE INDEX "BroadcastMedia_schoolId_broadcastId_idx" ON "BroadcastMedia"("schoolId", "broadcastId");

-- CreateIndex
CREATE INDEX "BroadcastDelivery_schoolId_broadcastId_idx" ON "BroadcastDelivery"("schoolId", "broadcastId");

-- CreateIndex
CREATE UNIQUE INDEX "BroadcastDelivery_schoolId_broadcastId_channel_target_key" ON "BroadcastDelivery"("schoolId", "broadcastId", "channel", "target");

-- CreateIndex
CREATE INDEX "SocialAccount_schoolId_status_idx" ON "SocialAccount"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_schoolId_platform_externalId_key" ON "SocialAccount"("schoolId", "platform", "externalId");

-- CreateIndex
CREATE INDEX "SocialPost_schoolId_status_idx" ON "SocialPost"("schoolId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPost_schoolId_platform_externalId_key" ON "SocialPost"("schoolId", "platform", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "SocialPost_broadcastId_accountId_key" ON "SocialPost"("broadcastId", "accountId");

-- AddForeignKey
ALTER TABLE "BroadcastMedia" ADD CONSTRAINT "BroadcastMedia_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastDelivery" ADD CONSTRAINT "BroadcastDelivery_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialPost" ADD CONSTRAINT "SocialPost_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Row-level security for the new tables (docs/03 §3.3). Same shape as every other tenant table:
-- the database refuses a query that lost its schoolId rather than answering it.
ALTER TABLE "Broadcast" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Broadcast";
CREATE POLICY tenant_isolation ON "Broadcast"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

ALTER TABLE "BroadcastMedia" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "BroadcastMedia";
CREATE POLICY tenant_isolation ON "BroadcastMedia"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

ALTER TABLE "BroadcastDelivery" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "BroadcastDelivery";
CREATE POLICY tenant_isolation ON "BroadcastDelivery"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

ALTER TABLE "SocialAccount" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SocialAccount";
CREATE POLICY tenant_isolation ON "SocialAccount"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());

ALTER TABLE "SocialPost" ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "SocialPost";
CREATE POLICY tenant_isolation ON "SocialPost"
  USING ("schoolId" = app_current_school())
  WITH CHECK ("schoolId" = app_current_school());
