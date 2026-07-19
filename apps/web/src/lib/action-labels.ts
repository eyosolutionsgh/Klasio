/**
 * The wording a button shows as it works.
 *
 * Kept out of `Button.tsx` so it can be unit tested: that file is a client component full of JSX,
 * and the web workspace's vitest has no React transform configured. Pure string handling has no
 * business needing one.
 */

/** Verbs common enough in this product to be worth conjugating properly. */
const KNOWN: Record<string, [pending: string, done: string]> = {
  save: ['Saving…', 'Saved!'],
  send: ['Sending…', 'Sent!'],
  delete: ['Deleting…', 'Deleted!'],
  remove: ['Removing…', 'Removed!'],
  add: ['Adding…', 'Added!'],
  create: ['Creating…', 'Created!'],
  update: ['Updating…', 'Updated!'],
  publish: ['Publishing…', 'Published!'],
  upload: ['Uploading…', 'Uploaded!'],
  record: ['Recording…', 'Recorded!'],
  approve: ['Approving…', 'Approved!'],
  invite: ['Inviting…', 'Invited!'],
  import: ['Importing…', 'Imported!'],
  generate: ['Generating…', 'Generated!'],
};

export interface ActionLabels {
  pending: string;
  done: string;
  failed: string;
}

/**
 * Derive the pending/done/failed wording from a button's idle label.
 *
 * Only the first word is considered, so "Save changes" and "Save" agree. A verb this does not know
 * falls back to neutral wording rather than guessing at English morphology — an invented past
 * tense would land on the one state a user reads most carefully, and "Enrolled!" vs "Enrol'd!" is
 * not a gamble worth taking for the sake of a label.
 */
export function deriveLabels(idle: string): ActionLabels {
  const verb = idle.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  const known = KNOWN[verb];
  if (known) return { pending: known[0], done: known[1], failed: `Couldn't ${verb}` };
  return { pending: 'Working…', done: 'Done!', failed: "Didn't work" };
}
