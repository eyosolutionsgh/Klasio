/**
 * Plain-English descriptions of a file, for the family and student portals.
 *
 * Parents and pupils never see a MIME type. `application/vnd.openxmlformats-officedocument.
 * wordprocessingml.document` is not an answer to "what is this?" — the same class of leak as the
 * raw ledger enums that once showed families "WAIVER" on their own bill.
 */
const FILE_KIND: [RegExp, string][] = [
  [/^application\/pdf$/, 'PDF'],
  [/wordprocessingml|msword/, 'Word document'],
  [/presentationml|ms-powerpoint/, 'Slides'],
  [/spreadsheetml|ms-excel|^text\/csv$/, 'Spreadsheet'],
  [/^text\/plain$/, 'Text file'],
  [/^image\//, 'Picture'],
];

/** What the file is, in words a parent can read. Falls back to a neutral noun, never a MIME type. */
export function fileKind(mimeType: string): string {
  return FILE_KIND.find(([re]) => re.test(mimeType))?.[1] ?? 'File';
}

/**
 * Size in the unit a person would say out loud. This is a data-cost signal on a metered Android
 * connection, so it is shown before they tap, not after.
 */
export function fileSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
