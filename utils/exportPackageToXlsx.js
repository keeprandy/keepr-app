// utils/exportPackageToXlsx.js
import { Platform } from "react-native";

// SheetJS (https://github.com/SheetJS/sheetjs)
// Install: npm i xlsx
import * as XLSX from "xlsx";

// Native helpers (Expo). Install if you want native export:
// expo install expo-file-system expo-sharing
let FileSystem;
let Sharing;

async function ensureNativeDeps() {
  if (Platform.OS === "web") return;
  if (!FileSystem) {
    try {
      FileSystem = await import("expo-file-system");
    } catch (e) {
      throw new Error(
        "Missing expo-file-system. Run: expo install expo-file-system"
      );
    }
  }
  if (!Sharing) {
    try {
      Sharing = await import("expo-sharing");
    } catch (e) {
      throw new Error("Missing expo-sharing. Run: expo install expo-sharing");
    }
  }
}

function sanitizeFilename(name) {
  return String(name || "report")
    .replace(/[^\w\-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function downloadOnWeb(arrayBuffer, filename) {
  const blob = new Blob([arrayBuffer], {
    type:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet;charset=UTF-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Export an XLSX workbook with one or more sheets.
 *
 * @param {Object} opts
 * @param {string} opts.fileName - file base name (no extension)
 * @param {Array<{name: string, rows: any[]}>} opts.sheets - sheet defs (rows are JSON objects)
 */
export async function exportToXlsx({ fileName, sheets }) {
  const safeName = sanitizeFilename(fileName);
  const wb = XLSX.utils.book_new();

  (sheets || []).forEach((s) => {
    const ws = XLSX.utils.json_to_sheet(s.rows || []);
    XLSX.utils.book_append_sheet(wb, ws, s.name || "Sheet1");
  });

  if (Platform.OS === "web") {
    const out = XLSX.write(wb, { bookType: "xlsx", type: "array" });
    downloadOnWeb(out, `${safeName}.xlsx`);
    return;
  }

  await ensureNativeDeps();

  // On native, write base64 then share.
  const base64 = XLSX.write(wb, { bookType: "xlsx", type: "base64" });
  const path = `${FileSystem.cacheDirectory}${safeName}.xlsx`;

  await FileSystem.writeAsStringAsync(path, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  const canShare = await Sharing.isAvailableAsync();
  if (!canShare) {
    throw new Error("Sharing is not available on this device.");
  }
  await Sharing.shareAsync(path, {
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    dialogTitle: safeName,
    UTI: "com.microsoft.excel.xlsx",
  });
}
