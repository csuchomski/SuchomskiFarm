/**
 * Between an instant and what a `datetime-local` input shows.
 *
 * The record stores instants in UTC; the farmer reads a clock on the wall. A
 * move logged at half seven on an August morning has to come back into the
 * form as 07:30, not 12:30, or every correction silently shifts the record by
 * the offset — and the boundary either side of it with it.
 *
 * `toLocalInput` cannot use `toISOString()`, which converts to UTC first. The
 * parts have to be read off in local time and assembled by hand.
 */
export function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `T${pad(d.getHours())}:${pad(d.getMinutes())}`
  );
}

/**
 * Back the other way. `new Date("2026-08-14T07:30")` — no zone — is already
 * read as local time by every browser, so this is only a guard against a
 * half-typed date, which `<input type="datetime-local">` will hand over
 * while someone is still typing it.
 */
export function fromLocalInput(value: string): string | null {
  if (value.trim() === "") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
