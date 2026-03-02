// lib/invoiceEngineClient.js
// Client wrapper for Keepr's Invoice Intelligence (backed by OpenAI on the server)

import { supabase } from "./supabaseClient";

/**
 * Upload a local file (image or PDF) to Supabase and
 * return a public URL that the backend / OpenAI can read.
 */
export async function uploadInvoiceFileAsync(localUri, userId) {
  if (!localUri) throw new Error("No file URI provided");

  const fileExt = localUri.split(".").pop() || "jpg";
  const fileName = `invoice_${userId || "anon"}_${Date.now()}.${fileExt}`;
  const path = `invoices/${fileName}`;

  const file = await fetch(localUri);
  const blob = await file.blob();

  const { error: uploadError } = await supabase.storage
    .from("invoice-files")
    .upload(path, blob, {
      contentType:
        fileExt.toLowerCase() === "pdf" ? "application/pdf" : "image/jpeg",
      upsert: false,
    });

  if (uploadError) {
    console.error("Error uploading invoice file", uploadError);
    throw uploadError;
  }

  const {
    data: { publicUrl },
  } = supabase.storage.from("invoice-files").getPublicUrl(path);

  return { path, publicUrl };
}

/**
 * Ask your backend to analyze an invoice at a given URL and return a ParsedInvoice.
 * This is where your OpenAI logic will eventually live (backend route).
 */
export async function analyzeInvoiceAtUrlAsync({ fileUrl, userId }) {
  // TODO: replace this with a real HTTP call to your backend
  // e.g. https://api.keepr.app/intake/invoice
  // For now, return a simple stub so the UI can be wired.
  console.log("analyzeInvoiceAtUrlAsync called with", fileUrl, userId);

  // STUB: you can customize this while testing
  return {
    vendor: {
      name: "Sample Marina & Service",
    },
    asset_hint: {
      type: "boat",
      name: "2008 Harris Kayot", // good test for your boat
    },
    service_record: {
      performed_at: new Date().toISOString().slice(0, 10),
      title: "Service from imported invoice",
      notes:
        "This is a stubbed invoice analysis. Replace with real OpenAI-powered backend.",
      cost_total: 210.0,
      currency: "USD",
      service_type: "pro",
      location_name: "Sample Marina & Service",
      invoice_number: "INV-TEST-001",
    },
    line_items: [],
    meta: {},
  };
}
