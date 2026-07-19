-- Document references are numbered PER SCHOOL — every school's first cash payment is
-- PAY-2026-00001 — but LedgerEntry.reference and BankDeposit.reference were UNIQUE globally.
-- The second school on the platform to take money therefore collided with the first and could
-- not record the payment at all: the insert failed, and because the request runs in one
-- transaction, the receipt went with it. Reproduced against two seeded schools before this
-- migration was written.
--
-- Widening rather than narrowing, so it cannot fail on existing data: every row that satisfied
-- the old global constraint also satisfies the per-school one.
-- DropIndex
DROP INDEX "BankDeposit_reference_key";

-- DropIndex
DROP INDEX "LedgerEntry_reference_key";

-- CreateIndex
CREATE UNIQUE INDEX "BankDeposit_schoolId_reference_key" ON "BankDeposit"("schoolId", "reference");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_schoolId_reference_key" ON "LedgerEntry"("schoolId", "reference");

