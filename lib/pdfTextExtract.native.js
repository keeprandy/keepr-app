// lib/pdfTextExtract.native.js
export async function extractPdfTextFromUrl() {
  // pdf.js is browser-only. Native should use scanner OCR + paste, or a server OCR job later.
  throw new Error("PDF text extraction is web-only. Use OCR paste on mobile.");
}