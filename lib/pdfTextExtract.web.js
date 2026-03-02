// lib/pdfTextExtract.web.js
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf";

// Use a CDN worker (avoids import.meta issues)
pdfjsLib.GlobalWorkerOptions.workerSrc =
  "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/2.16.105/pdf.worker.min.js";

export async function extractPdfTextFromUrl(url) {
  if (!url) throw new Error("Missing PDF URL");

  const loadingTask = pdfjsLib.getDocument(url);
  const pdf = await loadingTask.promise;

  const chunks = [];
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const pageText = content.items.map((i) => i.str).join(" ");
    chunks.push(pageText);
  }

  return chunks.join("\n\n").trim();
}