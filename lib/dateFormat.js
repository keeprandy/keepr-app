function pad(value) {
  return String(value).padStart(2, "0");
}

/* ------------------------------------------------ */
/* Month + weekday helpers */
/* ------------------------------------------------ */

function monthName(monthIndex, short = false) {
  const shortMonths = [
    "Jan","Feb","Mar","Apr","May","Jun",
    "Jul","Aug","Sep","Oct","Nov","Dec"
  ];

  const longMonths = [
    "January","February","March","April","May","June",
    "July","August","September","October","November","December"
  ];

  return short ? shortMonths[monthIndex] : longMonths[monthIndex];
}

function weekdayNameFromParts(year, month, day) {
  const d = new Date(year, month - 1, day);

  return [
    "Sunday","Monday","Tuesday","Wednesday",
    "Thursday","Friday","Saturday"
  ][d.getDay()];
}

/* ------------------------------------------------ */
/* Validation */
/* ------------------------------------------------ */

export function isValidYMD(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);

  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1900 || y > 2100) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;

  const test = new Date(y, m - 1, d);

  return (
    test.getFullYear() === y &&
    test.getMonth() === m - 1 &&
    test.getDate() === d
  );
}

/* ------------------------------------------------ */
/* ISO conversions */
/* ------------------------------------------------ */

export function isoToParts(iso) {
  if (!iso || typeof iso !== "string") return null;

  const match = iso.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;

  const [, y, m, d] = match;

  if (!isValidYMD(y, m, d)) return null;

  return {
    year: Number(y),
    month: Number(m),
    day: Number(d)
  };
}

export function partsToISO({ year, month, day }) {
  if (!isValidYMD(year, month, day)) return null;

  return `${year}-${pad(month)}-${pad(day)}`;
}

/* ------------------------------------------------ */
/* Input formatting (forms) */
/* ------------------------------------------------ */

export function formatDateForInput(iso) {
  const parts = isoToParts(iso);
  if (!parts) return "";

  return `${parts.month}/${parts.day}/${parts.year}`;
}

/* ------------------------------------------------ */
/* UI formatting */
/* ------------------------------------------------ */

export function formatKeeprDate(iso) {
  const parts = isoToParts(iso);
  if (!parts) return "";

  const month = monthName(parts.month - 1, true);

  return `${month} ${parts.day}, ${parts.year}`;
}

/* Optional: long readable form */

export function formatKeeprDateWithWeekday(iso) {
  const parts = isoToParts(iso);
  if (!parts) return "";

  const weekday = weekdayNameFromParts(parts.year, parts.month, parts.day);
  const month = monthName(parts.month - 1, false);

  return `${weekday}, ${month} ${parts.day}, ${parts.year}`;
}

/* ------------------------------------------------ */
/* Report formatting */
/* ------------------------------------------------ */

export function formatDateForReport(iso) {
  const parts = isoToParts(iso);
  if (!parts) return "";

  return `${pad(parts.month)}/${pad(parts.day)}/${parts.year}`;
}

/* ------------------------------------------------ */
/* ISO → common formats */
/* ------------------------------------------------ */

export function isoToMDY(iso) {
  const parts = isoToParts(iso);
  if (!parts) return "";

  return `${pad(parts.month)}/${pad(parts.day)}/${parts.year}`;
}

export function isoToDMY(iso) {
  const parts = isoToParts(iso);
  if (!parts) return "";

  return `${pad(parts.day)}-${pad(parts.month)}-${parts.year}`;
}

/* ------------------------------------------------ */
/* String → ISO */
/* ------------------------------------------------ */

export function mdyToISO(value) {
  if (!value || typeof value !== "string") return null;

  const match = value.trim().match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2,4})$/);
  if (!match) return null;

  let [, mm, dd, yyyy] = match;

  if (yyyy.length === 2) {
    yyyy = `20${yyyy}`;
  }

  return partsToISO({
    year: Number(yyyy),
    month: Number(mm),
    day: Number(dd)
  });
}

export function dmyToISO(value) {
  if (!value || typeof value !== "string") return null;

  const match = value.trim().match(/^(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})$/);
  if (!match) return null;

  const [, dd, mm, yyyy] = match;

  return partsToISO({
    year: Number(yyyy),
    month: Number(mm),
    day: Number(dd)
  });
}

/* ------------------------------------------------ */
/* Flexible parsing (important for Keepr) */
/* ------------------------------------------------ */

export function parseFlexibleDateInput(input) {
  if (!input || typeof input !== "string") return null;

  const raw = input.trim().toLowerCase();
  const now = new Date();

  if (raw === "today") {
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  }

  if (raw === "yesterday") {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);

    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  const match = raw.match(/^(\d{1,2})[\/\-\.](\d{1,2})(?:[\/\-\.](\d{2,4}))?$/);
  if (!match) return null;

  let [, mm, dd, yyyy] = match;

  const month = Number(mm);
  const day = Number(dd);

  if (!yyyy) {
    yyyy = now.getFullYear();
  }

  if (String(yyyy).length === 2) {
    yyyy = `20${yyyy}`;
  }

  const year = Number(yyyy);

  if (!isValidYMD(year, month, day)) return null;

  return `${year}-${pad(month)}-${pad(day)}`;
}