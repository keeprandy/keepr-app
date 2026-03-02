import "dotenv/config";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE) {
  console.error("Missing env vars: SUPABASE_URL and/or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
  auth: { persistSession: false },
});

const BUCKET = "asset-photos";

// Simple helpers
const isImageName = (name = "") =>
  /\.(png|jpg|jpeg|webp|heic|heif|gif)$/i.test(name);

async function listAllInFolder(path) {
  // Supabase Storage list uses pagination via offset/limit
  const out = [];
  const limit = 100;
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage.from(BUCKET).list(path, {
      limit,
      offset,
      sortBy: { column: "name", order: "asc" },
    });

    if (error) throw error;
    if (!data?.length) break;

    out.push(...data);
    if (data.length < limit) break;
    offset += limit;
  }
  return out;
}

async function main() {
  console.log(`Counting objects in bucket: ${BUCKET}`);

  // 1) list root "folders" (your UUIDs)
  const rootItems = await listAllInFolder("");
  const folders = rootItems.filter((x) => x.id == null); // folders have no id; files have id
  const rootFiles = rootItems.filter((x) => x.id != null);

  if (rootFiles.length) {
    console.log(
      `Note: found ${rootFiles.length} file(s) directly at bucket root (unexpected).`
    );
  }

  console.log(`Root folders found: ${folders.length}`);

  // 2) count files inside each folder
  let totalFiles = 0;
  let imageFiles = 0;
  let otherFiles = 0;

  // store full paths so we can compare to DB later
  const storagePaths = new Set();

  for (const f of folders) {
    const folderName = f.name;
    const children = await listAllInFolder(folderName);

    for (const item of children) {
      if (item.id == null) continue; // skip nested folders if any
      totalFiles += 1;

      const fullPath = `${folderName}/${item.name}`;
      storagePaths.add(fullPath);

      if (isImageName(item.name)) imageFiles += 1;
      else otherFiles += 1;
    }
  }

  console.log(`Storage totals in ${BUCKET}:`);
  console.log(`- Total objects (files): ${totalFiles}`);
  console.log(`- Images: ${imageFiles}`);
  console.log(`- Non-images: ${otherFiles}`);

  // 3) Compare to DB (so you can see the “11 referenced” vs “many in bucket” gap)
  const { data: rows, error: dbErr } = await supabase
    .from("attachments")
    .select("id,bucket,storage_path,deleted_at,kind,mime_type")
    .eq("bucket", BUCKET);

  if (dbErr) throw dbErr;

  const dbAll = rows?.length ?? 0;
  const dbActive = (rows ?? []).filter((r) => !r.deleted_at).length;

  const dbPaths = new Set(
    (rows ?? []).map((r) => String(r.storage_path || "").trim()).filter(Boolean)
  );

  let referencedInStorage = 0;
  for (const p of dbPaths) {
    if (storagePaths.has(p)) referencedInStorage += 1;
  }

  // Orphans: storage objects not referenced by DB
  let orphanCount = 0;
  for (const p of storagePaths) {
    if (!dbPaths.has(p)) orphanCount += 1;
  }

  console.log(`DB rows where bucket='${BUCKET}':`);
  console.log(`- Total DB rows: ${dbAll}`);
  console.log(`- Active (deleted_at is null): ${dbActive}`);
  console.log(`Path match check:`);
  console.log(`- DB paths that exist in Storage: ${referencedInStorage}`);
  console.log(`- Orphan storage objects (no DB row): ${orphanCount}`);

  // 4) Write orphan list to a file (so you can review before deleting)
  // Keeping it dead simple: one path per line
  const fs = await import("node:fs");
  const orphanPaths = [];
  for (const p of storagePaths) {
    if (!dbPaths.has(p)) orphanPaths.push(p);
  }
  fs.writeFileSync("asset-photos-orphans.txt", orphanPaths.join("\n"));
  console.log(`Wrote orphan paths to: asset-photos-orphans.txt`);
}

main().catch((e) => {
  console.error("ERROR:", e);
  process.exit(1);
});