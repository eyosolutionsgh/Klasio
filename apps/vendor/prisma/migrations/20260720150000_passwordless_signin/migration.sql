-- Sign-in is passwordless: an address, then a code — emailed, or from an authenticator app.
--
-- The column is kept, nullable, rather than dropped. Nothing reads it, and an account created
-- before this change still loads. Drop it once no deployment carries one.
ALTER TABLE "VendorUser" ALTER COLUMN "passwordHash" DROP NOT NULL;
