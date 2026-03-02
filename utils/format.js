// utils/format.js

// Format "2019-12-15" (or any ISO-ish string) as "12/15/2019"
export function formatDateUS(dateString) {
  if (!dateString) return "";
  const d = new Date(dateString);
  if (isNaN(d)) return dateString; // fallback if it's already formatted or odd

  const month = (d.getMonth() + 1).toString().padStart(2, "0");
  const day = d.getDate().toString().padStart(2, "0");
  const year = d.getFullYear();

  return `${month}/${day}/${year}`;
}

// Parse "12/15/2019" (or "12-15-2019") → "2019-12-15"
export function parseDateFromUS(value) {
  if (!value) return null;
  const parts = value.split(/[/-]/).map((p) => parseInt(p, 10));
  if (parts.length !== 3) return null;

  const [month, day, year] = parts;
  if (!month || !day || !year) return null;

  const d = new Date(year, month - 1, day);
  if (isNaN(d)) return null;

  const mm = month.toString().padStart(2, "0");
  const dd = day.toString().padStart(2, "0");
  const yyyy = year.toString().padStart(4, "0");

  return `${yyyy}-${mm}-${dd}`;
}

// Simple helper for numeric fields from text inputs
export function parseNumberOrNull(value) {
  if (value === undefined || value === null) return null;
  const cleaned = String(value).replace(/,/g, "").trim();
  if (!cleaned) return null;
  const n = Number(cleaned);
  return isNaN(n) ? null : n;
}
