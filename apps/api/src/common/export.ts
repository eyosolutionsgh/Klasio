/**
 * Tabular export/import helpers. CSV is generated natively (no dependency, works everywhere);
 * xlsx uses ExcelJS. Buffers are streamed via NestJS StreamableFile and pass through the web
 * proxy unchanged.
 */
import { Workbook } from 'exceljs';

export type Cell = string | number | null | undefined;

export function toCsv(headers: string[], rows: Cell[][]): Buffer {
  const esc = (v: Cell) => {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))];
  // Prefix BOM so Excel opens UTF-8 (Ghanaian names) correctly.
  return Buffer.from('﻿' + lines.join('\r\n'), 'utf8');
}

export async function toXlsx(
  sheetName: string,
  headers: string[],
  rows: Cell[][],
): Promise<Buffer> {
  const wb = new Workbook();
  wb.creator = 'EYO School Management';
  const ws = wb.addWorksheet(sheetName);
  ws.addRow(headers);
  ws.getRow(1).font = { bold: true };
  ws.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F4' } };
  rows.forEach((r) => ws.addRow(r.map((c) => c ?? '')));
  ws.columns.forEach((col) => {
    let max = 10;
    col.eachCell?.({ includeEmpty: false }, (cell) => {
      max = Math.max(max, String(cell.value ?? '').length + 2);
    });
    col.width = Math.min(max, 40);
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** A single onboarding-template sheet definition. */
export interface TemplateSpec {
  sheetName: string;
  headers: string[];
  sample: Cell[][];
  notes?: string[];
}

/** Build an xlsx onboarding template: header row + a couple of sample rows. */
export async function templateXlsx(spec: TemplateSpec): Promise<Buffer> {
  const wb = new Workbook();
  wb.creator = 'EYO School Management';
  const ws = wb.addWorksheet(spec.sheetName);
  ws.addRow(spec.headers);
  ws.getRow(1).font = { bold: true };
  spec.sample.forEach((r) => ws.addRow(r.map((c) => c ?? '')));
  ws.columns.forEach((col) => (col.width = 22));
  // Notes live on a separate sheet so a straight re-import of the data sheet stays clean.
  if (spec.notes?.length) {
    const help = wb.addWorksheet('Instructions');
    help.getColumn(1).width = 90;
    help.addRow(['How to fill this template']).font = { bold: true };
    spec.notes.forEach((n) => {
      help.addRow([n]).font = { italic: true, color: { argb: 'FF78716C' } };
    });
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Parse the first worksheet of an xlsx buffer into objects keyed by the header row. */
export async function parseXlsx(buffer: Buffer): Promise<Record<string, string>[]> {
  const wb = new Workbook();
  // Node 22's Buffer type is narrower than exceljs's declared parameter; runtime accepts a Buffer.
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const headers: string[] = [];
  const out: Record<string, string>[] = [];
  ws.eachRow((row, rowNumber) => {
    const values = row.values as unknown[]; // 1-indexed; [0] is empty
    if (rowNumber === 1) {
      for (let i = 1; i < values.length; i++) headers[i] = String(values[i] ?? '').trim();
      return;
    }
    const rec: Record<string, string> = {};
    let any = false;
    for (let i = 1; i < headers.length; i++) {
      const key = headers[i];
      if (!key) continue;
      const raw = values[i];
      let val: string;
      if (raw == null) val = '';
      else if (raw instanceof Date) val = raw.toISOString().slice(0, 10);
      else if (typeof raw === 'object')
        val = String(
          (raw as { text?: string; result?: unknown }).text ??
            (raw as { result?: unknown }).result ??
            '',
        );
      else val = String(raw);
      rec[key] = val.trim();
      if (rec[key]) any = true;
    }
    if (any) out.push(rec);
  });
  return out;
}
