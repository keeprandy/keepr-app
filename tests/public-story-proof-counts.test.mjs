import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("public story timeline projection calculates proof counts per service record", () => {
  const sql = read(
    "supabase/migrations/20260801120000_public_story_timeline_actual_proof_counts.sql"
  );

  assert.match(sql, /create or replace view public\.public_asset_story_timeline/i);
  assert.match(sql, /from public\.service_record_photos/i);
  assert.match(sql, /from public\.service_record_documents/i);
  assert.match(sql, /where service_record_id is not null/i);
  assert.match(sql, /group by service_record_id/i);
  assert.match(sql, /coalesce\(document_counts\.document_count, 0\)::integer as document_count/i);
  assert.match(sql, /coalesce\(photo_counts\.photo_count, 0\)::integer as photo_count/i);
});

test("public story timeline projection does not publish demo proof badges", () => {
  const sql = read(
    "supabase/migrations/20260801120000_public_story_timeline_actual_proof_counts.sql"
  );

  assert.doesNotMatch(sql, /\b3\s*(?:::integer)?\s+as\s+document_count/i);
  assert.doesNotMatch(sql, /\b12\s*(?:::integer)?\s+as\s+photo_count/i);
  assert.doesNotMatch(sql, /\btrue\s+as\s+verified/i);
});

test("public story verified badge requires verified status and linked proof", () => {
  const sql = read(
    "supabase/migrations/20260801120000_public_story_timeline_actual_proof_counts.sql"
  );

  assert.match(sql, /sr\.verification_status = 'verified'/i);
  assert.match(
    sql,
    /coalesce\(document_counts\.document_count, 0\)\s*\+\s*coalesce\(photo_counts\.photo_count, 0\)\s*\)\s*>\s*0/i
  );
});

test("public story proof badges use singular and plural labels", () => {
  const source = read("screens/PublicKeeprStoryScreen.js");

  assert.match(source, /function formatProofCountLabel\(count, singular\)/);
  assert.match(source, /value === 1 \? "" : "s"/);
  assert.match(source, /formatProofCountLabel\(item\.documentCount, "document"\)/);
  assert.match(source, /formatProofCountLabel\(item\.photoCount, "photo"\)/);
  assert.doesNotMatch(source, /\{item\.documentCount\} documents/);
  assert.doesNotMatch(source, /\{item\.photoCount\} photos/);
});
