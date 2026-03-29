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
  const patterns = [
    /\$\s?([0-9,]+(?:\.\d{2})?)/i,
    /amount due[:\s]+\$?\s?([0-9,]+(?:\.\d{2})?)/i,
    /invoice total is \$?\s?([0-9,]+(?:\.\d{2})?)/i,
    /balance[:\s]+\$?\s?([0-9,]+(?:\.\d{2})?)/i,
    /total[:\s]+\$?\s?([0-9,]+(?:\.\d{2})?)/i,
  ];

  for (const pattern of patterns) {
    const match = body.match(pattern);
    if (match?.[1]) return match[1].replace(/,/g, "");
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
  if (type === "noise") {
    return "";
  }

  const summary = [];

  if (type === "invoice" && provider) {
    summary.push(`Invoice from ${provider}.`);
  } else if (type === "receipt" && provider) {
    summary.push(`Receipt from ${provider}.`);
  } else if (type === "quote" && provider) {
    summary.push(`Quote from ${provider}.`);
  } else if (provider) {
    summary.push(`Email related to ${provider}.`);
  }

  if (amount && date) {
    summary.push(`Amount $${amount}. Date ${formatUSDate(date)}.`);
  } else if (amount) {
    summary.push(`Amount $${amount}.`);
  } else if (date) {
    summary.push(`Date ${formatUSDate(date)}.`);
  }

  const emailMatch = body.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phoneMatch = body.match(/\(\d{3}\)\s*\d{3}-\d{4}/);

  const contactBits = [];
  if (emailMatch?.[0]) contactBits.push(emailMatch[0]);
  if (phoneMatch?.[0]) contactBits.push(phoneMatch[0]);

  if (contactBits.length) {
    summary.push(`Contact: ${contactBits.join(", ")}.`);
  }

  const firstUsefulParagraph = firstParagraph(body);
  if (firstUsefulParagraph && summary.join(" ").length < 220) {
    summary.push(firstUsefulParagraph);
  }

  return summary.join(" ").replace(/\s{2,}/g, " ").trim();
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