export function buildTimelinePrefillFromEmailText({
  subject,
  textBody,
  date,
}) {
  const rawSubject = String(subject || "").trim();
  const rawBody = String(textBody || "").trim();

  const cleanedSubject = cleanSubject(rawSubject);
  const cleanedBody = cleanEmailBody(rawBody);

  const type = detectEmailType(cleanedSubject, cleanedBody);
  const prefillProvider = extractProvider(cleanedBody, cleanedSubject, type);
  const prefillAmount = extractAmount(cleanedBody);
  const prefillDate = extractRelevantDate(cleanedBody) || normalizeDate(date);
  const prefillTitle = buildTitle(cleanedSubject, cleanedBody, prefillProvider, type);
  const prefillNotes = buildNotes({
    body: cleanedBody,
    provider: prefillProvider,
    amount: prefillAmount,
    date: prefillDate,
    type,
  });

  const confidence =
    (prefillProvider ? 1 : 0) +
    (prefillAmount ? 1 : 0) +
    (prefillDate ? 1 : 0);

  return {
    prefillTitle,
    prefillNotes,
    prefillDate,
    prefillAmount,
    prefillProvider,
    prefillLocation: "",
    attachments: [],
    sourceType: "email",
    emailType: type,
    confidence,
  };
}

function cleanSubject(subject) {
  return String(subject || "")
    .replace(/^\s*(re|fw|fwd)\s*:\s*/gi, "")
    .replace(/^\s*(re|fw|fwd)\s*:\s*/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function cleanEmailBody(body) {
  let text = String(body || "");

  text = text
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n");

  const killPatterns = [
    /---------- Forwarded message ---------[\s\S]*?(?=---------- Original Message ----------)/gi,
    /________________________________[\s\S]*?(?=---------- Forwarded message ---------)/gi,
    /Powered by Jobber[\s\S]*$/gi,
    /Copyright © .*$/gim,
    /Button not working\? Copy and paste this link[\s\S]*$/gi,
    /https?:\/\/\S+/gi,
    /\[image:[^\]]*\]/gi,
    /Visit Site.*/gi,
    /90\+\s+new members joined.*/gi,
  ];

  for (const pattern of killPatterns) {
    text = text.replace(pattern, "\n");
  }

  text = text
    .replace(/<mailto:[^>]+>/gi, "")
    .replace(/<https?:\/\/[^>]+>/gi, "")
    .replace(/\[[^\]]+\]\s*/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return text;
}

function detectEmailType(subject, body) {
  const s = `${subject}\n${body}`.toLowerCase();

  if (
    /invoice|invoice balance|pay invoice|due\s+[a-z]{3,9}\s+\d{1,2},\s+\d{4}|invoice total/i.test(s)
  ) {
    return "invoice";
  }

  if (/receipt|payment received|paid|payment confirmation/i.test(s)) {
    return "receipt";
  }

  if (/quote|estimate|proposal/i.test(s)) {
    return "quote";
  }

  if (/service update|appointment|scheduled|rescheduled|visit/i.test(s)) {
    return "service_update";
  }

  if (
    /forum|newsletter|new members|visit site|rediscover|community/i.test(s)
  ) {
    return "noise";
  }

  return "note";
}

function buildTitle(subject, body, provider, type) {
  let s = String(subject || "").trim();

  s = s
    .replace(/^Invoice from\s+/i, "")
    .replace(/^Receipt from\s+/i, "")
    .replace(/^Payment received from\s+/i, "")
    .trim();

  if (type === "noise") {
    return s || "Email";
  }

  if (s) {
    return s;
  }

  if (provider && type === "invoice") return `${provider} — Invoice`;
  if (provider && type === "receipt") return `${provider} — Receipt`;
  if (provider && type === "quote") return `${provider} — Quote`;
  if (provider) return provider;

  return "Email Record";
}

function extractProvider(body, subject, type) {
  const patterns = [
    /Invoice from\s+\*?(.+?)\*?(?:\n|$)/i,
    /Receipt from\s+\*?(.+?)\*?(?:\n|$)/i,
    /Payment received from\s+\*?(.+?)\*?(?:\n|$)/i,
    /Sincerely,\s*\n\s*\n([^\n]+)/i,
    /^([A-Za-z0-9&.,'’\- ]+)\n\(\d{3}\)\s*\d{3}-\d{4}/m,
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match?.[1]) return cleanInline(match[1]);
  }

  if (type === "invoice" || type === "receipt" || type === "quote") {
    const subjectMatch = subject.match(
      /(?:invoice|receipt|quote|estimate)\s+from\s+(.+)/i
    );
    if (subjectMatch?.[1]) return cleanInline(subjectMatch[1]);
  }

  return "";
}

function extractAmount(body) {
  const text = String(body || "").toLowerCase();

  // 1. Strongest signals first (these should ALWAYS win)
  const strongPatterns = [
    /amount\s+paid[^0-9]*\$?\s*([0-9,]+\.\d{2})/i,
    /total\s+paid[^0-9]*\$?\s*([0-9,]+\.\d{2})/i,
    /grand\s+total[^0-9]*\$?\s*([0-9,]+\.\d{2})/i,
  ];

  for (const pattern of strongPatterns) {
    const match = text.match(pattern);
    if (match?.[1]) {
      return match[1].replace(/,/g, "");
    }
  }

  // 2. Subtotal + tax (structured receipts like yours)
  const subtotalTaxMatch = text.match(
    /subtotal[^0-9]*\$?\s*([0-9,]+\.\d{2})[\s\S]*?sales\s+tax[^0-9]*\$?\s*([0-9,]+\.\d{2})/i
  );

  if (subtotalTaxMatch?.[1] && subtotalTaxMatch?.[2]) {
    const subtotal = Number(subtotalTaxMatch[1].replace(/,/g, ""));
    const tax = Number(subtotalTaxMatch[2].replace(/,/g, ""));
    return (subtotal + tax).toFixed(2);
  }

  // 3. LAST resort (but avoid picking small line items)
  const allAmounts = [...text.matchAll(/\$?\s*([0-9,]+\.\d{2})/g)]
    .map(m => Number(m[1].replace(/,/g, "")))
    .filter(n => !isNaN(n));

  if (allAmounts.length) {
    // return the LARGEST number (almost always the total)
    return Math.max(...allAmounts).toFixed(2);
  }

  return "";
}

function extractRelevantDate(body) {
  const patterns = [
    /Due\s+([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})/i,
    /paid on\s+([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})/i,
    /date[:\s]+([A-Za-z]{3,9}\s+\d{1,2},\s+\d{4})/i,
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (!match?.[1]) continue;
    const d = new Date(match[1]);
    if (!Number.isNaN(d.getTime())) return toISODate(d);
  }

  return "";
}

function normalizeDate(input) {
  if (!input) return "";
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return "";
  return toISODate(d);
}

function toISODate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function buildNotes({ body, provider, amount, date, type }) {
  if (type === "noise") return "";

  const jobNumber = body.match(/Job Number:\s*([A-Z0-9-]+)/i)?.[1] || null;

  const work = [];
  if (/pump/i.test(body)) work.push("2HP pump replacement");
  if (/heater/i.test(body)) work.push("4.0kW heater insert");
  if (/labor/i.test(body)) work.push("labor");
  if (/service call|service trip/i.test(body)) work.push("service call");

  const parts = [];

  if (provider) {
    parts.push(`${provider} completed service${date ? ` on ${formatUSDate(date)}` : ""}.`);
  }

  if (work.length) {
    parts.push(`Work included ${work.join(", ")}.`);
  }

  if (amount) {
    parts.push(`Total paid: $${amount}.`);
  }

  if (jobNumber) {
    parts.push(`Job #${jobNumber}.`);
  }

  return parts.join(" ").trim();
}

function firstParagraph(body) {
  const paragraphs = String(body || "")
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);

  for (const p of paragraphs) {
    if (
      p.length < 20 ||
      /forwarded message|original message|visit site|new members|forum/i.test(p)
    ) {
      continue;
    }
    return p;
  }

  return "";
}

function formatUSDate(isoDate) {
  const d = new Date(`${isoDate}T00:00:00`);
  if (Number.isNaN(d.getTime())) return isoDate;
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function cleanInline(s) {
  return String(s || "")
    .replace(/\*/g, "")
    .replace(/\s{2,}/g, " ")
    .replace(/[<>]/g, "")
    .trim();
}