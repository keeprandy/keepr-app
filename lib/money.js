export function parseMoneyInput(value) {
  if (value === null || value === undefined) return null;

  const raw = String(value).trim();
  if (!raw) return null;

  const compact = raw.replace(/\s+/g, "").replace(/[$,]/g, "");
  const match = compact.match(/^(-?(?:\d+\.?\d*|\.\d+))([kmb])?$/i);
  if (!match) return null;

  const amount = Number(match[1]);
  if (!Number.isFinite(amount)) return null;

  const multiplier = {
    k: 1_000,
    m: 1_000_000,
    b: 1_000_000_000,
  }[String(match[2] || "").toLowerCase()] || 1;

  return amount * multiplier;
}

export function formatMoneyInput(value, options = {}) {
  const amount = parseMoneyInput(value);
  if (amount === null) return "";

  const {
    currency = "USD",
    maximumFractionDigits = Number.isInteger(amount) ? 0 : 2,
    minimumFractionDigits = 0,
  } = options;

  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits,
    maximumFractionDigits,
  }).format(amount);
}

export function dollarsToCentsInput(value) {
  const amount = parseMoneyInput(value);
  return amount === null ? null : Math.round(amount * 100);
}

export function centsToDollarsInput(cents) {
  if (cents === null || cents === undefined || cents === "") return "";
  const amount = Number(cents);
  if (!Number.isFinite(amount)) return "";
  return formatMoneyInput(amount / 100, {
    maximumFractionDigits: 2,
    minimumFractionDigits: amount % 100 === 0 ? 0 : 2,
  });
}
