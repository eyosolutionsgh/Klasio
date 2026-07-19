-- A settlement file that lists the same reference twice (a gateway re-export, or two exports
-- concatenated) previously matched both lines and counted the gateway's charge twice, reporting
-- money the school never received. The repeat is now recorded rather than silently dropped.
ALTER TYPE "SettlementStatus" ADD VALUE IF NOT EXISTS 'DUPLICATE';
