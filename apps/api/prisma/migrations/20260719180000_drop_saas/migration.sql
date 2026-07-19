-- Remove the vendor plane.
--
-- The product is no longer SaaS: every school runs on its own server, so there is no estate for a
-- vendor console to manage and no subscription for a school to pay. What a school is entitled to
-- now comes from the signed licence installed on the box (see the Licence table and
-- apps/api/src/licence/).
--
-- The dropped tables and their row-level-security policies go together — dropping a table drops
-- its policy with it, so nothing in 20260718140000_row_level_security needs editing, and it must
-- not be edited: migrations roll forward only.
--
-- School.suspendedAt/suspendedReason go too. Suspension was the vendor closing a door on a school
-- that had not paid. There is no vendor on this box to close it, and the equivalent now happens by
-- itself: a licence lapses, grace runs out, and the school drops to BASIC while keeping every
-- record it has.

-- DropForeignKey
ALTER TABLE "SchoolInvitation" DROP CONSTRAINT "SchoolInvitation_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "Subscription" DROP CONSTRAINT "Subscription_schoolId_fkey";

-- DropForeignKey
ALTER TABLE "SubscriptionInvoice" DROP CONSTRAINT "SubscriptionInvoice_subscriptionId_fkey";

-- AlterTable
ALTER TABLE "School" DROP COLUMN "suspendedAt",
DROP COLUMN "suspendedReason";

-- DropTable
DROP TABLE "SubscriptionInvoice";

-- DropTable
DROP TABLE "Subscription";

-- DropTable
DROP TABLE "PlatformNotice";

-- DropTable
DROP TABLE "SchoolInvitation";

-- DropTable
DROP TABLE "PlatformAuditLog";

-- DropTable
DROP TABLE "PlatformAdmin";

-- DropEnum
DROP TYPE "NoticeLevel";

-- DropEnum
DROP TYPE "SubscriptionInvoiceStatus";

-- DropEnum
DROP TYPE "SubscriptionStatus";
