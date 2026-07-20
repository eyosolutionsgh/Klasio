/**
 * Admissions pipeline rules (docs/02 §2.2).
 *
 * Kept out of the module so the movement rules can be reasoned about — and tested — without a
 * database, the same way the pickup verdicts are.
 */
import type { ApplicantStage } from '@prisma/client';

/**
 * The pipeline, in order. DECLINED is deliberately outside it: an application can be turned
 * down from anywhere, and it is a verdict rather than a further step.
 */
export const STAGE_ORDER: ApplicantStage[] = [
  'ENQUIRY',
  'APPLIED',
  'ASSESSED',
  'OFFERED',
  'ACCEPTED',
  'ENROLLED',
];

/**
 * Why a move is not allowed, or null when it is.
 *
 * Forward movement is one step at a time — skipping from ENQUIRY straight to OFFERED would mean
 * nobody ever assessed the child, and the pipeline would stop being a record of what actually
 * happened. Moving back is always allowed: miskeying a stage is common, and the office should be
 * able to put it right without a support call.
 *
 * ENROLLED is not reachable here at all. It means a Student row exists, which only conversion
 * can create.
 */
export function stageMoveError(from: ApplicantStage, to: ApplicantStage): string | null {
  if (from === to) return 'The applicant is already at that stage';
  if (from === 'ENROLLED') return 'This applicant is already a student — the pipeline is closed';
  if (to === 'ENROLLED') return 'Convert the applicant to a student instead of setting ENROLLED';
  if (to === 'DECLINED') return null;
  if (from === 'DECLINED') return null; // reopening a declined application
  const i = STAGE_ORDER.indexOf(from);
  const j = STAGE_ORDER.indexOf(to);
  if (j > i + 1) return `Move through ${STAGE_ORDER[i + 1]} first`;
  return null;
}

/** Every stage this applicant may legitimately be moved to, for the UI to offer. */
export function allowedStages(from: ApplicantStage): ApplicantStage[] {
  return [...STAGE_ORDER, 'DECLINED' as ApplicantStage].filter(
    (s) => stageMoveError(from, s) === null,
  );
}
