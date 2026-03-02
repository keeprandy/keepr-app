// lib/pdfTextExtract.js
// Web-only helper for extracting text from a PDF URL using pdfjs-dist.

import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf";

// IMPORTANT: worker must be set on web.
// Using a CDN worker avoids bundler pain for V1.
export function initPdfJsWorker() {
  if (typeof window === "undefined") return;

  try {
    // Legacy build requires explicit worker path
    pdfjsLib.GlobalWorkerOptions.workerSrc =
      "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";
  } catch (e) {
    console.warn("PDF.js worker init failed", e);
  }
}

/**
 * Extract text from a PDF available at a URL.
 * - url should be a signed URL or public URL.
 * - maxPages prevents giant PDFs from freezing the UI.
 */
export async function extractPdfTextFromUrl(url, { maxPages = 40 } = {}) {
  if (!url) throw new Error("Missing PDF URL");

  // Fetch bytes
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch PDF (${res.status})`);
  const buf = await res.arrayBuffer();

  // Load PDF
  const loadingTask = pdfjsLib.getDocument({ data: buf });
  const pdf = await loadingTask.promise;

  const pageCount = Math.min(pdf.numPages || 0, maxPages);
  let out = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();

    // Join items in reading order. This is Level 1 quality.
    const strings = (content.items || [])
      .map((it) => (it && it.str ? String(it.str) : ""))
      .filter(Boolean);

    const pageText = strings.join(" ");
    if (pageText.trim()) out.push(pageText.trim());
  }

  // Separate pages clearly for searchability
  return out.join("\n\n---\n\n");
}