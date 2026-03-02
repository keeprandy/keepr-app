-- 1) Add searchable text fields to attachments
alter table public.attachments
  add column if not exists extracted_text text,
  add column if not exists text_source text default 'none', -- 'pdf_text' | 'ocr' | 'none'
  add column if not exists ocr_status text default 'not_needed', -- 'not_needed' | 'pending' | 'done' | 'failed'
  add column if not exists doc_type text default 'unknown', -- 'unknown' | 'invoice' | 'warranty' | 'manual'
  add column if not exists extracted_at timestamptz,
  add column if not exists extracted_error text;

-- 2) Add a generated tsvector for fast full-text search
-- (If your Supabase Postgres version rejects GENERATED ALWAYS, tell me and we'll use a trigger instead.)
alter table public.attachments
  add column if not exists search_vector tsvector
  generated always as (
    to_tsvector('english', coalesce(extracted_text, ''))
  ) stored;

-- 3) Index it
create index if not exists attachments_search_vector_gin
  on public.attachments
  using gin (search_vector);

-- 4) Optional: quick filters that matter
create index if not exists attachments_doc_type_idx
  on public.attachments (doc_type);

create index if not exists attachments_ocr_status_idx
  on public.attachments (ocr_status);
