-- Second factors for vendor staff. This portal can mint a licence for any school, so a password
-- on its own was the whole of its security.
--
-- The TOTP secret is encrypted rather than hashed: verifying a code means regenerating it, so it
-- has to be recoverable. Everything else here is hashed, because everything else is a password
-- with a short life.
ALTER TABLE "VendorUser" ADD COLUMN "totpSecretEnc" TEXT;
ALTER TABLE "VendorUser" ADD COLUMN "totpConfirmedAt" TIMESTAMP(3);

ALTER TABLE "VendorUser" ADD COLUMN "emailOtpHash" TEXT;
ALTER TABLE "VendorUser" ADD COLUMN "emailOtpExpiresAt" TIMESTAMP(3);
ALTER TABLE "VendorUser" ADD COLUMN "emailOtpSentAt" TIMESTAMP(3);

ALTER TABLE "VendorUser" ADD COLUMN "mfaFailedAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "VendorUser" ADD COLUMN "mfaLockedUntil" TIMESTAMP(3);

ALTER TABLE "VendorUser" ADD COLUMN "recoveryCodeHashes" TEXT[] DEFAULT ARRAY[]::TEXT[];
