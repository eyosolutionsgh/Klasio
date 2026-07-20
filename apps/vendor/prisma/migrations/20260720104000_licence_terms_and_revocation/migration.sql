-- Licences are sold by term — monthly, quarterly, annually, every two years — and the term is
-- recorded rather than inferred from the dates. Calendar months are uneven, so a licence issued
-- on the 31st reads back as an odd number of months, and a bespoke duration cut from the CLI has
-- no term to infer at all. Null on every licence issued before this.
ALTER TABLE "Licence" ADD COLUMN IF NOT EXISTS "termMonths" INTEGER;

-- Who withdrew a licence, symmetric with who issued it. A back office that records the sale and
-- not the refund answers half the question support actually asks.
ALTER TABLE "Licence" ADD COLUMN IF NOT EXISTS "revokedById" TEXT;

ALTER TABLE "Licence"
  ADD CONSTRAINT "Licence_revokedById_fkey"
  FOREIGN KEY ("revokedById") REFERENCES "VendorUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
