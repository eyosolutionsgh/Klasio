-- CreateEnum
CREATE TYPE "PasswordResetChannel" AS ENUM ('EMAIL', 'SMS');

-- AlterTable
-- Existing rows are all links, so EMAIL is the correct default for them as well as for new rows.
ALTER TABLE "PasswordReset" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "channel" "PasswordResetChannel" NOT NULL DEFAULT 'EMAIL',
ADD COLUMN     "codeSalt" TEXT;

-- The code path looks up a person's most recent live request rather than hashing to a row, so
-- this is the index that lookup rides. (userId, createdAt) already exists but does not cover the
-- channel filter.
CREATE INDEX "PasswordReset_userId_channel_createdAt_idx" ON "PasswordReset"("userId", "channel", "createdAt");
