/**
 * Exports: the annual grazing record, and CSV of the rows behind it.
 *
 * Two different jobs. The record is for a person — a district conservationist
 * reading it once — and follows the standard's own section order so it can be
 * read alongside the plan without hunting. The CSVs are for a spreadsheet, and
 * carry the raw rows so nothing has to be retyped to check a figure.
 *
 * Neither says "compliant". They report what was recorded.
 */

export interface Column<T> {
  key: string;
  label: string;
  value: (row: T) => string | number | null | undefined;
}

/**
 * Escape one CSV field.
 *
 * Two separate problems, and the second is the one people miss.
 *
 * **Quoting.** A field containing a comma, a quote or a newline is wrapped and
 * its quotes doubled, per RFC 4180.
 *
 * **Formula injection.** These files are opened in Excel and Sheets, where a
 * field beginning `=`, `+`, `-`, `@`, or a tab/CR is treated as a formula. A
 * paddock called `=cmd|...` or, far more likely, a note somebody pasted, then
 * executes on open. The fix is a leading apostrophe, which spreadsheets strip
 * on display — so the value reads as written and does nothing.
 */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  let s = String(value);

  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;

  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

export function toCsv<T>(rows: T[], columns: Column<T>[]): string {
  const head = columns.map((c) => csvField(c.label)).join(",");
  const body = rows.map((r) => columns.map((c) => csvField(c.value(r))).join(","));
  // CRLF, which is what RFC 4180 says and what Excel is happiest with.
  return [head, ...body].join("\r\n");
}

/**
 * Hand a CSV to the browser as a file.
 *
 * The BOM is not decoration: without it Excel on Windows reads UTF-8 as the
 * local code page, and every ° and ″ in a monitoring record turns to mojibake.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`﻿${csv}`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoked on the next tick rather than immediately: Safari has not always
  // finished with the URL by the time click() returns.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** `suchomski-grazing-events-2026-08-13.csv` — the farm, the thing, the day.
 * A file called `export.csv` is unfindable a month later. */
export function exportFilename(what: string, todayIso: string): string {
  return `grazing-${what}-${todayIso.slice(0, 10)}.csv`;
}
