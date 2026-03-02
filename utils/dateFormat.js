// utils/dateFormat.js

const pad2 = (n) => String(n).padStart(2, "0");

export const isIsoDate = (s) =>
  /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());

export const isMmDdYyyy = (s) =>
  /^\d{2}-\d{2}-\d{4}$/.test(String(s || "").trim());

/**
 * Display helper
 * ISO → MM-DD-YYYY
 */
export function formatMMDDYYYY(value) {
  const s = String(value || "").trim();
  if (!s) return "";

  if (isMmDdYyyy(s)) return s;

  if (isIsoDate(s)) {
    const [y, m, d] = s.split("-");
    return `${m}-${d}-${y}`;
  }

  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return s;

  return `${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}-${dt.getFullYear()}`;
}

/**
 * Save helper
 * MM-DD-YYYY → ISO (YYYY-MM-DD)
 */
export function toIsoDateOrEmpty(value) {
  const s = String(value || "").trim();
  if (!s) return "";

  if (isIsoDate(s)) return s;

  if (isMmDdYyyy(s)) {
    const [m, d, y] = s.split("-");
    return `${y}-${m}-${d}`;
  }

  const dt = new Date(s);
  if (Number.isNaN(dt.getTime())) return "";

  return `${dt.getFullYear()}-${pad2(dt.getMonth() + 1)}-${pad2(dt.getDate())}`;
}

/**
 * Soft validation
 */
export function isValidDateInput(value) {
  const s = String(value || "").trim();
  if (!s) return true;

  if (isIsoDate(s) || isMmDdYyyy(s)) return true;

  const dt = new Date(s);
  return !Number.isNaN(dt.getTime());
}