/**
 * CSV export.
 *
 * TWO HAZARDS THIS FILE EXISTS TO HANDLE
 *
 *   1. FORMULA INJECTION. A cell whose text begins with = + - @ (or a tab or
 *      carriage return) is executed as a formula by Excel and Google Sheets.
 *      Client names, site names, descriptions and supplier names in this system
 *      are all free text typed by a user, so a name like
 *      `=HYPERLINK("http://evil","click")` becomes a live formula the moment an
 *      accountant opens the export. Every such cell is prefixed with an
 *      apostrophe, which Excel strips on display and never evaluates.
 *
 *   2. MONEY FORMAT. Exports are read by accountants in spreadsheets, so amounts
 *      leave as decimal birr, not santim. Internally money stays integer santim;
 *      the conversion happens here, at the boundary, once.
 */

import { santimToBirr } from './money.js';
import { formatEthiopian, formatGregorianShort, utcDateToEthiopian } from './ethiopic.js';

/** Characters that make a spreadsheet treat a cell as a formula. */
const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Escape one cell.
 *
 * Neutralises formula injection first, then applies RFC 4180 quoting. Order
 * matters: quoting alone does NOT stop Excel evaluating `"=1+1"`.
 */
export function escapeCell(value: unknown): string {
  if (value === null || value === undefined) return '';

  let text = String(value);

  if (text.length > 0 && FORMULA_PREFIXES.some((prefix) => text.startsWith(prefix))) {
    text = `'${text}`;
  }

  // Quote when the value contains a delimiter, a quote, or a line break.
  if (/[",\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/** An amount in santim rendered as decimal birr for a spreadsheet. */
export function money(santim: number | null | undefined): string {
  if (santim === null || santim === undefined) return '';
  return santimToBirr(santim).toFixed(2);
}

/** A basis-point rate rendered as a percentage, or blank when there is no data. */
export function percent(bps: number | null | undefined): string {
  if (bps === null || bps === undefined) return '';
  return (bps / 100).toFixed(2);
}

/** Ethiopian and Gregorian renderings of the same instant, for two columns. */
export function dualDateColumns(date: Date | null | undefined): [string, string] {
  if (date === null || date === undefined) return ['', ''];
  return [formatEthiopian(utcDateToEthiopian(date)), formatGregorianShort(date)];
}

export interface CsvColumn<T> {
  header: string;
  value: (row: T) => unknown;
}

/**
 * Render rows to a CSV string.
 *
 * CRLF line endings, because Excel on Windows is the dominant reader and LF
 * alone leaves some versions showing the whole file on one line.
 */
export function toCsv<T>(columns: readonly CsvColumn<T>[], rows: readonly T[]): string {
  const lines = [columns.map((c) => escapeCell(c.header)).join(',')];
  for (const row of rows) {
    lines.push(columns.map((c) => escapeCell(c.value(row))).join(','));
  }
  return lines.join('\r\n');
}

/**
 * Trigger a browser download.
 *
 * A BOM is prepended so Excel reads the file as UTF-8 — without it, Amharic
 * client names and the ETB sign arrive as mojibake, which is exactly the kind of
 * defect that gets blamed on the data rather than the encoding.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** `intelmotion-vat-EC-2018-04-2025-12-31.csv` — sortable and self-describing. */
export function reportFilename(report: string, period: string): string {
  const stamp = new Date().toISOString().slice(0, 10);
  const safe = `${report}-${period}`.replace(/[^A-Za-z0-9-]+/g, '-').toLowerCase();
  return `intelmotion-${safe}-${stamp}.csv`;
}
