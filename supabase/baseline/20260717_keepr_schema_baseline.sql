


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';


CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";


CREATE OR REPLACE FUNCTION "public"."digest"("data" text, "type" text) RETURNS bytea
    LANGUAGE sql IMMUTABLE PARALLEL SAFE
    SET search_path TO 'extensions', 'pg_catalog'
    AS 35583
      SELECT "extensions"."digest"("data", "type");
    35583;


ALTER FUNCTION "public"."digest"("data" text, "type" text) OWNER TO "postgres";





CREATE TYPE "public"."confidence_level" AS ENUM (
    'reported',
    'user_supplied',
    'derived'
);


ALTER TYPE "public"."confidence_level" OWNER TO "postgres";


CREATE TYPE "public"."enrichment_run_status" AS ENUM (
    'queued',
    'running',
    'done',
    'failed'
);


ALTER TYPE "public"."enrichment_run_status" OWNER TO "postgres";


CREATE TYPE "public"."object_category" AS ENUM (
    'history',
    'operating',
    'investment',
    'identity',
    'registry'
);


ALTER TYPE "public"."object_category" OWNER TO "postgres";


CREATE TYPE "public"."proposal_scope" AS ENUM (
    'historical',
    'ownership',
    'current',
    'future'
);


ALTER TYPE "public"."proposal_scope" OWNER TO "postgres";


CREATE TYPE "public"."proposal_status" AS ENUM (
    'pending',
    'accepted',
    'rejected',
    'superseded'
);


ALTER TYPE "public"."proposal_status" OWNER TO "postgres";




CREATE OR REPLACE FUNCTION "public"."accept_asset_transfer"("p_inbox_item_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_item      inbox_items%rowtype;
  v_auth_user uuid := auth.uid();
  v_asset_id  uuid;
begin
  if v_auth_user is null then
    raise exception 'Not authenticated' using errcode = '28000';
  end if;

  -- Lock the inbox row for this user
  select *
  into v_item
  from inbox_items
  where id = p_inbox_item_id
    and to_user_id = v_auth_user
  for update;

  if not found then
    raise exception 'Transfer item not found for this user' using errcode = 'PGRST116';
  end if;

  if v_item.type <> 'asset_transfer' then
    raise exception 'Inbox item is not an asset_transfer';
  end if;

  -- Already processed? no-op
  if v_item.status is not null and v_item.status <> 'pending' then
    return;
  end if;

  -- We stored the asset id in payload.asset_id
  if v_item.payload is null or v_item.payload->>'asset_id' is null then
    raise exception 'Transfer payload missing asset_id';
  end if;

  v_asset_id := (v_item.payload->>'asset_id')::uuid;

  -- 1) Move canonical ownership on the asset row
  update assets
  set owner_id = v_auth_user,
      status   = case
                   when status = 'transfer_ready' then 'active'
                   else status
                 end
  where id = v_asset_id;

  -- 2) (Optional, if you want stewardship synced now)
  -- If you *know* asset_stewardships is live, keep this.
  -- If you're not using it yet, you can comment this block out.

  update asset_stewardships
  set active = false
  where asset_id   = v_asset_id
    and access_role = 'owner'
    and active      = true;

  insert into asset_stewardships (
    asset_id,
    org_id,
    user_id,
    access_role,
    active,
    starts_at
  )
  values (
    v_asset_id,
    null,
    v_auth_user,
    'owner',
    true,
    now()
  )
  on conflict do nothing;

  -- 3) Mark transfer as accepted
  update inbox_items
  set status = 'accepted'
  where id = p_inbox_item_id;
end;
$$;


ALTER FUNCTION "public"."accept_asset_transfer"("p_inbox_item_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_asset_transfer"("p_inbox_item_id" "uuid", "p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_item     inbox_items%ROWTYPE;
  v_asset_id uuid;
begin
  -- 1) Load the transfer request row
  select *
    into v_item
    from inbox_items
   where id = p_inbox_item_id
     and type = 'asset_transfer';

  if not found then
    raise exception 'Transfer request not found';
  end if;

  -- 2) Enforce that this user is the intended recipient
  if v_item.to_user_id is distinct from p_user_id then
    raise exception 'You are not the recipient of this transfer.';
  end if;

  -- 3) Extract asset_id from JSON payload
  v_asset_id := (v_item.payload ->> 'asset_id')::uuid;
  if v_asset_id is null then
    raise exception 'Transfer payload missing asset_id.';
  end if;

  -- 4) Move ownership: just change owner_id + status
  update assets
     set owner_id = p_user_id,
         status   = 'active'
   where id = v_asset_id;

  -- 5) Mark the transfer request as accepted
  update inbox_items
     set status = 'accepted'
   where id = p_inbox_item_id;
end;
$$;


ALTER FUNCTION "public"."accept_asset_transfer"("p_inbox_item_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."accept_asset_transfer_simple"("p_inbox_item_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $_$
declare
  v_item record;

  -- column existence flags (so we don't reference non-existent cols)
  has_from_user_id boolean;
  has_type boolean;
  has_acted_at boolean;
begin
  -- detect optional columns
  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='inbox_items' and column_name='from_user_id'
  ) into has_from_user_id;

  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='inbox_items' and column_name='type'
  ) into has_type;

  select exists (
    select 1 from information_schema.columns
    where table_schema='public' and table_name='inbox_items' and column_name='acted_at'
  ) into has_acted_at;

  -- Lock the inbox item
  select *
  into v_item
  from public.inbox_items
  where id = p_inbox_item_id
  for update;

  if not found then
    raise exception 'Inbox item not found';
  end if;

  -- Only the intended recipient can accept
  if v_item.to_user_id <> auth.uid() then
    raise exception 'Not authorized to accept this transfer';
  end if;

  -- Only process pending transfers
  if v_item.status <> 'pending' then
    return;
  end if;

  -- Move ownership of the asset
  update public.assets
  set owner_id = v_item.to_user_id,
      status   = 'active'
  where id = v_item.asset_id;

  -- Mark recipient inbox item accepted
  if has_acted_at then
    update public.inbox_items
    set status   = 'accepted',
        acted_at = now()
    where id = p_inbox_item_id;
  else
    update public.inbox_items
    set status = 'accepted'
    where id = p_inbox_item_id;
  end if;

  /*
    Mark the sender-side "receipt" row as accepted, IF we can find it.

    Best match rules:
    - same asset_id
    - pending
    - addressed to the sender (to_user_id = from_user_id of the recipient item) IF from_user_id exists
    - optionally filtered by type='asset_transfer_sent' if type exists
  */

  if has_from_user_id and v_item.from_user_id is not null then
    if has_type then
      if has_acted_at then
        execute $q$
          update public.inbox_items
          set status = 'accepted', acted_at = now()
          where asset_id = $1
            and to_user_id = $2
            and status = 'pending'
            and type in ('asset_transfer_sent','asset_transfer_out','transfer_sent')
        $q$ using v_item.asset_id, v_item.from_user_id;
      else
        execute $q$
          update public.inbox_items
          set status = 'accepted'
          where asset_id = $1
            and to_user_id = $2
            and status = 'pending'
            and type in ('asset_transfer_sent','asset_transfer_out','transfer_sent')
        $q$ using v_item.asset_id, v_item.from_user_id;
      end if;
    else
      -- no type column: still update any pending "sender receipt" items we can safely identify
      if has_acted_at then
        execute $q$
          update public.inbox_items
          set status = 'accepted', acted_at = now()
          where asset_id = $1
            and to_user_id = $2
            and status = 'pending'
        $q$ using v_item.asset_id, v_item.from_user_id;
      else
        execute $q$
          update public.inbox_items
          set status = 'accepted'
          where asset_id = $1
            and to_user_id = $2
            and status = 'pending'
        $q$ using v_item.asset_id, v_item.from_user_id;
      end if;
    end if;
  end if;

end;
$_$;


ALTER FUNCTION "public"."accept_asset_transfer_simple"("p_inbox_item_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_org_creator_as_owner"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
begin
  insert into public.org_members (org_id, user_id, role)
  values (new.id, new.owner_user_id, 'owner')
  on conflict (org_id, user_id) do nothing;

  return new;
end;
$$;


ALTER FUNCTION "public"."add_org_creator_as_owner"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."add_org_member_by_email"("p_org_id" "uuid", "p_email" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_user_id uuid;
  v_is_owner boolean;
begin
  -- only org owner can add (v1)
  select (o.owner_user_id = auth.uid())
    into v_is_owner
  from public.orgs o
  where o.id = p_org_id;

  if v_is_owner is distinct from true then
    raise exception 'Not authorized';
  end if;

  select id into v_user_id
  from public.profiles
  where lower(email) = lower(trim(p_email))
  limit 1;

  if v_user_id is null then
    raise exception 'No user found for that email';
  end if;

  insert into public.org_members (org_id, user_id, member_role)
  values (p_org_id, v_user_id, 'member')
  on conflict (org_id, user_id) do nothing;
end;
$$;


ALTER FUNCTION "public"."add_org_member_by_email"("p_org_id" "uuid", "p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_action_proposal"("p_proposal_id" "uuid", "p_decided_by" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_prop public.action_proposals%rowtype;
  v_allowed boolean;
  v_applied_count integer := 0;
  v_now timestamptz := now();
  v_result jsonb;
begin
  select * into v_prop
  from public.action_proposals
  where id = p_proposal_id
  for update;

  if not found then
    raise exception 'Proposal not found: %', p_proposal_id;
  end if;

  if v_prop.status <> 'pending' then
    raise exception 'Proposal not pending (status=%)', v_prop.status;
  end if;

  select exists (
    select 1
    from public.object_type_actions ota
    join public.object_types ot on ot.key = ota.object_type_key
    join public.action_types at on at.key = ota.action_type_key
    where ota.object_type_key = v_prop.object_type_key
      and ota.action_type_key = v_prop.action_type_key
      and ota.enabled = true
      and ot.enabled = true
      and at.enabled = true
  ) into v_allowed;

  if not v_allowed then
    raise exception 'Object type % is not allowed to perform action %',
      v_prop.object_type_key, v_prop.action_type_key;
  end if;

  if v_prop.action_type_key = 'create_timeline_events' then
    /*
      Expected payload:
      { "records": [ { performed_at, odometer, title, notes, service_type, category, location, dedupe_key, raw } ] }
    */
    insert into public.service_records (
      asset_id,
      title,
      notes,
      service_type,
      category,
      performed_at,
      location,
      odometer,
      cost,
      system_id,
      keepr_pro_id,
      source_type,
      source_document_id,
      verification_status,
      extra_metadata,
      ai_metadata,
      record_scope,
      dedupe_key,
      created_at
    )
    select
      v_prop.asset_id,
      nullif(r->>'title',''),
      nullif(r->>'notes',''),
      nullif(r->>'service_type',''),
      coalesce(nullif(r->>'category',''), 'history'),
      (r->>'performed_at')::date,
      nullif(r->>'location',''),
      nullif(r->>'odometer','')::int,
      null, -- cost unknown from CARFAX
      null, -- system_id not assigned in v1
      null, -- keepr_pro_id not assigned
      'carfax', -- source_type
      null, -- source_document_id (you can wire to service_record_documents later if you want)
      'verified', -- CARFAX rows are "reported"; treat as verified history records (or use 'pending' if you prefer)
      coalesce(r->'raw','{}'::jsonb), -- stash raw event details
      '{}'::jsonb,
      'historical',
      nullif(r->>'dedupe_key',''),
      v_now
    from jsonb_array_elements(coalesce(v_prop.payload->'records','[]'::jsonb)) r
    on conflict (asset_id, dedupe_key) do nothing;

    get diagnostics v_applied_count = row_count;

  elsif v_prop.action_type_key = 'create_ownership_bands' then
    -- unchanged from earlier (ownership_bands table)
    insert into public.ownership_bands (
      asset_id, label, band_start, band_end,
      source_type, source_ref_id, attachment_id,
      scope, confidence, is_locked, dedupe_key,
      created_at, updated_at
    )
    select
      v_prop.asset_id,
      coalesce(b->>'label','(ownership)'),
      nullif(b->>'band_start','')::date,
      nullif(b->>'band_end','')::date,
      'carfax',
      v_prop.enrichment_run_id,
      v_prop.attachment_id,
      v_prop.scope,
      v_prop.confidence,
      true,
      nullif(b->>'dedupe_key',''),
      v_now, v_now
    from jsonb_array_elements(coalesce(v_prop.payload->'bands','[]'::jsonb)) b
    on conflict (asset_id, dedupe_key) do nothing;

    get diagnostics v_applied_count = row_count;

  elsif v_prop.action_type_key = 'anchor_odometer' then
    -- unchanged from earlier (odometer_anchors table)
    insert into public.odometer_anchors (
      asset_id, reading_date, odometer,
      source_type, source_ref_id, attachment_id,
      scope, confidence, is_locked, dedupe_key,
      created_at, updated_at
    )
    select
      v_prop.asset_id,
      nullif(a->>'reading_date','')::date,
      (a->>'odometer')::int,
      'carfax',
      v_prop.enrichment_run_id,
      v_prop.attachment_id,
      v_prop.scope,
      v_prop.confidence,
      true,
      nullif(a->>'dedupe_key',''),
      v_now, v_now
    from jsonb_array_elements(coalesce(v_prop.payload->'anchors','[]'::jsonb)) a
    on conflict (asset_id, dedupe_key) do nothing;

    get diagnostics v_applied_count = row_count;

  else
    raise exception 'Unsupported action_type_key in v1 executor: %', v_prop.action_type_key;
  end if;

  update public.action_proposals
  set status = 'accepted',
      decided_at = v_now,
      decided_by = p_decided_by,
      updated_at = v_now
  where id = v_prop.id;

  v_result := jsonb_build_object(
    'proposal_id', v_prop.id,
    'action_type_key', v_prop.action_type_key,
    'applied_count', v_applied_count,
    'status', 'accepted'
  );

  return v_result;
end;
$$;


ALTER FUNCTION "public"."apply_action_proposal"("p_proposal_id" "uuid", "p_decided_by" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_action_proposal_v1_plus"("p_proposal_id" "uuid", "p_decided_by" "uuid" DEFAULT "auth"."uid"()) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_prop public.action_proposals%rowtype;
  v_allowed boolean;
  v_applied_count integer := 0;
  v_now timestamptz := now();
  v_result jsonb;

  v_new_record_id uuid;
begin
  select * into v_prop
  from public.action_proposals
  where id = p_proposal_id
  for update;

  if not found then
    raise exception 'Proposal not found: %', p_proposal_id;
  end if;

  if v_prop.status <> 'pending' then
    raise exception 'Proposal not pending (status=%)', v_prop.status;
  end if;

  -- governance check
  select exists (
    select 1
    from public.object_type_actions ota
    join public.object_types ot on ot.key = ota.object_type_key
    join public.action_types at on at.key = ota.action_type_key
    where ota.object_type_key = v_prop.object_type_key
      and ota.action_type_key = v_prop.action_type_key
      and ota.enabled = true
      and ot.enabled = true
      and at.enabled = true
  ) into v_allowed;

  if not v_allowed then
    raise exception 'Object type % is not allowed to perform action %',
      v_prop.object_type_key, v_prop.action_type_key;
  end if;

  ---------------------------------------------------------------------------
  -- NEW: create_service_record
  -- payload example:
  -- {
  --   "record": { "title": "...", "notes": "...", "performed_at":"2026-01-21",
  --               "service_type":"marina_service", "category":"maintenance",
  --               "location": "...", "odometer": null, "cost": 1716.91,
  --               "dedupe_key":"..." },
  --   "attach_proof": true,
  --   "placement": { "role":"proof", "label":"source" }
  -- }
  ---------------------------------------------------------------------------
  if v_prop.action_type_key = 'create_service_record' then
    insert into public.service_records (
      asset_id,
      title,
      notes,
      service_type,
      category,
      performed_at,
      location,
      odometer,
      cost,
      system_id,
      keepr_pro_id,
      source_type,
      source_document_id,
      verification_status,
      extra_metadata,
      ai_metadata,
      record_scope,
      dedupe_key,
      created_at
    )
    values (
      v_prop.asset_id,
      nullif(v_prop.payload#>>'{record,title}',''),
      nullif(v_prop.payload#>>'{record,notes}',''),
      nullif(v_prop.payload#>>'{record,service_type}',''),
      nullif(v_prop.payload#>>'{record,category}',''),
      coalesce(nullif(v_prop.payload#>>'{record,performed_at}','')::date, current_date),
      nullif(v_prop.payload#>>'{record,location}',''),
      nullif(v_prop.payload#>>'{record,odometer}','')::int,
      nullif(v_prop.payload#>>'{record,cost}','')::numeric,
      null, -- system_id optional later
      null, -- keepr_pro_id optional later
      coalesce(nullif(v_prop.payload#>>'{record,source_type}',''), 'manual'),
      null, -- service_record_documents not used here
      'verified',
      jsonb_build_object(
        'action_proposal_id', v_prop.id,
        'attachment_id', v_prop.attachment_id,
        'enrichment_run_id', v_prop.enrichment_run_id
      ),
      jsonb_build_object(
        'proposal', v_prop.payload,
        'object_type_key', v_prop.object_type_key,
        'action_type_key', v_prop.action_type_key
      ),
      'current',
      nullif(v_prop.payload#>>'{record,dedupe_key}',''),
      v_now
    )
    returning id into v_new_record_id;

    v_applied_count := 1;

    -- optionally attach proof if attachment_id exists
    if (coalesce((v_prop.payload->>'attach_proof')::boolean, true) = true)
       and v_prop.attachment_id is not null
       and v_new_record_id is not null then
      insert into public.attachment_placements (
        attachment_id, target_type, target_id, role, label, created_at
      )
      values (
        v_prop.attachment_id,
        'service_record',
        v_new_record_id,
        coalesce(nullif(v_prop.payload#>>'{placement,role}',''), 'proof'),
        nullif(v_prop.payload#>>'{placement,label}',''),
        v_now
      )
      on conflict do nothing;
    end if;

  ---------------------------------------------------------------------------
  -- NEW: attach_proof_to_record
  -- payload example:
  -- { "record_id":"<uuid>", "role":"proof", "label":"source" }
  ---------------------------------------------------------------------------
  elsif v_prop.action_type_key = 'attach_proof_to_record' then
    if v_prop.attachment_id is null then
      raise exception 'attach_proof_to_record requires attachment_id on proposal';
    end if;

    if nullif(v_prop.payload->>'record_id','') is null then
      raise exception 'attach_proof_to_record requires payload.record_id';
    end if;

    insert into public.attachment_placements (
      attachment_id, target_type, target_id, role, label, created_at
    )
    values (
      v_prop.attachment_id,
      'service_record',
      (v_prop.payload->>'record_id')::uuid,
      coalesce(nullif(v_prop.payload->>'role',''), 'proof'),
      nullif(v_prop.payload->>'label',''),
      v_now
    )
    on conflict do nothing;

    v_applied_count := 1;

  ---------------------------------------------------------------------------
  -- NEW: capture_event_inbox
  -- payload example:
  -- { "title":"...", "notes":"...", "occurred_at":"2026-01-21", "amount_cents":1234,
  --   "asset_id":"...", "system_id":"...", "context":{...} }
  ---------------------------------------------------------------------------
  elsif v_prop.action_type_key = 'capture_event_inbox' then
    insert into public.event_inbox (
      owner_id,
      status,
      occurred_at,
      title,
      notes,
      amount_cents,
      currency,
      asset_id,
      system_id,
      keepr_pro_id,
      context,
      created_at
    )
    values (
      coalesce(v_prop.decided_by, auth.uid(), p_decided_by), -- safest fallback
      'draft',
      nullif(v_prop.payload->>'occurred_at','')::date,
      nullif(v_prop.payload->>'title',''),
      nullif(v_prop.payload->>'notes',''),
      nullif(v_prop.payload->>'amount_cents','')::int,
      coalesce(nullif(v_prop.payload->>'currency',''), 'USD'),
      nullif(v_prop.payload->>'asset_id','')::uuid,
      nullif(v_prop.payload->>'system_id','')::uuid,
      null, -- keepr_pro optional later
      coalesce(v_prop.payload->'context','{}'::jsonb),
      v_now
    );

    v_applied_count := 1;

  ---------------------------------------------------------------------------
  -- NEW: create_reminder
  -- payload example:
  -- { "title":"...", "notes":"...", "due_at":"2026-01-21T12:00:00Z", "has_time":true,
  --   "asset_id":"...", "system_id":"...", "record_id":"..." }
  ---------------------------------------------------------------------------
  elsif v_prop.action_type_key = 'create_reminder' then
    insert into public.reminders (
      owner_id,
      title,
      notes,
      due_at,
      has_time,
      status,
      asset_id,
      system_id,
      record_id,
      extra_metadata,
      created_at,
      updated_at
    )
    values (
      coalesce(v_prop.decided_by, auth.uid(), p_decided_by),
      coalesce(nullif(v_prop.payload->>'title',''), 'Reminder'),
      nullif(v_prop.payload->>'notes',''),
      (v_prop.payload->>'due_at')::timestamptz,
      coalesce((v_prop.payload->>'has_time')::boolean, true),
      'open',
      nullif(v_prop.payload->>'asset_id','')::uuid,
      nullif(v_prop.payload->>'system_id','')::uuid,
      nullif(v_prop.payload->>'record_id','')::uuid,
      coalesce(v_prop.payload->'extra_metadata','{}'::jsonb),
      v_now,
      v_now
    );

    v_applied_count := 1;

  ---------------------------------------------------------------------------
  -- “accepted but not executed” (V1 demo safe)
  ---------------------------------------------------------------------------
  elsif v_prop.action_type_key in ('answer_question','request_access') then
    v_applied_count := 0;

  else
    raise exception 'Unsupported action_type_key in v1+ executor: %', v_prop.action_type_key;
  end if;

  update public.action_proposals
  set status = 'accepted',
      decided_at = v_now,
      decided_by = p_decided_by,
      updated_at = v_now
  where id = v_prop.id;

  v_result := jsonb_build_object(
    'proposal_id', v_prop.id,
    'action_type_key', v_prop.action_type_key,
    'applied_count', v_applied_count,
    'status', 'accepted'
  );

  if v_new_record_id is not null then
    v_result := v_result || jsonb_build_object('created_record_id', v_new_record_id);
  end if;

  return v_result;
end;
$$;


ALTER FUNCTION "public"."apply_action_proposal_v1_plus"("p_proposal_id" "uuid", "p_decided_by" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."apply_enrichment_run"("p_run_id" "uuid", "p_decided_by" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_prop_id uuid;
  v_results jsonb := '[]'::jsonb;
  v_one jsonb;
begin
  for v_prop_id in
    select id
    from public.action_proposals
    where enrichment_run_id = p_run_id
      and status = 'pending'
    order by created_at asc
  loop
    v_one := public.apply_action_proposal(v_prop_id, p_decided_by);
    v_results := v_results || jsonb_build_array(v_one);
  end loop;

  return jsonb_build_object(
    'enrichment_run_id', p_run_id,
    'results', v_results
  );
end;
$$;


ALTER FUNCTION "public"."apply_enrichment_run"("p_run_id" "uuid", "p_decided_by" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."can_create_asset"() RETURNS boolean
    LANGUAGE "plpgsql" STABLE
    AS $$
declare
  tier text;
  bstatus text;
  limit_assets int;
  current_assets int;
begin
  select p.plan, p.billing_status
    into tier, bstatus
  from public.profiles p
  where p.id = auth.uid();

  if tier is null then
    tier := 'free';
    bstatus := 'inactive';
  end if;

  if tier in ('plus','team') and bstatus <> 'active' then
    return false;
  end if;

  limit_assets := (public.plan_limits(tier)->>'assets')::int;
  current_assets := public.user_asset_count(auth.uid());

  return current_assets < limit_assets;
end;
$$;


ALTER FUNCTION "public"."can_create_asset"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_inbox_items_for_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
begin
  update public.inbox_items
    set to_user_id = new.id
  where to_user_id is null
    and to_email is not null
    and lower(to_email) = lower(new.email);

  return new;
end;
$$;


ALTER FUNCTION "public"."claim_inbox_items_for_new_user"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."event_inbox" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "occurred_at" "date",
    "title" "text",
    "notes" "text",
    "amount_cents" integer,
    "currency" "text" DEFAULT 'USD'::"text" NOT NULL,
    "asset_id" "uuid",
    "system_id" "uuid",
    "keepr_pro_id" "uuid",
    "context" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "home_system_id" "uuid",
    "message_id" "text",
    "origin_type" "text",
    "source_type" "text",
    CONSTRAINT "origin_type_lower" CHECK (("origin_type" = "lower"("origin_type"))),
    CONSTRAINT "source_type_lower" CHECK (("source_type" = "lower"("source_type")))
);


ALTER TABLE "public"."event_inbox" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_event_inbox_from_mode"("p_title" "text", "p_notes" "text" DEFAULT NULL::"text", "p_occurred_at" "date" DEFAULT NULL::"date", "p_amount_cents" integer DEFAULT NULL::integer, "p_currency" "text" DEFAULT 'USD'::"text", "p_asset_id" "uuid" DEFAULT NULL::"uuid", "p_system_id" "uuid" DEFAULT NULL::"uuid", "p_home_system_id" "uuid" DEFAULT NULL::"uuid", "p_keepr_pro_id" "uuid" DEFAULT NULL::"uuid", "p_context" "jsonb" DEFAULT NULL::"jsonb") RETURNS "public"."event_inbox"
    LANGUAGE "plpgsql"
    AS $$
declare
  v_row public.event_inbox;
begin
  insert into public.event_inbox (
    owner_id,
    status,
    occurred_at,
    title,
    notes,
    amount_cents,
    currency,
    asset_id,
    system_id,
    home_system_id,
    keepr_pro_id,
    context
  )
  values (
    auth.uid(),
    'draft',
    p_occurred_at,
    p_title,
    p_notes,
    p_amount_cents,
    coalesce(p_currency, 'USD'),
    p_asset_id,
    p_system_id,
    p_home_system_id,
    p_keepr_pro_id,
    p_context
  )
  returning * into v_row;

  return v_row;
end;
$$;


ALTER FUNCTION "public"."create_event_inbox_from_mode"("p_title" "text", "p_notes" "text", "p_occurred_at" "date", "p_amount_cents" integer, "p_currency" "text", "p_asset_id" "uuid", "p_system_id" "uuid", "p_home_system_id" "uuid", "p_keepr_pro_id" "uuid", "p_context" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_inbox_item_by_email"("p_to_email" "text", "p_type" "text", "p_payload" "jsonb") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
declare
  v_to_user_id uuid;
  v_id uuid;
begin
  -- Try to resolve recipient if they already exist (no public lookup needed)
  select u.id into v_to_user_id
  from auth.users u
  where lower(u.email) = lower(p_to_email)
  limit 1;

  insert into public.inbox_items (
    to_user_id,
    to_email,
    from_user_id,
    type,
    payload
  )
  values (
    v_to_user_id,
    lower(p_to_email),
    auth.uid(),
    p_type,
    coalesce(p_payload, '{}'::jsonb)
  )
  returning id into v_id;

  return v_id;
end;
$$;


ALTER FUNCTION "public"."create_inbox_item_by_email"("p_to_email" "text", "p_type" "text", "p_payload" "jsonb") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."master_assets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "kac" "text" NOT NULL,
    "asset_type" "text" NOT NULL,
    "manufacturer" "text",
    "model" "text",
    "model_year" integer,
    "vin" "text",
    "hin" "text",
    "serial_number" "text",
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "last_seen_at" timestamp with time zone
);


ALTER TABLE "public"."master_assets" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_master_asset_for_user"("p_asset_type" "text", "p_manufacturer" "text" DEFAULT NULL::"text", "p_model" "text" DEFAULT NULL::"text", "p_model_year" integer DEFAULT NULL::integer, "p_vin" "text" DEFAULT NULL::"text", "p_hin" "text" DEFAULT NULL::"text", "p_serial" "text" DEFAULT NULL::"text") RETURNS "public"."master_assets"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
declare
  v_asset public.master_assets;
  v_kac text;
  v_try int := 0;
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  -- generate unique KAC (retry a few times on collision)
  loop
    v_try := v_try + 1;
    v_kac := public.generate_kac();
    exit when not exists (select 1 from public.master_assets where kac = v_kac) or v_try > 10;
  end loop;

  if exists (select 1 from public.master_assets where kac = v_kac) then
    raise exception 'Could not generate unique KAC';
  end if;

  insert into public.master_assets (kac, asset_type, manufacturer, model, model_year, vin, hin, serial_number)
  values (v_kac, p_asset_type, p_manufacturer, p_model, p_model_year, p_vin, p_hin, p_serial)
  returning * into v_asset;

  insert into public.asset_stewards (master_asset_id, user_id, role)
  values (v_asset.id, auth.uid(), 'owner');

  insert into public.asset_engagement_events (master_asset_id, actor_type, actor_user_id, channel, action, context)
  values (v_asset.id, 'owner', auth.uid(), 'app', 'create', jsonb_build_object('asset_type', p_asset_type));

  return v_asset;
end;
$$;


ALTER FUNCTION "public"."create_master_asset_for_user"("p_asset_type" "text", "p_manufacturer" "text", "p_model" "text", "p_model_year" integer, "p_vin" "text", "p_hin" "text", "p_serial" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decline_asset_transfer"("p_inbox_item_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
begin
  update public.inbox_items
     set status = 'declined'
   where id = p_inbox_item_id;
end;
$$;


ALTER FUNCTION "public"."decline_asset_transfer"("p_inbox_item_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."decline_asset_transfer"("p_inbox_item_id" "uuid", "p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
declare
  v_item record;
begin
  select *
  into v_item
  from inbox_items
  where id = p_inbox_item_id
    and type = 'asset_transfer';

  if not found then
    raise exception 'Transfer request not found';
  end if;

  if v_item.to_user_id is distinct from p_user_id then
    raise exception 'You are not the recipient of this transfer.';
  end if;

  update inbox_items
  set status = 'declined'
  where id = p_inbox_item_id;
end;
$$;


ALTER FUNCTION "public"."decline_asset_transfer"("p_inbox_item_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enforce_org_member_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  member_count int;
  owner_id uuid;
  owner_plan text;
begin
  -- Find org owner
  select o.owner_user_id into owner_id
  from public.orgs o
  where o.id = new.org_id;

  if owner_id is null then
    raise exception 'Org has no owner_user_id.';
  end if;

  -- Require Team plan for adding members
  select p.plan into owner_plan
  from public.profiles p
  where p.id = owner_id;

  if coalesce(owner_plan, 'free') <> 'team' then
    raise exception 'Team members require the Team plan.';
  end if;

  -- Enforce max 5 total members (including owner)
  select count(*) into member_count
  from public.org_members
  where org_id = new.org_id;

  if member_count >= 5 then
    raise exception 'Team member limit reached (5).';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."enforce_org_member_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_asset_attachment_placement"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  -- If not assigned to an asset (or soft-deleted), do nothing
  if new.asset_id is null or new.deleted_at is not null then
    return new;
  end if;

  -- Ensure an asset placement exists for this asset assignment
  insert into public.attachment_placements
    (attachment_id, target_type, target_id, role, sort_order, is_showcase)
  select
    new.id,
    'asset',
    new.asset_id,
    'primary',
    0,
    false
  where not exists (
    select 1
    from public.attachment_placements ap
    where ap.attachment_id = new.id
      and ap.target_type = 'asset'
      and ap.target_id = new.asset_id
  );

  return new;
end;
$$;


ALTER FUNCTION "public"."ensure_asset_attachment_placement"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_asset_owner_stewardship"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  if new.owner_id is null then
    return new;
  end if;

  insert into public.asset_stewardships (asset_id, user_id, access_role, active, starts_at)
  values (new.id, new.owner_id, 'steward', true, now())
  on conflict do nothing;

  return new;
end;
$$;


ALTER FUNCTION "public"."ensure_asset_owner_stewardship"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."find_user_id_by_email"("p_email" "text") RETURNS "uuid"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select id
  from public.profiles
  where lower(email) = lower(trim(p_email))
  limit 1;
$$;


ALTER FUNCTION "public"."find_user_id_by_email"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_kac"() RETURNS "text"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
declare
  alphabet text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; -- no 0O1I
  out1 text := '';
  out2 text := '';
  i int;
  idx int;
begin
  for i in 1..4 loop
    idx := 1 + floor(random() * length(alphabet))::int;
    out1 := out1 || substr(alphabet, idx, 1);
  end loop;

  for i in 1..4 loop
    idx := 1 + floor(random() * length(alphabet))::int;
    out2 := out2 || substr(alphabet, idx, 1);
  end loop;

  return 'KPR-' || out1 || '-' || out2;
end;
$$;


ALTER FUNCTION "public"."generate_kac"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_owner_systems_package"("p_asset_id" "uuid", "p_title" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_package_id uuid;
  v_row_count int;
  v_proof_total int;
  v_asset_name text;
begin
  select a.name into v_asset_name
  from public.assets a
  where a.id = p_asset_id;

  insert into public.packages (asset_id, package_type, title, status, generated_by, snapshot_meta)
  values (
    p_asset_id,
    'owner_systems',
    coalesce(p_title, 'Owner Systems Inventory'),
    'generating',
    auth.uid(),
    jsonb_build_object('asset_name', coalesce(v_asset_name, 'Asset'))
  )
  returning id into v_package_id;

  insert into public.package_rows (package_id, row_index, row)
  with
  s as (
    select
      sys.id as system_id,
      sys.name as system_name,
      coalesce(sys.system_type, sys.ksc_code, '') as system_type,
      coalesce(sys.metadata->'standard'->'identity'->>'location', '') as location,

      -- identity
      coalesce(
        sys.metadata->'standard'->'identity'->>'manufacturer',
        sys.metadata->'standard'->'identity'->>'brand',
        sys.metadata->'identity'->>'manufacturer',
        sys.metadata->'identity'->>'brand',
        ''
      ) as manufacturer,
      coalesce(
        sys.metadata->'standard'->'identity'->>'model',
        sys.metadata->'identity'->>'model',
        ''
      ) as model,
      coalesce(
        sys.metadata->'standard'->'identity'->>'serial_number',
        sys.metadata->'standard'->'identity'->>'serial',
        sys.metadata->'identity'->>'serial_number',
        sys.metadata->'identity'->>'serial',
        ''
      ) as serial_number,

      -- warranty
      coalesce(
        sys.metadata->'standard'->'warranty'->>'provider',
        sys.metadata->'warranty'->>'provider',
        ''
      ) as warranty_provider,
      coalesce(
        sys.metadata->'standard'->'warranty'->>'expires',
        sys.metadata->'standard'->'warranty'->>'expires_on',
        sys.metadata->'warranty'->>'expires',
        sys.metadata->'warranty'->>'expires_on',
        ''
      ) as warranty_expires,

      -- relationships / assignment ids (array of uuid strings)
      coalesce(
        sys.metadata->'standard'->'relationships'->'keepr_pro_ids',
        sys.metadata->'relationships'->'keepr_pro_ids',
        sys.metadata->'relationships'->'keeprProIds',
        '[]'::jsonb
      ) as keepr_pro_ids_json,

      -- notes/status from system
      coalesce(sys.status, 'ok') as status,
      coalesce(sys.metadata->>'notes', '') as notes

    from public.systems sys
    where sys.asset_id = p_asset_id
      and sys.lifecycle_status = 'active'
  ),
  svc as (
    select
      r.system_id,
      count(*)::int as service_count,
      max(r.performed_at)::date as last_service_date
    from public.service_records r
    where r.asset_id = p_asset_id
      and r.system_id is not null
    group by r.system_id
  ),
  proof_sys as (
    select
      ap.target_id as system_id,
      count(distinct ap.attachment_id)::int as proof_count
    from public.attachment_placements ap
    join public.attachments a
      on a.id = ap.attachment_id
     and a.deleted_at is null
    where ap.target_type = 'system'
    group by ap.target_id
  ),
  primary_assign as (
    select
      s.system_id,
      nullif((s.keepr_pro_ids_json->>0), '')::uuid as primary_keepr_pro_id
    from s
  )
  select
    v_package_id,
    row_number() over (order by lower(s.system_name)) - 1,
    jsonb_build_object(
      -- ✅ REQUIRED FOR EDITING/SAVING
      'system_id', s.system_id,
      'assigned_keepr_pro_id', pa.primary_keepr_pro_id,

      'system_name', s.system_name,
      'system_type', s.system_type,
      'location', s.location,
      'status', s.status,

      'manufacturer', s.manufacturer,
      'model', s.model,
      'serial_number', s.serial_number,

      'warranty_provider', s.warranty_provider,
      'warranty_expires', s.warranty_expires,

      'assigned_keepr_pro', coalesce(kp.name, ''),

      'last_service_date', coalesce(svc.last_service_date, null),
      'service_count', coalesce(svc.service_count, 0),
      'proof_count', coalesce(ps.proof_count, 0),

      'notes', s.notes
    )
  from s
  left join svc on svc.system_id = s.system_id
  left join proof_sys ps on ps.system_id = s.system_id
  left join primary_assign pa on pa.system_id = s.system_id
  left join public.keepr_pros kp on kp.id = pa.primary_keepr_pro_id;

  select
    count(*)::int,
    coalesce(sum((row->>'proof_count')::int), 0)::int
  into v_row_count, v_proof_total
  from public.package_rows
  where package_id = v_package_id;

  update public.packages
  set status = 'ready',
      totals = jsonb_build_object('row_count', v_row_count, 'proof_count', v_proof_total)
  where id = v_package_id;

  return v_package_id;

exception
  when others then
    update public.packages
    set status = 'error',
        totals = jsonb_build_object('error', sqlerrm)
    where id = v_package_id;
    raise;
end;
$$;


ALTER FUNCTION "public"."generate_owner_systems_package"("p_asset_id" "uuid", "p_title" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_system_readiness_package"("p_system_id" "uuid", "p_title" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_package_id uuid;
  v_asset_id uuid;
  v_asset_name text;
  v_system_name text;

  v_service_count int;
  v_last_service_date date;

  v_proof_total int;
  v_proof_photos int;
  v_proof_files int;
  v_proof_links int;

  v_has_identity boolean;
  v_has_warranty boolean;
  v_has_assigned_keepr_pro boolean;
begin
  -- system + asset
  select s.asset_id, s.name
    into v_asset_id, v_system_name
  from public.systems s
  where s.id = p_system_id;

  if v_asset_id is null then
    raise exception 'System not found: %', p_system_id;
  end if;

  select a.name into v_asset_name
  from public.assets a
  where a.id = v_asset_id;

  insert into public.packages (asset_id, package_type, title, status, generated_by, snapshot_meta)
  values (
    v_asset_id,
    'system_readiness',
    coalesce(p_title, 'System Readiness Report'),
    'generating',
    auth.uid(),
    jsonb_build_object(
      'asset_name', coalesce(v_asset_name, 'Asset'),
      'system_name', coalesce(v_system_name, 'System'),
      'system_id', p_system_id
    )
  )
  returning id into v_package_id;

  -- service rollup
  select
    count(*)::int,
    max(sr.performed_at)::date
  into v_service_count, v_last_service_date
  from public.service_records sr
  where sr.asset_id = v_asset_id
    and sr.system_id = p_system_id;

  -- proof rollup by kind
  select
    coalesce(count(*) filter (where a.kind = 'photo'), 0)::int,
    coalesce(count(*) filter (where a.kind = 'file'), 0)::int,
    coalesce(count(*) filter (where a.kind = 'link'), 0)::int,
    coalesce(count(*), 0)::int
  into v_proof_photos, v_proof_files, v_proof_links, v_proof_total
  from public.attachment_placements ap
  join public.attachments a
    on a.id = ap.attachment_id
   and a.deleted_at is null
  where ap.target_type = 'system'
    and ap.target_id = p_system_id;

  -- booleans for totals
  select
    (
      coalesce(nullif(trim(coalesce(s.metadata->'standard'->'identity'->>'manufacturer','')),''),'') <> ''
      or coalesce(nullif(trim(coalesce(s.metadata->'standard'->'identity'->>'model','')),''),'') <> ''
      or coalesce(nullif(trim(coalesce(s.metadata->'standard'->'identity'->>'serial_number','')),''),'') <> ''
      or coalesce(nullif(trim(coalesce(s.metadata->'standard'->'identity'->>'location','')),''),'') <> ''
    ) as has_identity,
    (
      coalesce(nullif(trim(coalesce(s.metadata->'standard'->'warranty'->>'provider','')),''),'') <> ''
      or coalesce(nullif(trim(coalesce(s.metadata->'standard'->'warranty'->>'policy_number','')),''),'') <> ''
      or coalesce(nullif(trim(coalesce(s.metadata->'standard'->'warranty'->>'starts_on','')),''),'') <> ''
      or coalesce(nullif(trim(coalesce(s.metadata->'standard'->'warranty'->>'expires_on','')),''),'') <> ''
      or jsonb_array_length(coalesce(s.metadata->'standard'->'warranty'->'attachment_ids','[]'::jsonb)) > 0
    ) as has_warranty,
    (
      jsonb_array_length(
        coalesce(
          s.metadata->'standard'->'relationships'->'keepr_pro_ids',
          s.metadata->'relationships'->'keepr_pro_ids',
          '[]'::jsonb
        )
      ) > 0
    ) as has_assigned
  into v_has_identity, v_has_warranty, v_has_assigned_keepr_pro
  from public.systems s
  where s.id = p_system_id;

  ---------------------------------------------------------------------------
  -- ROWS
  ---------------------------------------------------------------------------

  -- Summary
  insert into public.package_rows (package_id, row_index, row)
  values (
    v_package_id,
    0,
    jsonb_build_object(
      'section', 'summary',
      'asset_name', coalesce(v_asset_name,'Asset'),
      'system_id', p_system_id,
      'system_name', coalesce(v_system_name,'System'),
      'service_count', coalesce(v_service_count,0),
      'last_service_date', v_last_service_date,
      'proof_photos', coalesce(v_proof_photos,0),
      'proof_files', coalesce(v_proof_files,0),
      'proof_links', coalesce(v_proof_links,0),
      'proof_total', coalesce(v_proof_total,0),
      'has_identity', coalesce(v_has_identity,false),
      'has_warranty', coalesce(v_has_warranty,false),
      'has_assigned_keepr_pro', coalesce(v_has_assigned_keepr_pro,false)
    )
  );

  -- Identity (from metadata.standard.identity)
  insert into public.package_rows (package_id, row_index, row)
  select
    v_package_id,
    10,
    jsonb_build_object(
      'section','identity',
      'manufacturer', coalesce(s.metadata->'standard'->'identity'->>'manufacturer',''),
      'model',        coalesce(s.metadata->'standard'->'identity'->>'model',''),
      'serial_number',coalesce(s.metadata->'standard'->'identity'->>'serial_number',''),
      'location',     coalesce(s.metadata->'standard'->'identity'->>'location',''),
      'installed_on', coalesce(s.metadata->'standard'->'identity'->>'installed_on',''),
      'installed_by', coalesce(s.metadata->'standard'->'identity'->>'installed_by',''),
      'year',         coalesce(s.metadata->'standard'->'identity'->>'year',''),
      'notes',        coalesce(s.metadata->'standard'->'identity'->>'notes','')
    )
  from public.systems s
  where s.id = p_system_id;

  -- Warranty (from metadata.standard.warranty)
  insert into public.package_rows (package_id, row_index, row)
  select
    v_package_id,
    20,
    jsonb_build_object(
      'section','warranty',
      'provider',       coalesce(s.metadata->'standard'->'warranty'->>'provider',''),
      'policy_number',  coalesce(s.metadata->'standard'->'warranty'->>'policy_number',''),
      'starts_on',      coalesce(s.metadata->'standard'->'warranty'->>'starts_on',''),
      'expires_on',     coalesce(s.metadata->'standard'->'warranty'->>'expires_on',''),
      'coverage_notes', coalesce(s.metadata->'standard'->'warranty'->>'coverage_notes',''),
      'attachment_ids', coalesce(s.metadata->'standard'->'warranty'->'attachment_ids','[]'::jsonb),
      'attachment_count', jsonb_array_length(coalesce(s.metadata->'standard'->'warranty'->'attachment_ids','[]'::jsonb))
    )
  from public.systems s
  where s.id = p_system_id;

  -- Assignment (KeeprPro)
  insert into public.package_rows (package_id, row_index, row)
  with
  kp_id as (
    select
      nullif((
        coalesce(
          s.metadata->'standard'->'relationships'->'keepr_pro_ids',
          s.metadata->'relationships'->'keepr_pro_ids',
          '[]'::jsonb
        )->>0
      ), '')::uuid as keepr_pro_id
    from public.systems s
    where s.id = p_system_id
  )
  select
    v_package_id,
    30,
    jsonb_build_object(
      'section','assignment',
      'assigned_keepr_pro_id', kp.id,
      'assigned_keepr_pro_name', coalesce(kp.name,''),
      'phone', coalesce(kp.phone,''),
      'email', coalesce(kp.email,''),
      'website', coalesce(kp.website,''),
      'location', coalesce(kp.location,''),
      'category', coalesce(kp.category,'')
    )
  from kp_id x
  left join public.keepr_pros kp on kp.id = x.keepr_pro_id;

  -- Playbook (systems.playbook column)
  insert into public.package_rows (package_id, row_index, row)
  select
    v_package_id,
    40,
    jsonb_build_object(
      'section','playbook',
      'playbook', coalesce(s.playbook,'')
    )
  from public.systems s
  where s.id = p_system_id;

  -- Service detail rows (from service_records)
  insert into public.package_rows (package_id, row_index, row)
  select
    v_package_id,
    1000 + (row_number() over (order by sr.performed_at desc, sr.created_at desc) - 1),
    jsonb_build_object(
      'section','service',
      'service_record_id', sr.id,
      'performed_at', sr.performed_at,
      'title', coalesce(sr.title,''),
      'service_type', coalesce(sr.service_type,''),
      'category', coalesce(sr.category,''),
      'keepr_pro_id', sr.keepr_pro_id,
      'cost', sr.cost,
      'location', coalesce(sr.location,''),
      'notes', coalesce(sr.notes,''),
      'verification_status', coalesce(sr.verification_status,'')
    )
  from public.service_records sr
  where sr.asset_id = v_asset_id
    and sr.system_id = p_system_id;

  -- Proof summary row
  insert into public.package_rows (package_id, row_index, row)
  values (
    v_package_id,
    50,
    jsonb_build_object(
      'section','proof',
      'photos', coalesce(v_proof_photos,0),
      'files',  coalesce(v_proof_files,0),
      'links',  coalesce(v_proof_links,0),
      'total',  coalesce(v_proof_total,0)
    )
  );

  update public.packages
  set status = 'ready',
      generated_at = now(),
      totals = jsonb_build_object(
        'service_count', coalesce(v_service_count,0),
        'proof_total', coalesce(v_proof_total,0),
        'has_identity', coalesce(v_has_identity,false),
        'has_warranty', coalesce(v_has_warranty,false),
        'has_assigned_keepr_pro', coalesce(v_has_assigned_keepr_pro,false)
      )
  where id = v_package_id;

  return v_package_id;

exception
  when others then
    update public.packages
    set status = 'error',
        generated_at = now(),
        totals = jsonb_build_object('error', sqlerrm)
    where id = v_package_id;
    raise;
end;
$$;


ALTER FUNCTION "public"."generate_system_readiness_package"("p_system_id" "uuid", "p_title" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_timeline_cost_package"("p_asset_id" "uuid", "p_title" "text" DEFAULT NULL::"text") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_package_id uuid;
  v_asset_name text;
  v_total numeric;
  v_years int;
begin
  select a.name into v_asset_name
  from public.assets a
  where a.id = p_asset_id;

  insert into public.packages (asset_id, package_type, title, status, generated_by, snapshot_meta)
  values (
    p_asset_id,
    'timeline_cost',
    coalesce(p_title, 'Timeline Cost Report'),
    'generating',
    auth.uid(),
    jsonb_build_object('asset_name', coalesce(v_asset_name, 'Asset'))
  )
  returning id into v_package_id;

  -- Year rollup first
  insert into public.package_rows (package_id, row_index, row)
  select
    v_package_id,
    row_number() over () - 1,
    jsonb_build_object(
      'section', 'year_rollup',
      'year', year,
      'total_cost', total_cost,
      'record_count', record_count,
      'proof_items', proof_items
    )
  from public.timeline_cost_year_rollup_rows(p_asset_id);

  -- Detail rows after (stable offset)
  insert into public.package_rows (package_id, row_index, row)
  select
    v_package_id,
    100000 + (row_number() over () - 1),
    jsonb_build_object(
      'section', 'detail',
      'performed_at', performed_at,
      'title', title,
      'system_name', system_name,
      'category', category,
      'keepr_pro_name', keepr_pro_name,
      'cost', cost,
      'proof_count', proof_count
    )
  from public.timeline_cost_detail_rows(p_asset_id);

  select
    coalesce(sum((row->>'total_cost')::numeric),0),
    count(*)::int
  into v_total, v_years
  from public.package_rows
  where package_id = v_package_id
    and (row->>'section') = 'year_rollup';

  update public.packages
  set status = 'ready',
      totals = jsonb_build_object('years', v_years, 'total_cost', v_total)
  where id = v_package_id;

  return v_package_id;

exception
  when others then
    update public.packages
    set status = 'error',
        totals = jsonb_build_object('error', sqlerrm)
    where id = v_package_id;
    raise;
end;
$$;


ALTER FUNCTION "public"."generate_timeline_cost_package"("p_asset_id" "uuid", "p_title" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_asset_keepr_progress"("p_asset_id" "uuid") RETURNS TABLE("asset" boolean, "system" boolean, "record" boolean, "proof" boolean, "complete" boolean, "next_step_label" "text")
    LANGUAGE "sql" STABLE
    AS $$
with counts as (
  select
    (select count(*) from systems where asset_id = p_asset_id) as system_count,
    (select count(*) from service_records where asset_id = p_asset_id) as record_count,
    (select count(*) from attachments where asset_id = p_asset_id) as proof_count
)
select
  true,
  system_count > 0,
  record_count > 0,
  proof_count > 0,
  (system_count > 0 and record_count > 0 and proof_count > 0),
  case
    when system_count = 0 then 'Add System'
    when record_count = 0 then 'Add Record'
    when proof_count = 0 then 'Add Proof'
    else null
  end
from counts;
$$;


ALTER FUNCTION "public"."get_asset_keepr_progress"("p_asset_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_dashboard_hero_attachments"("placement_ids" "uuid"[]) RETURNS TABLE("placement_id" "uuid", "bucket" "text", "storage_path" "text", "url" "text", "deleted_at" timestamp with time zone)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    ap.id as placement_id,
    a.bucket,
    a.storage_path,
    a.url,
    a.deleted_at
  from attachment_placements ap
  join attachments a on a.id = ap.attachment_id
  where ap.id = any(placement_ids)
    and a.deleted_at is null
    and (
      a.owner_user_id = auth.uid()
      or exists (
        select 1
        from assets asset
        where asset.id = a.asset_id
          and asset.owner_id = auth.uid()
      )
    );
$$;


ALTER FUNCTION "public"."get_dashboard_hero_attachments"("placement_ids" "uuid"[]) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_hub_members_for_view"("p_hub_id" "uuid") RETURNS TABLE("id" "uuid", "hub_id" "uuid", "user_id" "uuid", "role" "text", "email" "text", "status" "text", "display_name" "text", "avatar_url" "text", "created_at" timestamp with time zone)
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    hm.id,
    hm.hub_id,
    hm.user_id,
    hm.role,
    hm.email,
    hm.status,
    coalesce(
      hm.display_name,
      p.display_name,
      p.full_name,
      p.inbox_name,
      p.username,
      p.email,
      hm.email
    ) as display_name,
    coalesce(hm.avatar_url, p.profile_photo_url) as avatar_url,
    hm.created_at
  from hub_members hm
  left join profiles p on p.id = hm.user_id
  where hm.hub_id = p_hub_id
    and hm.status = 'active'
    and exists (
      select 1
      from hub_members mine
      where mine.hub_id = p_hub_id
        and mine.user_id = auth.uid()
        and mine.status = 'active'
    )
  order by hm.created_at;
$$;


ALTER FUNCTION "public"."get_hub_members_for_view"("p_hub_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_hub_stories_for_view"("p_hub_id" "uuid") RETURNS TABLE("id" "uuid", "featured" boolean, "status" "text", "created_by" "uuid", "created_at" timestamp with time zone, "asset" "jsonb", "owner_profile" "jsonb")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    hsl.id,
    hsl.featured,
    hsl.status,
    hsl.created_by,
    hsl.created_at,
    jsonb_build_object(
      'id', a.id,
      'owner_id', a.owner_id,
      'name', a.name,
      'type', a.type,
      'asset_subtype', a.asset_subtype,
      'location', a.location,
      'year', a.year,
      'make', a.make,
      'model', a.model,
      'hero_image_url', a.hero_image_url,
      'hero_thumb_url', a.hero_thumb_url,
      'hero_placement_id', a.hero_placement_id,
      'kac_id', a.kac_id,
      'created_at', a.created_at
    ) as asset,
    jsonb_build_object(
      'id', p.id,
      'display_name', coalesce(p.display_name, p.full_name, p.inbox_name, p.username, p.email),
      'full_name', p.full_name,
      'email', p.email,
      'username', p.username,
      'inbox_name', p.inbox_name
    ) as owner_profile
  from hub_story_links hsl
  join hubs h on h.id = hsl.hub_id
  join assets a on a.id = hsl.asset_id
  left join profiles p on p.id = a.owner_id
  where hsl.hub_id = p_hub_id
    and hsl.status = 'approved'
    and (
      h.visibility = 'public'
      or exists (
        select 1
        from hub_members hm
        where hm.hub_id = hsl.hub_id
          and hm.user_id = auth.uid()
          and hm.status = 'active'
      )
    )
  order by hsl.featured desc, hsl.created_at desc;
$$;


ALTER FUNCTION "public"."get_hub_stories_for_view"("p_hub_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_hub_story_asset_owner"("p_asset_id" "uuid", "p_hub_id" "uuid") RETURNS TABLE("asset_id" "uuid", "owner_id" "uuid", "name" "text")
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select
    a.id as asset_id,
    a.owner_id,
    a.name
  from public.assets a
  join public.hub_story_links hsl
    on hsl.asset_id = a.id
  join public.hub_members hm
    on hm.hub_id = hsl.hub_id
  where a.id = p_asset_id
    and hsl.hub_id = p_hub_id
    and hm.user_id = auth.uid()
    and hm.status = 'active'
  limit 1;
$$;


ALTER FUNCTION "public"."get_hub_story_asset_owner"("p_asset_id" "uuid", "p_hub_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_achievements"() RETURNS TABLE("user_id" "uuid", "asset_count" bigint, "system_count" bigint, "service_record_count" bigint, "service_records_30d" bigint, "attachment_count" bigint, "attachment_mb" numeric, "last_activity_at" timestamp with time zone)
    LANGUAGE "sql" STABLE
    AS $$
with me as (select auth.uid() as user_id)

select
  me.user_id,

  -- assets
  (select count(*)
   from public.assets a
   where a.owner_id = me.user_id
     and a.deleted_at is null) as asset_count,

  -- systems
  (select count(*)
   from public.systems s
   join public.assets a on a.id = s.asset_id
   where a.owner_id = me.user_id
     and a.deleted_at is null) as system_count,

  -- service records
  (select count(*)
   from public.service_records sr
   join public.assets a on a.id = sr.asset_id
   where a.owner_id = me.user_id
     and a.deleted_at is null) as service_record_count,

  -- last 30 days
  (select count(*)
   from public.service_records sr
   join public.assets a on a.id = sr.asset_id
   where a.owner_id = me.user_id
     and a.deleted_at is null
     and sr.created_at >= (now() - interval '30 days')) as service_records_30d,

  -- attachment count (ONLY active assets)
  (select count(*)
   from (
     select distinct att.id
     from public.attachments att
     join public.attachment_placements ap
       on ap.attachment_id = att.id
     join public.assets a
       on a.id = ap.target_id
     where a.owner_id = me.user_id
       and a.deleted_at is null
       and ap.target_type = 'asset'
       and att.deleted_at is null
   ) x) as attachment_count,

  -- attachment MB (ONLY active assets)
  (select round(coalesce(sum(x.size_bytes), 0) / 1024.0 / 1024.0, 2)
   from (
     select distinct
       att.id,
       coalesce(att.size_bytes, 0) as size_bytes
     from public.attachments att
     join public.attachment_placements ap
       on ap.attachment_id = att.id
     join public.assets a
       on a.id = ap.target_id
     where a.owner_id = me.user_id
       and a.deleted_at is null
       and ap.target_type = 'asset'
       and att.deleted_at is null
   ) x) as attachment_mb,

  -- last activity
  greatest(
    coalesce((select max(a.created_at)
              from public.assets a
              where a.owner_id = me.user_id
                and a.deleted_at is null), 'epoch'::timestamptz),
    coalesce((select max(sr.created_at)
              from public.service_records sr
              join public.assets a on a.id = sr.asset_id
              where a.owner_id = me.user_id
                and a.deleted_at is null), 'epoch'::timestamptz)
  ) as last_activity_at

from me;
$$;


ALTER FUNCTION "public"."get_my_achievements"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_asset_view"("p_token" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_hash text;
  v_link record;
  v_payload jsonb;
begin
  v_hash := encode(digest(p_token, 'sha256'), 'hex');

  select pl.*
  into v_link
  from public.public_links pl
  where pl.token_hash = v_hash
    and pl.is_active = true
    and (pl.expires_at is null or pl.expires_at > now())
  limit 1;

  if v_link.id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_or_expired');
  end if;

  if v_link.system_id is not null then
    return jsonb_build_object('ok', false, 'error', 'not_asset_link');
  end if;

  with
  asset_row as (
    select
      a0.id,
      a0.name,
      a0.asset_subtype,
      a0.created_at
    from public.assets a0
    where a0.id = v_link.asset_id
    limit 1
  ),
  systems_rows as (
    select
      s0.id,
      s0.asset_id,
      s0.name,
      s0.system_type,
      s0.lifecycle_status,
      s0.lifecycle_phase,
      s0.status,
      s0.next_service_date,
      (
        select jsonb_build_object(
          'attachment_id', a1.id,
          'kind', a1.kind,
          'title', coalesce(a1.title, a1.file_name),
          'url', a1.url,
          'bucket', a1.bucket,
          'storage_path', a1.storage_path,
          'mime_type', a1.mime_type,
          'file_name', a1.file_name,
          'role', ap0.role,
          'label', ap0.label
        )
        from public.attachment_placements ap0
        join public.attachments a1 on a1.id = ap0.attachment_id
        where ap0.target_type = 'system'
          and ap0.target_id = s0.id
          and ap0.is_showcase = true
        order by ap0.sort_order nulls last, a1.created_at desc
        limit 1
      ) as showcase
    from public.systems s0
    where s0.asset_id = v_link.asset_id
    order by s0.name asc
  )
  select jsonb_build_object(
    'ok', true,
    'link', jsonb_build_object('label', v_link.label, 'mode', v_link.mode),
    'asset', (select to_jsonb(asset_row) from asset_row),
    'systems', coalesce((select jsonb_agg(to_jsonb(systems_rows)) from systems_rows), '[]'::jsonb)
  )
  into v_payload;

  return v_payload;
end;
$$;


ALTER FUNCTION "public"."get_public_asset_view"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_public_system_package"("p_token" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_hash text;
  v_link record;
  v_payload jsonb;
begin
  v_hash := encode(digest(p_token, 'sha256'), 'hex');

  select pl.*
  into v_link
  from public.public_links pl
  where pl.token_hash = v_hash
    and pl.is_active = true
    and pl.system_id is not null
    and (pl.expires_at is null or pl.expires_at > now())
  limit 1;

  if v_link.id is null then
    return jsonb_build_object('ok', false, 'error', 'invalid_or_expired');
  end if;

  with
  sys as (
    select
      s.id,
      s.asset_id,
      s.name,
      s.system_type,
      s.status,
      s.lifecycle_status,
      s.lifecycle_phase,
      s.created_at,
      s.updated_at
    from public.systems s
    where s.id = v_link.system_id
    limit 1
  ),
  readiness as (
    select
      jsonb_build_object(
        'location', r.location,
        'fuel_type', r.fuel_type,
        'bathrooms', r.bathrooms,
        'occupants', r.occupants,
        'outlet_within_10ft', r.outlet_within_10ft,
        'has_floor_drain', r.has_floor_drain,
        'has_recirc_pump', r.has_recirc_pump,
        'breaker_distance_ft', r.breaker_distance_ft
      ) as obj
    from public.system_readiness r
    where r.system_id = v_link.system_id
    limit 1
  ),
  proof as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'role', ap.role,
          'label', ap.label,
          'sort_order', ap.sort_order,
          'is_showcase', ap.is_showcase,
          'attachment_id', a.id,
          'kind', a.kind,
          'title', coalesce(a.title, a.file_name),
          'bucket', a.bucket,
          'storage_path', a.storage_path,
          'url', a.url,
          'mime_type', a.mime_type,
          'file_name', a.file_name,
          'created_at', a.created_at
        )
        order by ap.is_showcase desc, ap.sort_order nulls last, a.created_at desc
      ),
      '[]'::jsonb
    ) as items
    from public.attachment_placements ap
    join public.attachments a on a.id = ap.attachment_id
    where ap.target_type = 'system'
      and ap.target_id = v_link.system_id
      and a.deleted_at is null
  )
  select jsonb_build_object(
    'ok', true,
    'link', jsonb_build_object('label', v_link.label, 'mode', v_link.mode),
    'system', (select to_jsonb(sys) from sys),
    'readiness', coalesce((select obj from readiness), '{}'::jsonb),
    'proof', (select items from proof)
  )
  into v_payload;

  return v_payload;
end;
$$;


ALTER FUNCTION "public"."get_public_system_package"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_system_package"("p_system_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_payload jsonb;
begin
  with
  sys as (
    select
      s.id,
      s.asset_id,
      s.name,
      s.system_type,
      s.status,
      s.lifecycle_status,
      s.lifecycle_phase,
      s.created_at,
      s.updated_at
    from public.systems s
    where s.id = p_system_id
    limit 1
  ),
  readiness as (
    select to_jsonb(r.*) as obj
    from public.system_readiness r
    where r.system_id = p_system_id
    limit 1
  ),
  proof as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'role', ap.role,
          'label', ap.label,
          'sort_order', ap.sort_order,
          'is_showcase', ap.is_showcase,
          'attachment_id', a.id,
          'kind', a.kind,
          'title', coalesce(a.title, a.file_name),
          'notes', a.notes,
          'bucket', a.bucket,
          'storage_path', a.storage_path,
          'url', a.url,
          'mime_type', a.mime_type,
          'file_name', a.file_name,
          'size_bytes', a.size_bytes,
          'created_at', a.created_at
        )
        order by ap.is_showcase desc, ap.sort_order nulls last, a.created_at desc
      ),
      '[]'::jsonb
    ) as items
    from public.attachment_placements ap
    join public.attachments a on a.id = ap.attachment_id
    where ap.target_type = 'system'
      and ap.target_id = p_system_id
      and a.deleted_at is null
  )
  select jsonb_build_object(
    'ok', (select count(*) = 1 from sys),
    'system', (select to_jsonb(sys) from sys),
    'readiness', coalesce((select obj from readiness), '{}'::jsonb),
    'proof', (select items from proof)
  )
  into v_payload;

  return v_payload;
end;
$$;


ALTER FUNCTION "public"."get_system_package"("p_system_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  insert into public.profiles (id, email, onboarding_state, role, plan, created_at)
  values (new.id, new.email, 'not_started', 'consumer', 'free', now())
  on conflict (id) do nothing;
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_active_hub_member"("p_hub_id" "uuid") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from hub_members hm
    where hm.hub_id = p_hub_id
      and hm.user_id = auth.uid()
      and hm.status = 'active'
  );
$$;


ALTER FUNCTION "public"."is_active_hub_member"("p_hub_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_hub_admin"("p_hub_id" "uuid") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.hub_members
    where hub_id = p_hub_id
      and user_id = auth.uid()
      and role in ('owner','admin')
      and coalesce(status,'active') = 'active'
  );
$$;


ALTER FUNCTION "public"."is_hub_admin"("p_hub_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_team_active"() RETURNS boolean
    LANGUAGE "sql" STABLE
    AS $$
  select exists (
    select 1
    from public.profiles p
    where p.id = auth.uid()
      and p.plan = 'team'
      and p.billing_status = 'active'
  );
$$;


ALTER FUNCTION "public"."is_team_active"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keepr_asset_id_for_attachment_placement"("p_target_type" "text", "p_target_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
begin
  if p_target_type = 'asset' then
    return p_target_id;
  elsif p_target_type = 'system' then
    return (select s.asset_id from public.systems s where s.id = p_target_id);
  elsif p_target_type = 'service_record' then
    return (select r.asset_id from public.service_records r where r.id = p_target_id);
  elsif p_target_type = 'event' then
    return (select e.asset_id from public.event_inbox e where e.id = p_target_id);
  else
    return null;
  end if;
end;
$$;


ALTER FUNCTION "public"."keepr_asset_id_for_attachment_placement"("p_target_type" "text", "p_target_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keepr_asset_id_from_object_name"("p_name" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
declare
  m text[];
begin
  -- matches: .../attachments/<asset_uuid>/...
  m := regexp_match(
    p_name,
    'attachments/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/'
  );

  if m is null then
    return null;
  end if;

  return m[1]::uuid;
exception when others then
  return null;
end;
$$;


ALTER FUNCTION "public"."keepr_asset_id_from_object_name"("p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keepr_asset_limit_for_plan"("p_plan" "text") RETURNS integer
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select case lower(coalesce(p_plan,''))
    when 'starter' then 3
    when 'free' then 3
    when 'plus' then 10
    when 'pro' then 10
    when 'team' then 20
    else 3
  end;
$$;


ALTER FUNCTION "public"."keepr_asset_limit_for_plan"("p_plan" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keepr_can_access_asset"("p_asset_id" "uuid", "p_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
  select exists (
    select 1
    from public.assets a
    where a.id = p_asset_id
      and (
        -- owner
        a.owner_id = p_user

        -- legacy direct membership (keep for now)
        or exists (
          select 1
          from public.asset_members am
          where am.asset_id = a.id
            and am.user_id = p_user
        )

        -- org-based access via stewardship
        or exists (
          select 1
          from public.asset_stewardships s
          join public.org_members om on om.org_id = s.org_id
          where s.asset_id = a.id
            and s.active = true
            and om.user_id = p_user
        )
      )
  );
$$;


ALTER FUNCTION "public"."keepr_can_access_asset"("p_asset_id" "uuid", "p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keepr_enforce_asset_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_owner uuid;
  v_plan text;
  v_limit int;
  v_count int;
begin
  v_owner := new.owner_id;

  if v_owner is null then
    return new;
  end if;

  v_plan := public.keepr_user_plan(v_owner);
  v_limit := public.keepr_asset_limit_for_plan(v_plan);

  select count(*) into v_count
  from public.assets a
  where a.owner_id = v_owner
    and a.deleted_at is null
    and a.status = 'active';

  if v_count >= v_limit then
    raise exception 'plan_limit_assets: plan=% (limit=%)', v_plan, v_limit
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."keepr_enforce_asset_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keepr_enforce_plan_downgrade_storage"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  old_limit bigint;
  new_limit bigint;
  used bigint;
begin
  -- only when plan is changing
  if new.plan is null or old.plan is null or lower(trim(new.plan)) = lower(trim(old.plan)) then
    return new;
  end if;

  old_limit := public.keepr_plan_limit_bytes_for_plan(old.plan);
  new_limit := public.keepr_plan_limit_bytes_for_plan(new.plan);

  -- only enforce on downgrade (new limit smaller)
  if new_limit < old_limit then
    used := public.keepr_storage_usage_bytes(new.id);

    if used > new_limit then
      raise exception
        'plan_downgrade_blocked_storage: used_bytes=% new_limit_bytes=%',
        used, new_limit
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."keepr_enforce_plan_downgrade_storage"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keepr_enforce_storage_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_owner uuid;
  v_plan text;
  v_limit bigint;
  v_used bigint;
  v_new_size bigint;
  v_old_size bigint;
  v_delta bigint;
begin
  v_owner := public.keepr_storage_resolve_owner(new.owner, new.name);

  -- can't attribute -> don't block
  if v_owner is null then
    return new;
  end if;

  v_plan := public.keepr_user_plan(v_owner);
  v_limit := public.keepr_storage_limit_bytes_for_plan(v_plan);

  v_new_size := public.keepr_safe_bigint(new.metadata->>'size');
  v_old_size := 0;

  if tg_op = 'UPDATE' then
    v_old_size := public.keepr_safe_bigint(old.metadata->>'size');
  end if;

  v_delta := greatest(v_new_size - v_old_size, 0);
  v_used := public.keepr_storage_usage_bytes(v_owner);

  if (v_used + v_delta) > v_limit then
    raise exception 'plan_limit_storage: plan=% (limit_bytes=% used_bytes=% delta_bytes=%)',
      v_plan, v_limit, v_used, v_delta
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."keepr_enforce_storage_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keepr_enforce_systems_per_asset_limit"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$declare
  v_asset_id uuid;
  v_owner uuid;
  v_plan text;
  v_limit int;
  v_count int;
begin
  v_asset_id := new.asset_id;

  if v_asset_id is null then
    return new;
  end if;

  select a.owner_id into v_owner
  from public.assets a
  where a.id = v_asset_id
  limit 1;

  if v_owner is null then
    return new;
  end if;

  -- TEMP: relax systems cap during onboarding / beta
  v_limit := 2147483647;

  select count(*) into v_count
  from public.systems s
  where s.asset_id = v_asset_id;

  if v_count >= v_limit then
    raise exception 'plan_limit_systems_per_asset: plan=% (limit=%)', v_plan, v_limit
      using errcode = 'P0001';
  end if;

  return new;
end;$$;


ALTER FUNCTION "public"."keepr_enforce_systems_per_asset_limit"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keepr_is_asset_collaborator"("p_asset_id" "uuid", "p_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
  select exists (
    select 1
    from public.asset_members am
    where am.asset_id = p_asset_id
      and am.user_id = p_user
  );
$$;


ALTER FUNCTION "public"."keepr_is_asset_collaborator"("p_asset_id" "uuid", "p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keepr_is_asset_owner"("p_asset_id" "uuid", "p_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
  select exists (
    select 1
    from public.assets a
    where a.id = p_asset_id
      and a.owner_id = p_user
  );
$$;


ALTER FUNCTION "public"."keepr_is_asset_owner"("p_asset_id" "uuid", "p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keepr_is_org_member"("p_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
  select exists (
    select 1
    from public.org_members
    where org_id = p_org_id
      and user_id = auth.uid()
  );
$$;


ALTER FUNCTION "public"."keepr_is_org_member"("p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keepr_is_org_member"("p_org_id" "uuid", "p_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
  select exists (
    select 1
    from public.org_members om
    where om.org_id = p_org_id
      and om.user_id = p_user
  );
$$;


ALTER FUNCTION "public"."keepr_is_org_member"("p_org_id" "uuid", "p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keepr_is_org_owner"("p_org_id" "uuid", "p_user" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
  select exists (
    select 1
    from public.orgs o
    where o.id = p_org_id
      and o.owner_user_id = p_user
  );
$$;


ALTER FUNCTION "public"."keepr_is_org_owner"("p_org_id" "uuid", "p_user" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keepr_plan_limit_bytes_for_plan"("p_plan" "text") RETURNS bigint
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
declare
  p text := lower(trim(coalesce(p_plan,'')));
begin
  if p = '' or p like 'starter%' or p like 'free%' then
    return 100::bigint * 1024 * 1024; -- 100MB
  end if;

  if p like 'plus%' then
    return 2::bigint * 1024 * 1024 * 1024; -- 2GB
  end if;

  if p like 'team%' then
    return 5::bigint * 1024 * 1024 * 1024; -- 5GB
  end if;

  return 100::bigint * 1024 * 1024;
end;
$$;


ALTER FUNCTION "public"."keepr_plan_limit_bytes_for_plan"("p_plan" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keepr_profile_id_by_email"("p_email" "text") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $$
  select p.id
  from public.profiles p
  where lower(coalesce(p.email,'')) = lower(trim(p_email))
  limit 1;
$$;


ALTER FUNCTION "public"."keepr_profile_id_by_email"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keepr_profile_sensitive_update_allowed"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  SELECT
    COALESCE(auth.role(), '') = 'service_role'
    OR current_user IN ('postgres', 'service_role', 'supabase_admin');
$$;


ALTER FUNCTION "public"."keepr_profile_sensitive_update_allowed"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keepr_protect_profile_sensitive_fields"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
DECLARE
  v_field text := NULL;
BEGIN
  IF public.keepr_profile_sensitive_update_allowed() THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    v_field := 'role';
  ELSIF NEW.plan IS DISTINCT FROM OLD.plan THEN
    v_field := 'plan';
  ELSIF NEW.billing_status IS DISTINCT FROM OLD.billing_status THEN
    v_field := 'billing_status';
  ELSIF NEW.billing_cycle IS DISTINCT FROM OLD.billing_cycle THEN
    v_field := 'billing_cycle';
  ELSIF NEW.stripe_customer_id IS DISTINCT FROM OLD.stripe_customer_id THEN
    v_field := 'stripe_customer_id';
  ELSIF NEW.stripe_subscription_id IS DISTINCT FROM OLD.stripe_subscription_id THEN
    v_field := 'stripe_subscription_id';
  ELSIF NEW.current_period_end IS DISTINCT FROM OLD.current_period_end THEN
    v_field := 'current_period_end';
  ELSIF NEW.account_status IS DISTINCT FROM OLD.account_status THEN
    IF NOT (
      OLD.account_status = 'active'
      AND NEW.account_status = 'deactivated'
      AND NEW.id = OLD.id
      AND OLD.id = auth.uid()
    ) THEN
      v_field := 'account_status';
    END IF;
  END IF;

  IF v_field IS NOT NULL THEN
    RAISE EXCEPTION 'profile_sensitive_field_update_denied'
      USING
        ERRCODE = '42501',
        DETAIL = v_field,
        HINT = 'Use a privileged server-side administrative path for profile authority changes.';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."keepr_protect_profile_sensitive_fields"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keepr_resolve_attachment_storage_path"("p_attachment_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    SET "row_security" TO 'off'
    AS $_$
declare
  v_asset_id uuid;
  v_path text;
begin
  -- get asset for auth check
  select a.asset_id into v_asset_id
  from public.attachments a
  where a.id = p_attachment_id;

  if v_asset_id is null then
    return null;
  end if;

  -- must be able to access the asset (owner or asset_member)
  if not public.keepr_can_access_asset(v_asset_id, auth.uid()) then
    raise exception 'not_allowed' using errcode = 'P0001';
  end if;

  -- find storage object by attachment id suffix
  select o.name into v_path
  from storage.objects o
  where o.bucket_id = 'asset-files'
    and o.name ~* ('/' || p_attachment_id::text || '\.[a-z0-9]+$')
  order by o.created_at desc
  limit 1;

  if v_path is null then
    return null;
  end if;

  -- persist fix (optional but recommended)
  update public.attachments
  set storage_path = v_path
  where id = p_attachment_id
    and storage_path is null;

  return v_path;
end;
$_$;


ALTER FUNCTION "public"."keepr_resolve_attachment_storage_path"("p_attachment_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keepr_resolve_kac_for_manifest_admin"("p_kac" "text") RETURNS TABLE("id" "uuid", "kac_id" "text", "master_asset_id" "uuid", "status" "text", "asset_mode" "text")
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_catalog'
    SET "row_security" TO 'off'
    AS $_$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_kac text := upper(regexp_replace(trim(coalesce(p_kac, '')), '\s+', '', 'g'));
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  SELECT p.role
    INTO v_role
  FROM public.profiles p
  WHERE p.id = v_uid;

  IF v_role NOT IN ('admin', 'superkeepr') THEN
    RETURN;
  END IF;

  IF v_kac !~ '^KPR-[A-Z0-9]+(-[A-Z0-9]+)*$' THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    a.id,
    a.kac_id,
    a.master_asset_id,
    a.status,
    a.asset_mode
  FROM public.assets a
  WHERE a.kac_id = v_kac
    AND a.deleted_at IS NULL
  LIMIT 1;
END;
$_$;


ALTER FUNCTION "public"."keepr_resolve_kac_for_manifest_admin"("p_kac" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keepr_safe_bigint"("p_text" "text") RETURNS bigint
    LANGUAGE "plpgsql" IMMUTABLE
    AS $_$
declare
  v bigint;
begin
  if p_text is null then
    return 0;
  end if;

  -- only attempt cast for plain digits
  if p_text !~ '^[0-9]+$' then
    return 0;
  end if;

  begin
    v := p_text::bigint;
    return v;
  exception
    when numeric_value_out_of_range then
      return 0;
    when others then
      return 0;
  end;
end;
$_$;


ALTER FUNCTION "public"."keepr_safe_bigint"("p_text" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keepr_storage_limit_bytes_for_plan"("p_plan" "text") RETURNS bigint
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$
declare
  p text := lower(trim(coalesce(p_plan,'')));
begin
  if p = '' or p like 'starter%' or p like 'free%' then
    return 100::bigint * 1024 * 1024; -- 100MB
  end if;

  if p like 'plus%' then
    return 2::bigint * 1024 * 1024 * 1024; -- 2GB
  end if;

  if p like 'team%' then
    return 5::bigint * 1024 * 1024 * 1024; -- 5GB
  end if;

  return 100::bigint * 1024 * 1024;
end;
$$;


ALTER FUNCTION "public"."keepr_storage_limit_bytes_for_plan"("p_plan" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keepr_storage_resolve_owner"("p_owner" "uuid", "p_name" "text") RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v uuid;
  m text;
begin
  if p_owner is not null then
    return p_owner;
  end if;

  if p_name is null then
    return null;
  end if;

  m := substring(p_name from '^([0-9a-fA-F-]{36})/');
  if m is null then
    return null;
  end if;

  begin
    v := m::uuid;
    return v;
  exception when others then
    return null;
  end;
end;
$$;


ALTER FUNCTION "public"."keepr_storage_resolve_owner"("p_owner" "uuid", "p_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keepr_storage_usage_bytes"("p_owner" "uuid") RETURNS bigint
    LANGUAGE "sql" STABLE
    AS $$
  select coalesce(
    sum(public.keepr_safe_bigint(o.metadata->>'size')),
    0
  )
  from storage.objects o
  join attachments att
    on att.bucket = o.bucket_id
   and att.storage_path = o.name
  join attachment_placements ap
    on ap.attachment_id = att.id
  join assets a
    on a.id = ap.target_id
  where a.owner_id = p_owner
    and a.deleted_at is null
    and ap.target_type = 'asset'
$$;


ALTER FUNCTION "public"."keepr_storage_usage_bytes"("p_owner" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keepr_systems_per_asset_limit_for_plan"("p_plan" "text") RETURNS integer
    LANGUAGE "plpgsql" IMMUTABLE
    AS $$declare
  p text := lower(trim(coalesce(p_plan, '')));
begin
  if p = '' then
    return 15;
  end if;

  -- treat common variants
  if p like 'starter%' or p like 'free%' then
    return 15;
  end if;

  -- Plus / Team are unlimited for systems (per your current plan screen)
  if p like 'plus%' then
    return 2147483647;
  end if;

  if p like 'team%' then
    return 2147483647;
  end if;

  -- Optional: SuperKeepr role (effectively unlimited)
  if p like 'superkeepr%' then
    return 2147483647;
  end if;

  -- safe default
  return 15;
end;$$;


ALTER FUNCTION "public"."keepr_systems_per_asset_limit_for_plan"("p_plan" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keepr_user_id_by_email"("p_email" "text") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    SET "row_security" TO 'off'
    AS $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(trim(p_email))
  limit 1;
$$;


ALTER FUNCTION "public"."keepr_user_id_by_email"("p_email" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."keepr_user_plan"("p_user_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    AS $$
  select lower(trim(coalesce(
    (select plan from public.profiles where id = p_user_id),
    (select plan from public.user_entitlements where user_id = p_user_id),
    'starter'
  )));
$$;


ALTER FUNCTION "public"."keepr_user_plan"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."owner_systems_report_rows"("p_asset_id" "uuid") RETURNS TABLE("system_name" "text", "system_type" "text", "location" "text", "status" "text", "last_service_date" "date", "service_count" integer, "proof_count" integer, "vendors" "text", "notes" "text")
    LANGUAGE "sql" STABLE
    AS $$
  with sys as (
    select
      s.id,
      s.name,
      s.system_type,
      s.ksc_code,
      s.status,
      s.last_service_date,
      s.metadata
    from public.systems s
    where s.asset_id = p_asset_id
  ),

  sr as (
    select
      r.system_id,
      count(*)::int as service_count,
      max(r.performed_at)::date as last_service_date,
      string_agg(distinct kp.name, ', ' order by kp.name) as vendors
    from public.service_records r
    left join public.keepr_pros kp
      on kp.id = r.keepr_pro_id
    where r.asset_id = p_asset_id
      and r.system_id is not null
    group by r.system_id
  ),

  proof_by_system as (
    select
      s.id as system_id,
      count(distinct ap.attachment_id)::int as proof_count
    from sys s
    left join public.service_records r
      on r.system_id = s.id and r.asset_id = p_asset_id
    left join public.attachment_placements ap
      on (
        (ap.target_type = 'system' and ap.target_id = s.id)
        or (ap.target_type = 'service_record' and ap.target_id = r.id)
      )
    left join public.attachments a
      on a.id = ap.attachment_id
     and a.deleted_at is null
    group by s.id
  )

  select
    s.name as system_name,
    coalesce(s.system_type, s.ksc_code, '') as system_type,
    coalesce(s.metadata->>'location', '') as location,
    coalesce(s.status, 'ok') as status,
    coalesce(sr.last_service_date, s.last_service_date) as last_service_date,
    coalesce(sr.service_count, 0) as service_count,
    coalesce(p.proof_count, 0) as proof_count,
    coalesce(sr.vendors, '') as vendors,
    coalesce(s.metadata->>'notes', '') as notes
  from sys s
  left join sr on sr.system_id = s.id
  left join proof_by_system p on p.system_id = s.id
  order by
    coalesce(p.proof_count, 0) asc,
    coalesce(sr.last_service_date, s.last_service_date) nulls last,
    lower(s.name) asc;
$$;


ALTER FUNCTION "public"."owner_systems_report_rows"("p_asset_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."plan_limits"("tier" "text") RETURNS "jsonb"
    LANGUAGE "sql" STABLE
    AS $$
  select case tier
    when 'free' then jsonb_build_object('assets', 3,  'storage_gb', 3,  'members', 1)
    when 'plus' then jsonb_build_object('assets', 20, 'storage_gb', 10, 'members', 1)
    when 'team' then jsonb_build_object('assets', 30, 'storage_gb', 25, 'members', 5)
    else jsonb_build_object('assets', 3, 'storage_gb', 3, 'members', 1)
  end
$$;


ALTER FUNCTION "public"."plan_limits"("tier" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."promote_event_to_service_record"("p_event_id" "uuid", "p_owner_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_event public.event_inbox%rowtype;
  v_service_record_id uuid;
  v_source_type text;
  v_dedupe_key text;
begin
  --------------------------------------------------------------------
  -- 1) Load + lock the event row
  --------------------------------------------------------------------
  select *
    into v_event
  from public.event_inbox
  where id = p_event_id
    and owner_id = p_owner_id
  for update;

  if not found then
    raise exception 'Event % not found for owner %', p_event_id, p_owner_id
      using errcode = 'P0002';
  end if;

  if v_event.asset_id is null then
    raise exception 'Event % cannot be promoted without asset_id', p_event_id
      using errcode = 'P0001';
  end if;

  --------------------------------------------------------------------
  -- 2) Decide source_type for service_records based on attachments
  --------------------------------------------------------------------
  select
    case
      when exists (select 1 from public.event_inbox_attachments a where a.event_id = p_event_id) then
        case
          when exists (
            select 1 from public.event_inbox_attachments a
            where a.event_id = p_event_id and lower(coalesce(a.mime_type, '')) like 'image/%'
          )
          and exists (
            select 1 from public.event_inbox_attachments a
            where a.event_id = p_event_id and (a.mime_type is null or lower(a.mime_type) not like 'image/%')
          ) then 'document'
          when exists (
            select 1 from public.event_inbox_attachments a
            where a.event_id = p_event_id and (a.mime_type is null or lower(a.mime_type) not like 'image/%')
          ) then 'document'
          when exists (
            select 1 from public.event_inbox_attachments a
            where a.event_id = p_event_id and lower(coalesce(a.mime_type, '')) like 'image/%'
          ) then 'photo'
          else 'manual'
        end
      else 'manual'
    end
  into v_source_type;

  --------------------------------------------------------------------
  -- 2b) Dedupe service record (idempotent: return existing if present)
  --------------------------------------------------------------------
  v_dedupe_key := 'email:' || coalesce(v_event.message_id, v_event.id::text);

  select sr.id
    into v_service_record_id
  from public.service_records sr
  where sr.asset_id = v_event.asset_id
    and sr.dedupe_key = v_dedupe_key
  limit 1;

  if v_service_record_id is not null then
    return v_service_record_id;
  end if;

  --------------------------------------------------------------------
  -- 3) Insert into service_records
  --------------------------------------------------------------------
  insert into public.service_records (
    asset_id,
    system_id,
    title,
    notes,
    service_type,
    category,
    performed_at,
    source_type,
    extra_metadata,
    dedupe_key
  )
  values (
    v_event.asset_id,
    v_event.system_id,
    coalesce(nullif(v_event.title, ''), 'Untitled'),
    v_event.notes,
    'maintenance',
    'general',
    coalesce(v_event.occurred_at::date, current_date),
    v_source_type,
    jsonb_build_object(
      'origin', 'event_inbox',
      'event_id', v_event.id,
      'amount_cents', v_event.amount_cents,
      'message_id', v_event.message_id
    ),
    v_dedupe_key
  )
  returning id into v_service_record_id;

  --------------------------------------------------------------------
  -- 4) Migrate event_inbox_attachments -> attachments + placements
  --    Fixes:
  --      - attachments.url stays NULL unless truly public https
  --      - reuse attachments by (owner_user_id, bucket, storage_path)
  --      - no duplicate placements
  --------------------------------------------------------------------
  with src as (
    select
      a.*,
      row_number() over (order by a.created_at asc nulls last, a.id asc) as rn,
      coalesce(nullif(a.storage_bucket, ''), 'asset-files') as bucket_norm
    from public.event_inbox_attachments a
    where a.event_id = p_event_id
  ),
  existing as (
    select
      at.id as attachment_id,
      at.storage_path
    from public.attachments at
    join src on src.storage_path = at.storage_path
           and src.bucket_norm = at.bucket
    where at.owner_user_id = p_owner_id
      and at.deleted_at is null
  ),
  to_insert as (
    select src.*
    from src
    left join existing e on e.storage_path = src.storage_path
    where e.attachment_id is null
  ),
  inserted as (
    insert into public.attachments (
      owner_user_id,
      asset_id,
      kind,
      bucket,
      storage_path,
      url,
      file_name,
      mime_type,
      size_bytes,
      title,
      notes,
      source_context,
      tags
    )
    select
      p_owner_id,
      v_event.asset_id,
      case
        when lower(coalesce(ti.mime_type, '')) like 'image/%' then 'photo'
        else 'file'
      end as kind,
      ti.bucket_norm as bucket,
      ti.storage_path,
      ti.public_url,          -- ✅ only set if real public URL; otherwise null
      coalesce(nullif(ti.file_name, ''), 'attachment') as file_name,
      ti.mime_type,
      0::bigint as size_bytes,
      coalesce(nullif(ti.title, ''), nullif(ti.file_name, ''), 'Attachment') as title,
      ti.notes,
      jsonb_build_object(
        'origin', 'event_inbox',
        'event_id', p_event_id,
        'message_id', v_event.message_id,
        'source_message_id', ti.source_message_id
      ) as source_context,
      array[]::text[] as tags
    from to_insert ti
    returning id as attachment_id, storage_path
  ),
  all_att as (
    select e.attachment_id, s.rn
    from existing e
    join src s on s.storage_path = e.storage_path

    union all

    select i.attachment_id, s.rn
    from inserted i
    join src s on s.storage_path = i.storage_path
  )
  insert into public.attachment_placements (
    attachment_id,
    target_type,
    target_id,
    role,
    label,
    sort_order,
    is_showcase
  )
  select
    aa.attachment_id,
    'service_record',
    v_service_record_id,
    'proof',
    null,
    aa.rn,
    false
  from all_att aa
  where not exists (
    select 1
    from public.attachment_placements ap
    where ap.attachment_id = aa.attachment_id
      and ap.target_type = 'service_record'
      and ap.target_id = v_service_record_id
  );

  --------------------------------------------------------------------
  -- 5) Clean up inbox rows (make it official)
  --------------------------------------------------------------------
  delete from public.event_inbox_attachments
  where event_id = p_event_id;

  delete from public.event_inbox
  where id = p_event_id;

  return v_service_record_id;
end;
$$;


ALTER FUNCTION "public"."promote_event_to_service_record"("p_event_id" "uuid", "p_owner_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."remove_org_member"("p_org_id" "uuid", "p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
declare
  v_is_owner boolean;
begin
  select (o.owner_user_id = auth.uid())
    into v_is_owner
  from public.orgs o
  where o.id = p_org_id;

  if v_is_owner is distinct from true then
    raise exception 'Not authorized';
  end if;

  -- never remove the owner
  if p_user_id = auth.uid() then
    raise exception 'Owner cannot be removed';
  end if;

  delete from public.org_members
  where org_id = p_org_id
    and user_id = p_user_id;
end;
$$;


ALTER FUNCTION "public"."remove_org_member"("p_org_id" "uuid", "p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."resolve_kac"("p_kac" "text", "p_channel" "text" DEFAULT 'qr'::"text", "p_action" "text" DEFAULT 'scan'::"text", "p_context" "jsonb" DEFAULT '{}'::"jsonb") RETURNS TABLE("master_asset_id" "uuid", "kac" "text", "asset_type" "text", "asset_id" "uuid", "has_access" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_master public.master_assets;
  v_user uuid := auth.uid();
  v_has_access boolean := false;
  v_actor_type text := 'anonymous';
  v_asset_id uuid := null;
begin
  select * into v_master
  from public.master_assets ma
  where ma.kac = p_kac;

  if v_master.id is null then
    return;
  end if;

  update public.master_assets
  set last_seen_at = now()
  where id = v_master.id;

  select a.id into v_asset_id
  from public.assets a
  where a.master_asset_id = v_master.id
    and a.deleted_at is null
  order by a.created_at asc
  limit 1;

  if v_user is not null then
    v_actor_type := 'owner';

    select exists(
      select 1
      from public.asset_stewards s
      where s.master_asset_id = v_master.id
        and s.user_id = v_user
        and s.ended_at is null
    ) into v_has_access;
  end if;

  insert into public.asset_engagement_events (
    master_asset_id,
    actor_type,
    actor_user_id,
    channel,
    action,
    context
  )
  values (
    v_master.id,
    v_actor_type,
    v_user,
    p_channel,
    p_action,
    coalesce(p_context, '{}'::jsonb)
  );

  master_asset_id := v_master.id;
  kac := v_master.kac;
  asset_type := v_master.asset_type;
  asset_id := v_asset_id;
  has_access := v_has_access;

  return next;
end;
$$;


ALTER FUNCTION "public"."resolve_kac"("p_kac" "text", "p_channel" "text", "p_action" "text", "p_context" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_attachment_org_id_from_stewardship"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.org_id := null;

  if new.asset_id is not null then
    select s.org_id
      into new.org_id
    from public.asset_stewardships s
    where s.asset_id = new.asset_id
      and s.org_id is not null
      and s.active = true
      and (s.ends_at is null or s.ends_at > now())
    order by s.starts_at desc
    limit 1;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."set_attachment_org_id_from_stewardship"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_current_timestamp_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_catalog'
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_current_timestamp_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  new.updated_at = now();
  return new;
end;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_profile_email"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email)
  on conflict (id) do update
    set email = excluded.email;

  return new;
end;
$$;


ALTER FUNCTION "public"."sync_profile_email"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."system_readiness_set_user_id"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  if new.user_id is null then
    select a.owner_id into new.user_id
    from public.assets a
    where a.id = new.asset_id;
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."system_readiness_set_user_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."timeline_cost_detail_rows"("p_asset_id" "uuid") RETURNS TABLE("performed_at" "date", "title" "text", "system_name" "text", "category" "text", "keepr_pro_name" "text", "cost" numeric, "proof_count" integer)
    LANGUAGE "sql" STABLE
    AS $$
  with proof as (
    select
      ap.target_id as service_record_id,
      count(distinct ap.attachment_id)::int as proof_count
    from public.attachment_placements ap
    join public.attachments a
      on a.id = ap.attachment_id
     and a.deleted_at is null
    where ap.target_type = 'service_record'
    group by ap.target_id
  )
  select
    r.performed_at,
    coalesce(r.title, '') as title,
    coalesce(s.name, '') as system_name,
    coalesce(r.category, '') as category,
    coalesce(kp.name, '') as keepr_pro_name,
    coalesce(r.cost, 0) as cost,
    coalesce(p.proof_count, 0) as proof_count
  from public.service_records r
  left join public.systems s on s.id = r.system_id
  left join public.keepr_pros kp on kp.id = r.keepr_pro_id
  left join proof p on p.service_record_id = r.id
  where r.asset_id = p_asset_id
  order by r.performed_at desc, r.created_at desc;
$$;


ALTER FUNCTION "public"."timeline_cost_detail_rows"("p_asset_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."timeline_cost_year_rollup_rows"("p_asset_id" "uuid") RETURNS TABLE("year" integer, "total_cost" numeric, "record_count" integer, "proof_items" integer)
    LANGUAGE "sql" STABLE
    AS $$
  with rec as (
    select
      r.id,
      r.performed_at,
      coalesce(r.cost,0) as cost
    from public.service_records r
    where r.asset_id = p_asset_id
  ),
  proof as (
    select
      ap.target_id as service_record_id,
      count(distinct ap.attachment_id)::int as proof_count
    from public.attachment_placements ap
    join public.attachments a
      on a.id = ap.attachment_id
     and a.deleted_at is null
    where ap.target_type = 'service_record'
    group by ap.target_id
  )
  select
    extract(year from rec.performed_at)::int as year,
    coalesce(sum(rec.cost),0) as total_cost,
    count(*)::int as record_count,
    coalesce(sum(coalesce(p.proof_count,0)),0)::int as proof_items
  from rec
  left join proof p on p.service_record_id = rec.id
  group by extract(year from rec.performed_at)::int
  order by year desc;
$$;


ALTER FUNCTION "public"."timeline_cost_year_rollup_rows"("p_asset_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."user_asset_count"("uid" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE
    AS $$
  select count(*)
  from public.assets a
  where a.owner_id = uid
    and a.deleted_at is null
    and a.status <> 'archived'
$$;


ALTER FUNCTION "public"."user_asset_count"("uid" "uuid") OWNER TO "postgres";




CREATE TABLE IF NOT EXISTS "public"."action_proposals" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "attachment_id" "uuid",
    "enrichment_run_id" "uuid",
    "object_type_key" "text" NOT NULL,
    "action_type_key" "text" NOT NULL,
    "scope" "public"."proposal_scope" DEFAULT 'current'::"public"."proposal_scope" NOT NULL,
    "confidence" "public"."confidence_level" DEFAULT 'derived'::"public"."confidence_level" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "summary" "text",
    "dedupe_key" "text",
    "status" "public"."proposal_status" DEFAULT 'pending'::"public"."proposal_status" NOT NULL,
    "decided_at" timestamp with time zone,
    "decided_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."action_proposals" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."action_types" (
    "key" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "description" "text",
    "enabled" boolean DEFAULT true NOT NULL,
    "payload_schema" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."action_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."actions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "type" "text" NOT NULL,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "priority" integer DEFAULT 50 NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "created_by_user_id" "uuid",
    "assigned_to_user_id" "uuid",
    "assigned_to_email" "text",
    "claimable" boolean DEFAULT true NOT NULL,
    "source_table" "text",
    "source_id" "uuid",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "due_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "claimed_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "dismissed_at" timestamp with time zone
);


ALTER TABLE "public"."actions" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."admin_asset_story_summary" AS
SELECT
    NULL::"uuid" AS "asset_id",
    NULL::"text" AS "kac_id",
    NULL::"uuid" AS "user_id",
    NULL::"text" AS "name",
    NULL::"text" AS "type",
    NULL::"text" AS "status",
    NULL::timestamp with time zone AS "created_at",
    NULL::bigint AS "system_count",
    NULL::bigint AS "service_record_count",
    NULL::timestamp with time zone AS "last_service_at",
    NULL::bigint AS "attachment_count";


ALTER VIEW "public"."admin_asset_story_summary" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."admin_system_story_summary" AS
SELECT
    NULL::"uuid" AS "system_id",
    NULL::"uuid" AS "asset_id",
    NULL::"uuid" AS "user_id",
    NULL::"text" AS "name",
    NULL::"text" AS "system_type",
    NULL::"text" AS "status",
    NULL::"text" AS "lifecycle_status",
    NULL::"text" AS "mode",
    NULL::timestamp with time zone AS "created_at",
    NULL::bigint AS "service_record_count",
    NULL::"date" AS "last_service_date";


ALTER VIEW "public"."admin_system_story_summary" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."admin_user_assets" AS
SELECT
    NULL::"uuid" AS "asset_id",
    NULL::"uuid" AS "user_id",
    NULL::"text" AS "kac_id",
    NULL::"text" AS "name",
    NULL::"text" AS "type",
    NULL::"text" AS "status",
    NULL::timestamp with time zone AS "created_at",
    NULL::bigint AS "system_count",
    NULL::bigint AS "service_record_count";


ALTER VIEW "public"."admin_user_assets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assets" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid",
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "location" "text",
    "hero_image_url" "text",
    "purchase_date" "date",
    "purchase_price" numeric,
    "estimated_value" numeric,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "asset_subtype" "text",
    "year" smallint,
    "make" "text",
    "model" "text",
    "trim" "text",
    "body_style" "text",
    "engine" "text",
    "drivetrain" "text",
    "transmission" "text",
    "color" "text",
    "current_odometer" integer,
    "vin" "text",
    "plate_number" "text",
    "property_type" "text",
    "year_built" smallint,
    "beds" integer,
    "baths" numeric(3,1),
    "square_feet" integer,
    "lot_size_sqft" integer,
    "parcel_number" "text",
    "vehicle_subtype" "text",
    "subtype" "text",
    "hull_material" "text",
    "length_feet" integer,
    "engine_type" "text",
    "engine_hours" integer,
    "registration_number" "text",
    "kac_id" "text",
    "serial_number" "text",
    "status" "text" DEFAULT 'active'::"text",
    "extra_metadata" "jsonb",
    "data_source" "text",
    "ai_metadata" "jsonb",
    "deleted_at" timestamp with time zone,
    "master_asset_id" "uuid",
    "hero_placement_id" "uuid",
    "sort_rank" integer,
    "asset_mode" "text" DEFAULT 'personal'::"text" NOT NULL,
    "commercial_entity" "text",
    "hero_thumb_url" "text",
    "hero_thumb_updated_at" timestamp with time zone,
    CONSTRAINT "assets_asset_mode_check" CHECK (("asset_mode" = ANY (ARRAY['personal'::"text", 'commercial'::"text"]))),
    CONSTRAINT "assets_status_check" CHECK (("status" = ANY (ARRAY['active'::"text", 'archived'::"text", 'transfer_ready'::"text", 'unclaimed'::"text", 'disputed'::"text"])))
);


ALTER TABLE "public"."assets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attachments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_user_id" "uuid",
    "asset_id" "uuid",
    "kind" "text" NOT NULL,
    "bucket" "text" DEFAULT 'asset-files'::"text" NOT NULL,
    "storage_path" "text",
    "url" "text",
    "file_name" "text",
    "mime_type" "text",
    "size_bytes" bigint,
    "title" "text",
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "source_context" "jsonb",
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "ai_summary" "text",
    "ai_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "extracted_text" "text",
    "text_source" "text" DEFAULT 'none'::"text",
    "ocr_status" "text" DEFAULT 'not_needed'::"text",
    "doc_type" "text" DEFAULT 'unknown'::"text",
    "extracted_at" timestamp with time zone,
    "extracted_error" "text",
    "search_vector" "tsvector" GENERATED ALWAYS AS ("to_tsvector"('"english"'::"regconfig", COALESCE("extracted_text", ''::"text"))) STORED,
    "org_id" "uuid",
    "privacy" "text" DEFAULT 'moves_with_asset'::"text" NOT NULL,
    "thumb_160_url" "text",
    "thumb_320_url" "text",
    "thumb_640_url" "text",
    "derivatives_status" "text" DEFAULT 'pending'::"text",
    "derivatives_updated_at" timestamp with time zone,
    "thumb_160_path" "text",
    "thumb_320_path" "text",
    "thumb_640_path" "text",
    CONSTRAINT "attachments_kind_check" CHECK (("kind" = ANY (ARRAY['photo'::"text", 'file'::"text", 'link'::"text"]))),
    CONSTRAINT "attachments_privacy_check" CHECK (("privacy" = ANY (ARRAY['moves_with_asset'::"text", 'owner_only'::"text"])))
);


ALTER TABLE "public"."attachments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "title" "text",
    "notes" "text",
    "service_type" "text",
    "category" "text",
    "performed_at" "date" DEFAULT CURRENT_DATE NOT NULL,
    "location" "text",
    "odometer" integer,
    "cost" numeric(12,2),
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "system_id" "uuid",
    "keepr_pro_id" "uuid",
    "source_type" "text" DEFAULT 'manual'::"text" NOT NULL,
    "source_document_id" "uuid",
    "verification_status" "text" DEFAULT 'verified'::"text" NOT NULL,
    "extra_metadata" "jsonb",
    "ai_metadata" "jsonb",
    "record_scope" "text" DEFAULT 'current'::"text" NOT NULL,
    "dedupe_key" "text",
    CONSTRAINT "service_records_record_scope_check" CHECK (("record_scope" = ANY (ARRAY['historical'::"text", 'current'::"text"]))),
    CONSTRAINT "service_records_source_type_check" CHECK (("source_type" = ANY (ARRAY['manual'::"text", 'document'::"text", 'photo'::"text", 'import'::"text", 'carfax'::"text"]))),
    CONSTRAINT "service_records_verification_status_check" CHECK (("verification_status" = ANY (ARRAY['pending'::"text", 'verified'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."service_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."systems" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "ksc_code" "text" NOT NULL,
    "name" "text" NOT NULL,
    "lod" integer DEFAULT 2 NOT NULL,
    "status" "text" DEFAULT 'ok'::"text",
    "last_service_date" "date",
    "next_service_date" "date",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "system_type" "text",
    "source_type" "text" DEFAULT 'manual'::"text",
    "ai_metadata" "jsonb",
    "interval_months" integer,
    "interval_hours" integer,
    "playbook" "text",
    "hero_attachment_id" "uuid",
    "lifecycle_status" "text" DEFAULT 'active'::"text" NOT NULL,
    "lifecycle_phase" "text",
    "last_reviewed_at" timestamp with time zone,
    "next_review_at" timestamp with time zone,
    "mode" "text",
    "mode_updated_at" timestamp with time zone,
    CONSTRAINT "systems_mode_check" CHECK ((("mode" IS NULL) OR ("mode" = ANY (ARRAY['repair'::"text", 'replace'::"text", 'warranty_claim'::"text", 'insurance_claim'::"text", 'enhance'::"text"]))))
);


ALTER TABLE "public"."systems" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."admin_user_story_summary" AS
 WITH "assets" AS (
         SELECT "assets"."owner_id" AS "user_id",
            "count"(*) FILTER (WHERE ("assets"."deleted_at" IS NULL)) AS "asset_count",
            "max"("assets"."created_at") FILTER (WHERE ("assets"."deleted_at" IS NULL)) AS "last_asset_at"
           FROM "public"."assets"
          GROUP BY "assets"."owner_id"
        ), "systems" AS (
         SELECT "a_1"."owner_id" AS "user_id",
            "count"("s_1"."id") AS "system_count"
           FROM ("public"."assets" "a_1"
             JOIN "public"."systems" "s_1" ON (("s_1"."asset_id" = "a_1"."id")))
          WHERE ("a_1"."deleted_at" IS NULL)
          GROUP BY "a_1"."owner_id"
        ), "service" AS (
         SELECT "a_1"."owner_id" AS "user_id",
            "count"("sr_1"."id") AS "service_record_count",
            "count"(*) FILTER (WHERE ("sr_1"."created_at" >= ("now"() - '30 days'::interval))) AS "service_30d",
            "max"("sr_1"."created_at") AS "last_service_at"
           FROM ("public"."assets" "a_1"
             JOIN "public"."service_records" "sr_1" ON (("sr_1"."asset_id" = "a_1"."id")))
          WHERE ("a_1"."deleted_at" IS NULL)
          GROUP BY "a_1"."owner_id"
        ), "attachments" AS (
         SELECT "attachments"."owner_user_id" AS "user_id",
            "count"(*) FILTER (WHERE ("attachments"."deleted_at" IS NULL)) AS "attachment_count",
            "round"((("sum"(COALESCE("attachments"."size_bytes", (0)::bigint)) / 1024.0) / 1024.0), 2) AS "attachment_mb"
           FROM "public"."attachments"
          WHERE ("attachments"."deleted_at" IS NULL)
          GROUP BY "attachments"."owner_user_id"
        )
 SELECT "u"."id" AS "user_id",
    "u"."email",
    "u"."created_at",
    "u"."last_sign_in_at",
    COALESCE("a"."asset_count", (0)::bigint) AS "asset_count",
    COALESCE("s"."system_count", (0)::bigint) AS "system_count",
    COALESCE("sr"."service_record_count", (0)::bigint) AS "service_record_count",
    COALESCE("sr"."service_30d", (0)::bigint) AS "service_records_30d",
    COALESCE("att"."attachment_count", (0)::bigint) AS "attachment_count",
    COALESCE("att"."attachment_mb", (0)::numeric) AS "attachment_mb",
    GREATEST("a"."last_asset_at", "sr"."last_service_at", "u"."last_sign_in_at") AS "last_activity_at"
   FROM (((("auth"."users" "u"
     LEFT JOIN "assets" "a" ON (("a"."user_id" = "u"."id")))
     LEFT JOIN "systems" "s" ON (("s"."user_id" = "u"."id")))
     LEFT JOIN "service" "sr" ON (("sr"."user_id" = "u"."id")))
     LEFT JOIN "attachments" "att" ON (("att"."user_id" = "u"."id")));


ALTER VIEW "public"."admin_user_story_summary" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."asset_engagement_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "master_asset_id" "uuid" NOT NULL,
    "actor_type" "text" NOT NULL,
    "actor_user_id" "uuid",
    "channel" "text" NOT NULL,
    "action" "text" NOT NULL,
    "context" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."asset_engagement_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."asset_files" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "master_asset_id" "uuid" NOT NULL,
    "bucket" "text" DEFAULT 'asset-files'::"text" NOT NULL,
    "object_path" "text" NOT NULL,
    "filename" "text",
    "content_type" "text",
    "size_bytes" bigint,
    "category" "text",
    "tags" "text"[],
    "note" "text",
    "linked_type" "text",
    "linked_id" "uuid",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."asset_files" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."asset_identifiers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid",
    "kind" "text" NOT NULL,
    "value" "text" NOT NULL,
    "is_primary" boolean DEFAULT true
);


ALTER TABLE "public"."asset_identifiers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."asset_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."asset_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."asset_photos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid",
    "url" "text" NOT NULL,
    "caption" "text",
    "sort_order" integer DEFAULT 0,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "storage_path" "text",
    "is_hero" boolean DEFAULT false NOT NULL,
    "kind" "text" DEFAULT 'gallery'::"text",
    "service_record_id" "uuid"
);


ALTER TABLE "public"."asset_photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."asset_stewards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "master_asset_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'owner'::"text" NOT NULL,
    "started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ended_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."asset_stewards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."asset_stewardships" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "org_id" "uuid",
    "user_id" "uuid",
    "access_role" "text" DEFAULT 'steward'::"text" NOT NULL,
    "active" boolean DEFAULT true NOT NULL,
    "starts_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ends_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "stewardship_one_subject" CHECK (((("org_id" IS NOT NULL) AND ("user_id" IS NULL)) OR (("org_id" IS NULL) AND ("user_id" IS NOT NULL)))),
    CONSTRAINT "stewardship_role_check" CHECK (("access_role" = ANY (ARRAY['steward'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."asset_stewardships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."asset_thread_messages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "thread_id" "uuid" NOT NULL,
    "from_user_id" "uuid" NOT NULL,
    "body" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."asset_thread_messages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."asset_threads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "hub_id" "uuid",
    "owner_id" "uuid" NOT NULL,
    "created_by" "uuid" NOT NULL,
    "subject" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."asset_threads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."asset_transfers" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "master_asset_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "from_user_id" "uuid",
    "to_email" "text",
    "to_user_id" "uuid",
    "token" "text" NOT NULL,
    "expires_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "responded_at" timestamp with time zone
);


ALTER TABLE "public"."asset_transfers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."assurance_records" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "attachment_id" "uuid",
    "provider" "text",
    "plan_name" "text",
    "agreement_number" "text",
    "extracted" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "assurance_type" "text",
    "authorization_required" boolean,
    "maintenance_required" boolean,
    "deductible_amount" numeric,
    "claim_phone" "text",
    "claim_url" "text"
);


ALTER TABLE "public"."assurance_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attachment_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "system_id" "uuid",
    "service_record_id" "uuid",
    "url" "text" NOT NULL,
    "title" "text" NOT NULL,
    "notes" "text",
    "link_type" "text",
    "provider" "text",
    "preview_image_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."attachment_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attachment_meta" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "bucket" "text" NOT NULL,
    "path" "text" NOT NULL,
    "title" "text" NOT NULL,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "asset_id" "uuid"
);


ALTER TABLE "public"."attachment_meta" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attachment_meta_backup_20260226" (
    "id" "uuid",
    "user_id" "uuid",
    "bucket" "text",
    "path" "text",
    "title" "text",
    "notes" "text",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "asset_id" "uuid"
);


ALTER TABLE "public"."attachment_meta_backup_20260226" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attachment_placements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "attachment_id" "uuid" NOT NULL,
    "target_type" "text" NOT NULL,
    "target_id" "uuid" NOT NULL,
    "role" "text",
    "label" "text",
    "sort_order" integer,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_showcase" boolean DEFAULT false NOT NULL,
    CONSTRAINT "attachment_placements_target_type_check" CHECK (("target_type" = ANY (ARRAY['asset'::"text", 'system'::"text", 'service_record'::"text", 'event'::"text"])))
);


ALTER TABLE "public"."attachment_placements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attachment_placements_backup_20260226" (
    "id" "uuid",
    "attachment_id" "uuid",
    "target_type" "text",
    "target_id" "uuid",
    "role" "text",
    "label" "text",
    "sort_order" integer,
    "created_at" timestamp with time zone,
    "is_showcase" boolean
);


ALTER TABLE "public"."attachment_placements_backup_20260226" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."attachments_backup_20260226" (
    "id" "uuid",
    "owner_user_id" "uuid",
    "asset_id" "uuid",
    "kind" "text",
    "bucket" "text",
    "storage_path" "text",
    "url" "text",
    "file_name" "text",
    "mime_type" "text",
    "size_bytes" bigint,
    "title" "text",
    "notes" "text",
    "created_at" timestamp with time zone,
    "deleted_at" timestamp with time zone,
    "source_context" "jsonb",
    "tags" "text"[],
    "ai_summary" "text",
    "ai_metadata" "jsonb",
    "extracted_text" "text",
    "text_source" "text",
    "ocr_status" "text",
    "doc_type" "text",
    "extracted_at" timestamp with time zone,
    "extracted_error" "text",
    "search_vector" "tsvector"
);


ALTER TABLE "public"."attachments_backup_20260226" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."boat_systems" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "asset_id" "uuid",
    "system_type" "text",
    "name" "text",
    "manufacturer" "text",
    "model" "text",
    "serial_number" "text",
    "year" numeric,
    "hours" numeric,
    "notes" "text",
    "photo_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "system_id" "uuid"
);


ALTER TABLE "public"."boat_systems" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."email_intake_addresses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "token" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."email_intake_addresses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."enrichment_runs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "attachment_id" "uuid",
    "object_type_key" "text" NOT NULL,
    "status" "public"."enrichment_run_status" DEFAULT 'queued'::"public"."enrichment_run_status" NOT NULL,
    "parser_version" "text" DEFAULT 'v1'::"text" NOT NULL,
    "model_info" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "error_message" "text",
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "connector_key" "text",
    "proposals" "jsonb",
    "ai_summary" "text",
    "extracted_text" "text"
);


ALTER TABLE "public"."enrichment_runs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."environment_profiles" (
    "id" integer NOT NULL,
    "key" "text" NOT NULL,
    "water_type" "text",
    "uv_level" "text",
    "hurricane_zone" boolean,
    "maintenance_modifiers" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."environment_profiles" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."environment_profiles_id_seq"
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."environment_profiles_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."environment_profiles_id_seq" OWNED BY "public"."environment_profiles"."id";



CREATE TABLE IF NOT EXISTS "public"."event_inbox_attachments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "uuid" NOT NULL,
    "storage_path" "text" NOT NULL,
    "public_url" "text",
    "mime_type" "text",
    "file_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "title" "text",
    "notes" "text",
    "storage_bucket" "text" DEFAULT 'asset-files'::"text" NOT NULL,
    "source_message_id" "text"
);


ALTER TABLE "public"."event_inbox_attachments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."home_system_photos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "system_id" "uuid" NOT NULL,
    "storage_path" "text" NOT NULL,
    "url" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "caption" "text",
    "is_primary" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."home_system_photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."home_systems" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "system_type" "text" NOT NULL,
    "location_hint" "text",
    "status" "text" DEFAULT 'healthy'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "tags" "text"[] DEFAULT '{}'::"text"[],
    "playbook" "text",
    "system_id" "uuid"
);


ALTER TABLE "public"."home_systems" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."hub_members" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "hub_id" "uuid",
    "user_id" "uuid",
    "role" "text" DEFAULT 'member'::"text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "email" "text",
    "status" "text" DEFAULT 'active'::"text",
    "invited_by" "uuid",
    "invited_at" timestamp with time zone,
    "accepted_at" timestamp with time zone,
    "display_name" "text",
    "avatar_url" "text",
    "invite_token" "text",
    CONSTRAINT "hub_members_status_check" CHECK (("status" = ANY (ARRAY['invited'::"text", 'active'::"text", 'removed'::"text"])))
);


ALTER TABLE "public"."hub_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."hub_story_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "hub_id" "uuid",
    "asset_id" "uuid",
    "created_by" "uuid",
    "status" "text" DEFAULT 'approved'::"text",
    "featured" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."hub_story_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."hub_story_requests" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "hub_id" "uuid" NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "requester_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "message" "text",
    "reviewed_by" "uuid",
    "reviewed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."hub_story_requests" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."hubs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text" NOT NULL,
    "description" "text",
    "hero_image_url" "text",
    "visibility" "text" DEFAULT 'public'::"text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "hub_type" "text" DEFAULT 'community'::"text",
    "settings" "jsonb" DEFAULT '{}'::"jsonb"
);


ALTER TABLE "public"."hubs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."inbox_items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "to_user_id" "uuid",
    "to_email" "text",
    "from_user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "responded_at" timestamp with time zone
);


ALTER TABLE "public"."inbox_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invite_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "inviter_user_id" "uuid",
    "invite_slug" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "referred_user_id" "uuid",
    "user_agent" "text",
    "referrer" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "invite_events_event_type_check" CHECK (("event_type" = ANY (ARRAY['view'::"text", 'download_click'::"text", 'accepted'::"text"])))
);


ALTER TABLE "public"."invite_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."keepr_pros" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "category" "text",
    "phone" "text",
    "email" "text",
    "website" "text",
    "location" "text",
    "notes" "text",
    "since_label" "text",
    "last_service" "text",
    "is_favorite" boolean DEFAULT false NOT NULL,
    "assets" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "service_history" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "source" "text",
    "contact_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "address_line1" "text",
    "address_line2" "text",
    "city" "text",
    "state" "text",
    "postal_code" "text",
    "country" "text",
    "data_source" "text",
    "ai_metadata" "jsonb",
    "external_ids" "jsonb"
);


ALTER TABLE "public"."keepr_pros" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."locations" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "country" "text",
    "region" "text",
    "facility" "text",
    "facility_type" "text",
    "slip" "text",
    "environment_profile" "jsonb" DEFAULT '{}'::"jsonb",
    "active" boolean DEFAULT true,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."loose_notes" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "asset_id" "uuid",
    "system_id" "uuid",
    "route_context" "text",
    "title" "text",
    "note" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "created_from_route" "text",
    "asset_name" "text",
    "system_name" "text"
);


ALTER TABLE "public"."loose_notes" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."maintenance_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid",
    "title" "text" NOT NULL,
    "description" "text",
    "service_date" "date" NOT NULL,
    "odometer_hours" numeric,
    "cost" numeric,
    "provider" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."maintenance_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."maintenance_reminders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid",
    "title" "text" NOT NULL,
    "notes" "text",
    "due_date" "date",
    "is_completed" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."maintenance_reminders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."maturity_requirements" (
    "id" bigint NOT NULL,
    "asset_type" "text" NOT NULL,
    "system_type" "text" NOT NULL,
    "purpose" "text" NOT NULL,
    "key" "text" NOT NULL,
    "weight" numeric DEFAULT 1 NOT NULL,
    "required" boolean DEFAULT true NOT NULL
);


ALTER TABLE "public"."maturity_requirements" OWNER TO "postgres";


CREATE SEQUENCE IF NOT EXISTS "public"."maturity_requirements_id_seq"
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER SEQUENCE "public"."maturity_requirements_id_seq" OWNER TO "postgres";


ALTER SEQUENCE "public"."maturity_requirements_id_seq" OWNED BY "public"."maturity_requirements"."id";



CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text",
    "payload" "jsonb" DEFAULT '{}'::"jsonb",
    "read_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."object_actions" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "object_id" "uuid" NOT NULL,
    "action_type_key" "text" NOT NULL,
    "title" "text" NOT NULL,
    "due_at" timestamp with time zone,
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "completed_at" timestamp with time zone,
    "proof_attachment_id" "uuid",
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."object_actions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."object_attachments" (
    "object_id" "uuid" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "attachment_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'source'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."object_attachments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."object_links" (
    "object_id" "uuid" NOT NULL,
    "org_id" "uuid" NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "system_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."object_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."object_type_actions" (
    "object_type_key" "text" NOT NULL,
    "action_type_key" "text" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."object_type_actions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."object_types" (
    "key" "text" NOT NULL,
    "category" "public"."object_category" NOT NULL,
    "display_name" "text" NOT NULL,
    "description" "text",
    "enabled" boolean DEFAULT true NOT NULL,
    "parser_version" "text" DEFAULT 'v1'::"text" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."object_types" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."objects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "object_type_key" "text" NOT NULL,
    "title" "text" NOT NULL,
    "status" "text" DEFAULT 'active'::"text" NOT NULL,
    "source" "text" DEFAULT 'proof_builder'::"text" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."objects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."odometer_anchors" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "reading_date" "date",
    "odometer" integer NOT NULL,
    "source_type" "text" DEFAULT 'manual'::"text" NOT NULL,
    "source_ref_id" "uuid",
    "attachment_id" "uuid",
    "scope" "public"."proposal_scope" DEFAULT 'historical'::"public"."proposal_scope" NOT NULL,
    "confidence" "public"."confidence_level" DEFAULT 'derived'::"public"."confidence_level" NOT NULL,
    "is_locked" boolean DEFAULT false NOT NULL,
    "dedupe_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."odometer_anchors" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."org_members" (
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "member_role" "text" DEFAULT 'member'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "org_members_role_check" CHECK (("member_role" = ANY (ARRAY['owner'::"text", 'manager'::"text", 'member'::"text"])))
);


ALTER TABLE "public"."org_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."orgs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "org_type" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "owner_user_id" "uuid",
    "team_photo_url" "text",
    "display_name" "text",
    "photo_url" "text",
    "photo_attachment_id" "uuid"
);


ALTER TABLE "public"."orgs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ownership_bands" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "band_start" "date",
    "band_end" "date",
    "source_type" "text" DEFAULT 'manual'::"text" NOT NULL,
    "source_ref_id" "uuid",
    "attachment_id" "uuid",
    "scope" "public"."proposal_scope" DEFAULT 'ownership'::"public"."proposal_scope" NOT NULL,
    "confidence" "public"."confidence_level" DEFAULT 'derived'::"public"."confidence_level" NOT NULL,
    "is_locked" boolean DEFAULT false NOT NULL,
    "dedupe_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."ownership_bands" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."package_artifacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "package_id" "uuid" NOT NULL,
    "kind" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "mime_type" "text",
    "size_bytes" bigint,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."package_artifacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."package_rows" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "package_id" "uuid" NOT NULL,
    "row_index" integer NOT NULL,
    "row" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."package_rows" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."packages" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "package_type" "text" NOT NULL,
    "title" "text" DEFAULT 'Package'::"text" NOT NULL,
    "status" "text" DEFAULT 'ready'::"text" NOT NULL,
    "generated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "generated_by" "uuid",
    "totals" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "snapshot_meta" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."packages" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."photos" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "system_id" "uuid",
    "url" "text" NOT NULL,
    "ai_tags" "jsonb" DEFAULT '[]'::"jsonb",
    "uploaded_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "role" "text" DEFAULT 'consumer'::"text" NOT NULL,
    "email" "text",
    "plan" "text" DEFAULT 'free'::"text" NOT NULL,
    "onboarding_state" "text" DEFAULT 'not_started'::"text" NOT NULL,
    "onboarding_asset_id" "uuid",
    "display_name" "text",
    "account_status" "text" DEFAULT 'active'::"text" NOT NULL,
    "first_name" "text",
    "last_name" "text",
    "phone" "text",
    "city" "text",
    "state" "text",
    "country" "text",
    "timezone" "text",
    "profile_photo_url" "text",
    "bio" "text",
    "profile_photo_attachment_id" "uuid",
    "birthday" "date",
    "language" "text",
    "home_address" "text",
    "work_address" "text",
    "username" "text",
    "billing_cycle" "text",
    "billing_status" "text" DEFAULT 'inactive'::"text" NOT NULL,
    "stripe_customer_id" "text",
    "stripe_subscription_id" "text",
    "current_period_end" timestamp with time zone,
    "updated_at" timestamp with time zone DEFAULT "now"(),
    "inbox_name" "text",
    CONSTRAINT "profiles_account_status_check" CHECK (("account_status" = ANY (ARRAY['active'::"text", 'deactivated'::"text", 'banned'::"text"]))),
    CONSTRAINT "profiles_billing_cycle_check" CHECK (("billing_cycle" = ANY (ARRAY['monthly'::"text", 'yearly'::"text"]))),
    CONSTRAINT "profiles_billing_status_check" CHECK (("billing_status" = ANY (ARRAY['inactive'::"text", 'active'::"text", 'past_due'::"text", 'canceled'::"text"]))),
    CONSTRAINT "profiles_plan_check" CHECK (("plan" = ANY (ARRAY['free'::"text", 'plus'::"text", 'team'::"text"]))),
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['consumer'::"text", 'superkeepr'::"text", 'keeprpro'::"text", 'admin'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."public_asset_story_gallery" AS
 SELECT "ap"."id" AS "placement_id",
    "ap"."target_id" AS "asset_id",
    "a"."kac_id",
    "ap"."role",
    "ap"."is_showcase",
    "ap"."sort_order",
    "att"."id" AS "attachment_id",
    "att"."url",
    "att"."bucket",
    "att"."storage_path",
    "att"."mime_type",
    "att"."kind",
    "att"."file_name"
   FROM (("public"."attachment_placements" "ap"
     JOIN "public"."assets" "a" ON (("a"."id" = "ap"."target_id")))
     JOIN "public"."attachments" "att" ON (("att"."id" = "ap"."attachment_id")))
  WHERE (("ap"."target_type" = 'asset'::"text") AND (("ap"."role" = 'hero'::"text") OR ("ap"."is_showcase" = true)) AND ("a"."kac_id" IS NOT NULL) AND ("a"."deleted_at" IS NULL) AND ("a"."status" = 'active'::"text"));


ALTER VIEW "public"."public_asset_story_gallery" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."public_asset_story_summary" AS
 SELECT "a"."id" AS "asset_id",
    "a"."kac_id",
    "a"."name",
    "a"."type",
    "a"."location",
    "a"."year",
    "a"."make",
    "a"."model",
    "a"."trim",
    "a"."current_odometer",
    "a"."year_built",
    "a"."square_feet",
    "a"."beds",
    "a"."baths",
    "a"."lot_size_sqft",
    "a"."length_feet",
    "a"."engine_type",
    "a"."engine_hours",
    "a"."registration_number",
    "a"."hull_material",
    "a"."hero_image_url",
    "a"."hero_placement_id",
    ("a"."extra_metadata" -> 'publicConfig'::"text") AS "public_config",
    "a"."created_at",
    "owner_s"."user_id" AS "owner_id",
    COALESCE("p"."display_name", "p"."full_name", "p"."email") AS "owner_name",
    "a"."extra_metadata",
    ("a"."extra_metadata" ->> 'publicStoryNarrative'::"text") AS "public_story_narrative"
   FROM (("public"."assets" "a"
     LEFT JOIN LATERAL ( SELECT "s"."user_id"
           FROM "public"."asset_stewardships" "s"
          WHERE (("s"."asset_id" = "a"."id") AND ("s"."active" = true) AND ("s"."user_id" IS NOT NULL) AND ("s"."access_role" = ANY (ARRAY['owner'::"text", 'steward'::"text"])))
          ORDER BY
                CASE
                    WHEN ("s"."access_role" = 'owner'::"text") THEN 0
                    ELSE 1
                END, "s"."created_at"
         LIMIT 1) "owner_s" ON (true))
     LEFT JOIN "public"."profiles" "p" ON (("p"."id" = "owner_s"."user_id")))
  WHERE (("a"."kac_id" IS NOT NULL) AND ("a"."deleted_at" IS NULL));


ALTER VIEW "public"."public_asset_story_summary" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."public_asset_story_systems" AS
 SELECT "s"."id",
    "s"."asset_id",
    "a"."kac_id",
    "s"."name"
   FROM ("public"."systems" "s"
     JOIN "public"."assets" "a" ON (("a"."id" = "s"."asset_id")))
  WHERE (("a"."kac_id" IS NOT NULL) AND ("a"."deleted_at" IS NULL) AND ("a"."status" = 'active'::"text"));


ALTER VIEW "public"."public_asset_story_systems" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."public_asset_story_timeline" AS
 SELECT "sr"."id",
    "sr"."asset_id",
    "a"."kac_id",
    "sr"."title",
    "sr"."notes" AS "description",
    "sr"."performed_at",
    'service'::"text" AS "kind",
    true AS "verified",
    3 AS "document_count",
    12 AS "photo_count"
   FROM ("public"."service_records" "sr"
     JOIN "public"."assets" "a" ON (("a"."id" = "sr"."asset_id")))
  WHERE (("a"."kac_id" IS NOT NULL) AND ("a"."deleted_at" IS NULL) AND ("a"."status" = 'active'::"text"));


ALTER VIEW "public"."public_asset_story_timeline" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."public_asset_thread_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "thread_id" "uuid" NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "sender_email" "text" NOT NULL,
    "sender_name" "text",
    "token_hash" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "expires_at" timestamp with time zone,
    "revoked_at" timestamp with time zone,
    "last_used_at" timestamp with time zone
);


ALTER TABLE "public"."public_asset_thread_tokens" OWNER TO "postgres";


COMMENT ON TABLE "public"."public_asset_thread_tokens" IS 'Stores hashed opaque public sender conversation tokens. Raw tokens are never persisted.';



COMMENT ON COLUMN "public"."public_asset_thread_tokens"."token_hash" IS 'SHA-256 hash of the public sender conversation token.';



CREATE TABLE IF NOT EXISTS "public"."public_intake_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "public_link_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "ip_hash" "text",
    "user_agent" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."public_intake_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."public_links" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "token_hash" "text" NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "system_id" "uuid",
    "label" "text",
    "mode" "text" DEFAULT 'action'::"text" NOT NULL,
    "routine_template" "jsonb",
    "is_active" boolean DEFAULT true NOT NULL,
    "expires_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "public_links_mode_check" CHECK (("mode" = ANY (ARRAY['action'::"text", 'routine'::"text"])))
);


ALTER TABLE "public"."public_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reminder_attachments" (
    "reminder_id" "uuid" NOT NULL,
    "attachment_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."reminder_attachments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."reminders" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "notes" "text",
    "url" "text",
    "due_at" timestamp with time zone NOT NULL,
    "has_time" boolean DEFAULT true NOT NULL,
    "is_urgent" boolean DEFAULT false NOT NULL,
    "repeat_rule" "text",
    "status" "text" DEFAULT 'open'::"text" NOT NULL,
    "completed_at" timestamp with time zone,
    "asset_id" "uuid",
    "system_id" "uuid",
    "record_id" "uuid",
    "event_id" "uuid",
    "preferred_provider_id" "uuid",
    "notification_id" "text",
    "extra_metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."reminders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_entries" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "system_id" "uuid",
    "performed_by_role" "text" NOT NULL,
    "performed_by_user" "uuid",
    "ksc_code" "text",
    "external_service_code" "text",
    "notes" "text",
    "cost" numeric,
    "currency" "text" DEFAULT 'USD'::"text",
    "documents_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."service_entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_photos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "service_id" "uuid" NOT NULL,
    "storage_path" "text" NOT NULL,
    "caption" "text",
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."service_photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_record_documents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "asset_id" "uuid",
    "service_record_id" "uuid",
    "file_url" "text" NOT NULL,
    "source_type" "text" NOT NULL,
    "mime_type" "text",
    "uploaded_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "ai_raw_text" "text",
    "ai_parsed_json" "jsonb",
    "ai_model" "text",
    "ai_confidence" numeric(3,2),
    "verification_status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "error_message" "text",
    CONSTRAINT "service_record_documents_source_type_check" CHECK (("source_type" = ANY (ARRAY['upload_pdf'::"text", 'upload_image'::"text", 'email_forward'::"text", 'external'::"text"]))),
    CONSTRAINT "service_record_documents_verification_status_check" CHECK (("verification_status" = ANY (ARRAY['pending'::"text", 'verified'::"text", 'rejected'::"text"])))
);


ALTER TABLE "public"."service_record_documents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."service_record_photos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "service_record_id" "uuid" NOT NULL,
    "asset_id" "uuid",
    "url" "text" NOT NULL,
    "storage_path" "text" NOT NULL,
    "kind" "text" DEFAULT 'invoice'::"text" NOT NULL,
    "caption" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."service_record_photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."story_events" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "event_type" "text" NOT NULL,
    "title" "text",
    "description" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb",
    "occurred_at" timestamp with time zone DEFAULT "now"(),
    "created_at" timestamp with time zone DEFAULT "now"(),
    "source_type" "text" DEFAULT 'manual'::"text" NOT NULL,
    "service_record_id" "uuid",
    "system_id" "uuid",
    "ai_metadata" "jsonb"
);


ALTER TABLE "public"."story_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_photos" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "system_id" "uuid" NOT NULL,
    "owner_id" "uuid",
    "file_name" "text",
    "mime_type" "text",
    "storage_path" "text",
    "public_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."system_photos" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_readiness" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "system_id" "uuid" NOT NULL,
    "fuel_type" "text",
    "location" "text",
    "vent_type" "text",
    "has_floor_drain" boolean,
    "outlet_within_10ft" boolean,
    "breaker_distance_ft" numeric,
    "bathrooms" numeric,
    "occupants" numeric,
    "has_recirc_pump" boolean,
    "readiness_json" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."system_readiness" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_service_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "system_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "service_date" "date" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "pro_name" "text",
    "technician_name" "text",
    "cost" numeric,
    "notes" "text",
    "recommended_actions" "text",
    "category" "text",
    "tags" "text"[]
);


ALTER TABLE "public"."system_service_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_stewards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "system_id" "uuid" NOT NULL,
    "steward_entity_id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'steward'::"text" NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."system_stewards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."thumbnail_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "attachment_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "processed_at" timestamp with time zone
);


ALTER TABLE "public"."thumbnail_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."timeline_records" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "occurred_on" "date" NOT NULL,
    "odometer" integer,
    "type" "text" NOT NULL,
    "title" "text" NOT NULL,
    "notes" "text",
    "source_type" "text" DEFAULT 'manual'::"text" NOT NULL,
    "source_ref_id" "uuid",
    "attachment_id" "uuid",
    "scope" "public"."proposal_scope" DEFAULT 'current'::"public"."proposal_scope" NOT NULL,
    "confidence" "public"."confidence_level" DEFAULT 'derived'::"public"."confidence_level" NOT NULL,
    "is_locked" boolean DEFAULT false NOT NULL,
    "dedupe_key" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."timeline_records" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."user_entitlements" (
    "user_id" "uuid" NOT NULL,
    "plan" "text" DEFAULT 'starter'::"text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."user_entitlements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."vehicle_systems" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "asset_id" "uuid" NOT NULL,
    "system_type" "text" NOT NULL,
    "name" "text" NOT NULL,
    "manufacturer" "text",
    "model" "text",
    "serial_number" "text",
    "year" integer,
    "hours" numeric,
    "notes" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "system_id" "uuid"
);


ALTER TABLE "public"."vehicle_systems" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."warranty_requirements" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "warranty_object_id" "uuid" NOT NULL,
    "requirement_name" "text" NOT NULL,
    "requirement_kind" "text" NOT NULL,
    "cadence_type" "text" NOT NULL,
    "interval_value" integer,
    "interval_unit" "text",
    "grace_days" integer,
    "proof_required" boolean DEFAULT true NOT NULL,
    "proof_spec" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "notes" "text",
    "enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."warranty_requirements" OWNER TO "postgres";




ALTER TABLE ONLY "public"."environment_profiles" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."environment_profiles_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."maturity_requirements" ALTER COLUMN "id" SET DEFAULT "nextval"('"public"."maturity_requirements_id_seq"'::"regclass");



ALTER TABLE ONLY "public"."action_proposals"
    ADD CONSTRAINT "action_proposals_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."action_types"
    ADD CONSTRAINT "action_types_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."actions"
    ADD CONSTRAINT "actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_engagement_events"
    ADD CONSTRAINT "asset_engagement_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_files"
    ADD CONSTRAINT "asset_files_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_identifiers"
    ADD CONSTRAINT "asset_identifiers_kind_value_key" UNIQUE ("kind", "value");



ALTER TABLE ONLY "public"."asset_identifiers"
    ADD CONSTRAINT "asset_identifiers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_members"
    ADD CONSTRAINT "asset_members_asset_id_user_id_key" UNIQUE ("asset_id", "user_id");



ALTER TABLE ONLY "public"."asset_members"
    ADD CONSTRAINT "asset_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_photos"
    ADD CONSTRAINT "asset_photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_stewards"
    ADD CONSTRAINT "asset_stewards_master_asset_id_user_id_started_at_key" UNIQUE ("master_asset_id", "user_id", "started_at");



ALTER TABLE ONLY "public"."asset_stewards"
    ADD CONSTRAINT "asset_stewards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_stewardships"
    ADD CONSTRAINT "asset_stewardships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_thread_messages"
    ADD CONSTRAINT "asset_thread_messages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_threads"
    ADD CONSTRAINT "asset_threads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_transfers"
    ADD CONSTRAINT "asset_transfers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."asset_transfers"
    ADD CONSTRAINT "asset_transfers_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."assurance_records"
    ADD CONSTRAINT "assurance_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attachment_links"
    ADD CONSTRAINT "attachment_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attachment_meta"
    ADD CONSTRAINT "attachment_meta_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attachment_placements"
    ADD CONSTRAINT "attachment_placements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."attachments"
    ADD CONSTRAINT "attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."boat_systems"
    ADD CONSTRAINT "boat_systems_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."email_intake_addresses"
    ADD CONSTRAINT "email_intake_addresses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."enrichment_runs"
    ADD CONSTRAINT "enrichment_runs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."environment_profiles"
    ADD CONSTRAINT "environment_profiles_key_key" UNIQUE ("key");



ALTER TABLE ONLY "public"."environment_profiles"
    ADD CONSTRAINT "environment_profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_inbox_attachments"
    ADD CONSTRAINT "event_inbox_attachments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."event_inbox"
    ADD CONSTRAINT "event_inbox_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."home_system_photos"
    ADD CONSTRAINT "home_system_photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."home_systems"
    ADD CONSTRAINT "home_systems_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hub_members"
    ADD CONSTRAINT "hub_members_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hub_story_links"
    ADD CONSTRAINT "hub_story_links_hub_id_asset_id_key" UNIQUE ("hub_id", "asset_id");



ALTER TABLE ONLY "public"."hub_story_links"
    ADD CONSTRAINT "hub_story_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hub_story_requests"
    ADD CONSTRAINT "hub_story_requests_hub_id_asset_id_requester_id_key" UNIQUE ("hub_id", "asset_id", "requester_id");



ALTER TABLE ONLY "public"."hub_story_requests"
    ADD CONSTRAINT "hub_story_requests_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hubs"
    ADD CONSTRAINT "hubs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."hubs"
    ADD CONSTRAINT "hubs_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."inbox_items"
    ADD CONSTRAINT "inbox_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invite_events"
    ADD CONSTRAINT "invite_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."keepr_pros"
    ADD CONSTRAINT "keepr_pros_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."loose_notes"
    ADD CONSTRAINT "loose_notes_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."maintenance_events"
    ADD CONSTRAINT "maintenance_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."maintenance_reminders"
    ADD CONSTRAINT "maintenance_reminders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."master_assets"
    ADD CONSTRAINT "master_assets_kac_key" UNIQUE ("kac");



ALTER TABLE ONLY "public"."master_assets"
    ADD CONSTRAINT "master_assets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."maturity_requirements"
    ADD CONSTRAINT "maturity_requirements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."object_actions"
    ADD CONSTRAINT "object_actions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."object_attachments"
    ADD CONSTRAINT "object_attachments_pkey" PRIMARY KEY ("object_id", "attachment_id");



ALTER TABLE ONLY "public"."object_links"
    ADD CONSTRAINT "object_links_pkey" PRIMARY KEY ("object_id", "asset_id", "system_id");



ALTER TABLE ONLY "public"."object_type_actions"
    ADD CONSTRAINT "object_type_actions_pkey" PRIMARY KEY ("object_type_key", "action_type_key");



ALTER TABLE ONLY "public"."object_types"
    ADD CONSTRAINT "object_types_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."objects"
    ADD CONSTRAINT "objects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."odometer_anchors"
    ADD CONSTRAINT "odometer_anchors_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."org_members"
    ADD CONSTRAINT "org_members_pkey" PRIMARY KEY ("org_id", "user_id");



ALTER TABLE ONLY "public"."orgs"
    ADD CONSTRAINT "orgs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ownership_bands"
    ADD CONSTRAINT "ownership_bands_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."package_artifacts"
    ADD CONSTRAINT "package_artifacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."package_rows"
    ADD CONSTRAINT "package_rows_package_id_row_index_key" UNIQUE ("package_id", "row_index");



ALTER TABLE ONLY "public"."package_rows"
    ADD CONSTRAINT "package_rows_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."public_asset_thread_tokens"
    ADD CONSTRAINT "public_asset_thread_tokens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."public_asset_thread_tokens"
    ADD CONSTRAINT "public_asset_thread_tokens_token_hash_key" UNIQUE ("token_hash");



ALTER TABLE ONLY "public"."public_intake_events"
    ADD CONSTRAINT "public_intake_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."public_links"
    ADD CONSTRAINT "public_links_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."reminder_attachments"
    ADD CONSTRAINT "reminder_attachments_pkey" PRIMARY KEY ("reminder_id", "attachment_id");



ALTER TABLE ONLY "public"."reminders"
    ADD CONSTRAINT "reminders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_entries"
    ADD CONSTRAINT "service_entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_photos"
    ADD CONSTRAINT "service_photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_record_documents"
    ADD CONSTRAINT "service_record_documents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_record_photos"
    ADD CONSTRAINT "service_record_photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."service_records"
    ADD CONSTRAINT "service_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."story_events"
    ADD CONSTRAINT "story_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_photos"
    ADD CONSTRAINT "system_photos_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_readiness"
    ADD CONSTRAINT "system_readiness_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_readiness"
    ADD CONSTRAINT "system_readiness_system_id_key" UNIQUE ("system_id");



ALTER TABLE ONLY "public"."system_service_records"
    ADD CONSTRAINT "system_service_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_stewards"
    ADD CONSTRAINT "system_stewards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_stewards"
    ADD CONSTRAINT "system_stewards_system_id_key" UNIQUE ("system_id");



ALTER TABLE ONLY "public"."systems"
    ADD CONSTRAINT "systems_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."thumbnail_jobs"
    ADD CONSTRAINT "thumbnail_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."timeline_records"
    ADD CONSTRAINT "timeline_records_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_entitlements"
    ADD CONSTRAINT "user_entitlements_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."vehicle_systems"
    ADD CONSTRAINT "vehicle_systems_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."warranty_requirements"
    ADD CONSTRAINT "warranty_requirements_pkey" PRIMARY KEY ("id");


CREATE INDEX "action_proposals_asset_status_idx" ON "public"."action_proposals" USING "btree" ("asset_id", "status", "created_at" DESC);



CREATE UNIQUE INDEX "action_proposals_dedupe_unique" ON "public"."action_proposals" USING "btree" ("asset_id", "action_type_key", "dedupe_key") WHERE ("dedupe_key" IS NOT NULL);



CREATE INDEX "action_proposals_object_action_idx" ON "public"."action_proposals" USING "btree" ("object_type_key", "action_type_key");



CREATE INDEX "action_proposals_run_idx" ON "public"."action_proposals" USING "btree" ("enrichment_run_id");



CREATE INDEX "action_types_enabled_idx" ON "public"."action_types" USING "btree" ("enabled");



CREATE INDEX "aee_action_idx" ON "public"."asset_engagement_events" USING "btree" ("action");



CREATE INDEX "aee_actor_user_idx" ON "public"."asset_engagement_events" USING "btree" ("actor_user_id", "created_at" DESC);



CREATE INDEX "aee_master_idx" ON "public"."asset_engagement_events" USING "btree" ("master_asset_id", "created_at" DESC);



CREATE UNIQUE INDEX "asset_files_bucket_object_path_uidx" ON "public"."asset_files" USING "btree" ("bucket", "object_path");



CREATE INDEX "asset_files_link_idx" ON "public"."asset_files" USING "btree" ("linked_type", "linked_id");



CREATE INDEX "asset_files_master_idx" ON "public"."asset_files" USING "btree" ("master_asset_id", "created_at" DESC);



CREATE UNIQUE INDEX "asset_identifiers_unique" ON "public"."asset_identifiers" USING "btree" ("lower"("kind"), "lower"("value"));



CREATE INDEX "asset_photos_asset_id_idx" ON "public"."asset_photos" USING "btree" ("asset_id");



CREATE INDEX "asset_stewards_active_idx" ON "public"."asset_stewards" USING "btree" ("master_asset_id") WHERE ("ended_at" IS NULL);



CREATE INDEX "asset_stewards_master_idx" ON "public"."asset_stewards" USING "btree" ("master_asset_id");



CREATE INDEX "asset_stewards_user_idx" ON "public"."asset_stewards" USING "btree" ("user_id");



CREATE INDEX "assets_asset_mode_idx" ON "public"."assets" USING "btree" ("asset_mode");



CREATE INDEX "at_master_idx" ON "public"."asset_transfers" USING "btree" ("master_asset_id", "created_at" DESC);



CREATE INDEX "at_status_idx" ON "public"."asset_transfers" USING "btree" ("status");



CREATE INDEX "at_to_email_idx" ON "public"."asset_transfers" USING "btree" ("lower"("to_email"));



CREATE INDEX "attachment_links_asset_id_idx" ON "public"."attachment_links" USING "btree" ("asset_id");



CREATE INDEX "attachment_links_service_record_id_idx" ON "public"."attachment_links" USING "btree" ("service_record_id");



CREATE INDEX "attachment_links_system_id_idx" ON "public"."attachment_links" USING "btree" ("system_id");



CREATE INDEX "attachment_meta_asset_id_idx" ON "public"."attachment_meta" USING "btree" ("asset_id");



CREATE UNIQUE INDEX "attachment_meta_bucket_path_idx" ON "public"."attachment_meta" USING "btree" ("bucket", "path");



CREATE INDEX "attachment_placements_attachment_id_idx" ON "public"."attachment_placements" USING "btree" ("attachment_id");



CREATE INDEX "attachment_placements_target_idx" ON "public"."attachment_placements" USING "btree" ("target_type", "target_id");



CREATE UNIQUE INDEX "attachment_placements_unique_idx" ON "public"."attachment_placements" USING "btree" ("attachment_id", "target_type", "target_id", COALESCE("role", ''::"text"));



CREATE UNIQUE INDEX "attachment_placements_unique_triplet" ON "public"."attachment_placements" USING "btree" ("attachment_id", "target_type", "target_id");



CREATE INDEX "attachments_asset_id_idx" ON "public"."attachments" USING "btree" ("asset_id");



CREATE INDEX "attachments_doc_type_idx" ON "public"."attachments" USING "btree" ("doc_type");



CREATE INDEX "attachments_not_deleted_idx" ON "public"."attachments" USING "btree" ("owner_user_id", "created_at") WHERE ("deleted_at" IS NULL);



CREATE INDEX "attachments_ocr_status_idx" ON "public"."attachments" USING "btree" ("ocr_status");



CREATE INDEX "attachments_org_id_idx" ON "public"."attachments" USING "btree" ("org_id");



CREATE INDEX "attachments_owner_user_id_idx" ON "public"."attachments" USING "btree" ("owner_user_id");



CREATE INDEX "attachments_search_vector_gin" ON "public"."attachments" USING "gin" ("search_vector");



CREATE INDEX "attachments_tags_gin" ON "public"."attachments" USING "gin" ("tags");



CREATE UNIQUE INDEX "email_intake_owner_unique" ON "public"."email_intake_addresses" USING "btree" ("owner_id");



CREATE UNIQUE INDEX "email_intake_token_unique" ON "public"."email_intake_addresses" USING "btree" ("lower"("token"));



CREATE INDEX "enrichment_runs_asset_idx" ON "public"."enrichment_runs" USING "btree" ("asset_id", "created_at" DESC);



CREATE INDEX "enrichment_runs_attachment_idx" ON "public"."enrichment_runs" USING "btree" ("attachment_id");



CREATE INDEX "enrichment_runs_connector_key_idx" ON "public"."enrichment_runs" USING "btree" ("connector_key");



CREATE INDEX "enrichment_runs_object_type_idx" ON "public"."enrichment_runs" USING "btree" ("object_type_key");



CREATE INDEX "enrichment_runs_status_idx" ON "public"."enrichment_runs" USING "btree" ("status");



CREATE INDEX "event_inbox_asset_id_idx" ON "public"."event_inbox" USING "btree" ("asset_id");



CREATE INDEX "event_inbox_attach_event_idx" ON "public"."event_inbox_attachments" USING "btree" ("event_id");



CREATE INDEX "event_inbox_owner_idx" ON "public"."event_inbox" USING "btree" ("owner_id");



CREATE INDEX "event_inbox_owner_origin_status_idx" ON "public"."event_inbox" USING "btree" ("owner_id", "origin_type", "status", "created_at" DESC);



CREATE INDEX "event_inbox_owner_source_idx" ON "public"."event_inbox" USING "btree" ("owner_id", "source_type", "created_at" DESC);



CREATE INDEX "event_inbox_status_idx" ON "public"."event_inbox" USING "btree" ("status");



CREATE INDEX "idx_asset_stewardships_asset" ON "public"."asset_stewardships" USING "btree" ("asset_id");



CREATE INDEX "idx_asset_stewardships_org" ON "public"."asset_stewardships" USING "btree" ("org_id");



CREATE INDEX "idx_asset_stewardships_user" ON "public"."asset_stewardships" USING "btree" ("user_id");



CREATE INDEX "idx_assets_deleted_at" ON "public"."assets" USING "btree" ("deleted_at");



CREATE INDEX "idx_assets_master_asset_id" ON "public"."assets" USING "btree" ("master_asset_id");



CREATE INDEX "idx_assets_owner" ON "public"."assets" USING "btree" ("owner_id");



CREATE INDEX "idx_assets_sort_rank" ON "public"."assets" USING "btree" ("sort_rank");



CREATE INDEX "idx_attachment_placements_id" ON "public"."attachment_placements" USING "btree" ("id");



CREATE INDEX "idx_attachments_privacy" ON "public"."attachments" USING "btree" ("privacy");



CREATE INDEX "idx_boat_systems_asset_id" ON "public"."boat_systems" USING "btree" ("asset_id");



CREATE INDEX "idx_boat_systems_system_id" ON "public"."boat_systems" USING "btree" ("system_id");



CREATE INDEX "idx_event_inbox_home_system_id" ON "public"."event_inbox" USING "btree" ("home_system_id");



CREATE INDEX "idx_home_systems_system_id" ON "public"."home_systems" USING "btree" ("system_id");



CREATE INDEX "idx_keepr_pros_category" ON "public"."keepr_pros" USING "btree" ("category");



CREATE INDEX "idx_keepr_pros_name" ON "public"."keepr_pros" USING "btree" ("name");



CREATE INDEX "idx_locations_asset_active" ON "public"."locations" USING "btree" ("asset_id", "active");



CREATE INDEX "idx_notifications_unread" ON "public"."notifications" USING "btree" ("user_id", "read_at");



CREATE INDEX "idx_notifications_user" ON "public"."notifications" USING "btree" ("user_id");



CREATE INDEX "idx_photos_asset" ON "public"."photos" USING "btree" ("asset_id");



CREATE INDEX "idx_service_asset" ON "public"."service_entries" USING "btree" ("asset_id");



CREATE INDEX "idx_service_record_documents_asset" ON "public"."service_record_documents" USING "btree" ("asset_id");



CREATE INDEX "idx_service_record_documents_service_record" ON "public"."service_record_documents" USING "btree" ("service_record_id");



CREATE INDEX "idx_service_record_documents_user" ON "public"."service_record_documents" USING "btree" ("user_id");



CREATE INDEX "idx_service_records_asset" ON "public"."service_records" USING "btree" ("asset_id");



CREATE INDEX "idx_service_records_performed_at" ON "public"."service_records" USING "btree" ("performed_at");



CREATE INDEX "idx_service_records_pro" ON "public"."service_records" USING "btree" ("keepr_pro_id");



CREATE INDEX "idx_service_records_scope" ON "public"."service_records" USING "btree" ("asset_id", "record_scope", "performed_at" DESC);



CREATE INDEX "idx_service_records_source" ON "public"."service_records" USING "btree" ("asset_id", "source_type", "performed_at" DESC);



CREATE INDEX "idx_service_records_system" ON "public"."service_records" USING "btree" ("system_id");



CREATE INDEX "idx_story_asset" ON "public"."story_events" USING "btree" ("asset_id");



CREATE INDEX "idx_system_readiness_asset_id" ON "public"."system_readiness" USING "btree" ("asset_id");



CREATE INDEX "idx_system_readiness_json_gin" ON "public"."system_readiness" USING "gin" ("readiness_json");



CREATE INDEX "idx_system_readiness_system_id" ON "public"."system_readiness" USING "btree" ("system_id");



CREATE INDEX "idx_system_stewards_asset" ON "public"."system_stewards" USING "btree" ("asset_id");



CREATE INDEX "idx_system_stewards_system" ON "public"."system_stewards" USING "btree" ("system_id");



CREATE INDEX "idx_systems_asset" ON "public"."systems" USING "btree" ("asset_id");



CREATE INDEX "idx_systems_lifecycle_status" ON "public"."systems" USING "btree" ("lifecycle_status");



CREATE INDEX "idx_vehicle_systems_system_id" ON "public"."vehicle_systems" USING "btree" ("system_id");



CREATE INDEX "inbox_items_status_idx" ON "public"."inbox_items" USING "btree" ("status");



CREATE INDEX "inbox_items_to_email_idx" ON "public"."inbox_items" USING "btree" ("lower"("to_email"));



CREATE INDEX "inbox_items_to_user_id_idx" ON "public"."inbox_items" USING "btree" ("to_user_id");



CREATE INDEX "inbox_items_type_idx" ON "public"."inbox_items" USING "btree" ("type");



CREATE INDEX "invite_events_inviter_idx" ON "public"."invite_events" USING "btree" ("inviter_user_id");



CREATE INDEX "invite_events_slug_idx" ON "public"."invite_events" USING "btree" ("invite_slug");



CREATE INDEX "invite_events_type_idx" ON "public"."invite_events" USING "btree" ("event_type");



CREATE INDEX "master_assets_hin_idx" ON "public"."master_assets" USING "btree" ("hin");



CREATE INDEX "master_assets_kac_idx" ON "public"."master_assets" USING "btree" ("kac");



CREATE INDEX "master_assets_type_idx" ON "public"."master_assets" USING "btree" ("asset_type");



CREATE INDEX "master_assets_vin_idx" ON "public"."master_assets" USING "btree" ("vin");



CREATE UNIQUE INDEX "mr_unique" ON "public"."maturity_requirements" USING "btree" ("asset_type", "system_type", "purpose", "key");



CREATE INDEX "object_actions_due_idx" ON "public"."object_actions" USING "btree" ("org_id", "status", "due_at");



CREATE INDEX "object_actions_org_idx" ON "public"."object_actions" USING "btree" ("org_id");



CREATE INDEX "object_attachments_org_idx" ON "public"."object_attachments" USING "btree" ("org_id");



CREATE INDEX "object_attachments_role_idx" ON "public"."object_attachments" USING "btree" ("role");



CREATE INDEX "object_links_org_asset_idx" ON "public"."object_links" USING "btree" ("org_id", "asset_id");



CREATE INDEX "object_links_org_system_idx" ON "public"."object_links" USING "btree" ("org_id", "system_id");



CREATE INDEX "object_type_actions_enabled_idx" ON "public"."object_type_actions" USING "btree" ("object_type_key", "enabled");



CREATE INDEX "object_types_enabled_idx" ON "public"."object_types" USING "btree" ("enabled");



CREATE INDEX "objects_org_idx" ON "public"."objects" USING "btree" ("org_id");



CREATE INDEX "objects_status_idx" ON "public"."objects" USING "btree" ("org_id", "status");



CREATE INDEX "objects_type_idx" ON "public"."objects" USING "btree" ("object_type_key");



CREATE INDEX "odometer_anchors_asset_idx" ON "public"."odometer_anchors" USING "btree" ("asset_id", "odometer" DESC);



CREATE UNIQUE INDEX "odometer_anchors_dedupe_unique" ON "public"."odometer_anchors" USING "btree" ("asset_id", "dedupe_key") WHERE ("dedupe_key" IS NOT NULL);



CREATE UNIQUE INDEX "org_members_org_user_unique" ON "public"."org_members" USING "btree" ("org_id", "user_id");



CREATE INDEX "ownership_bands_asset_idx" ON "public"."ownership_bands" USING "btree" ("asset_id", "band_start");



CREATE UNIQUE INDEX "ownership_bands_dedupe_unique" ON "public"."ownership_bands" USING "btree" ("asset_id", "dedupe_key") WHERE ("dedupe_key" IS NOT NULL);



CREATE INDEX "package_artifacts_pkg_idx" ON "public"."package_artifacts" USING "btree" ("package_id");



CREATE INDEX "package_rows_pkg_idx" ON "public"."package_rows" USING "btree" ("package_id");



CREATE INDEX "packages_asset_id_idx" ON "public"."packages" USING "btree" ("asset_id");



CREATE INDEX "packages_type_idx" ON "public"."packages" USING "btree" ("package_type");



CREATE UNIQUE INDEX "profiles_email_unique" ON "public"."profiles" USING "btree" ("email") WHERE ("email" IS NOT NULL);



CREATE UNIQUE INDEX "profiles_inbox_name_unique" ON "public"."profiles" USING "btree" ("lower"("inbox_name")) WHERE ("inbox_name" IS NOT NULL);



CREATE INDEX "profiles_onboarding_state_idx" ON "public"."profiles" USING "btree" ("onboarding_state");



CREATE INDEX "public_asset_thread_tokens_asset_id_idx" ON "public"."public_asset_thread_tokens" USING "btree" ("asset_id");



CREATE INDEX "public_asset_thread_tokens_thread_id_idx" ON "public"."public_asset_thread_tokens" USING "btree" ("thread_id");



CREATE INDEX "public_intake_events_link_idx" ON "public"."public_intake_events" USING "btree" ("public_link_id", "created_at" DESC);



CREATE INDEX "public_links_asset_idx" ON "public"."public_links" USING "btree" ("asset_id");



CREATE UNIQUE INDEX "public_links_token_hash_idx" ON "public"."public_links" USING "btree" ("token_hash");



CREATE INDEX "reminder_attachments_attachment_idx" ON "public"."reminder_attachments" USING "btree" ("attachment_id");



CREATE INDEX "reminders_due_idx" ON "public"."reminders" USING "btree" ("owner_id", "due_at");



CREATE INDEX "reminders_owner_idx" ON "public"."reminders" USING "btree" ("owner_id");



CREATE INDEX "reminders_status_idx" ON "public"."reminders" USING "btree" ("owner_id", "status");



CREATE INDEX "service_record_photos_asset_id_idx" ON "public"."service_record_photos" USING "btree" ("asset_id");



CREATE INDEX "service_record_photos_record_id_idx" ON "public"."service_record_photos" USING "btree" ("service_record_id");



CREATE INDEX "system_readiness_json_gin" ON "public"."system_readiness" USING "gin" ("readiness_json");



CREATE INDEX "system_readiness_system_idx" ON "public"."system_readiness" USING "btree" ("system_id");



CREATE INDEX "system_readiness_user_asset_idx" ON "public"."system_readiness" USING "btree" ("user_id", "asset_id");



CREATE INDEX "systems_name_idx" ON "public"."systems" USING "btree" ("name");



CREATE UNIQUE INDEX "thumbnail_jobs_attachment_pending_idx" ON "public"."thumbnail_jobs" USING "btree" ("attachment_id") WHERE ("status" = 'pending'::"text");



CREATE INDEX "thumbnail_jobs_status_created_idx" ON "public"."thumbnail_jobs" USING "btree" ("status", "created_at");



CREATE INDEX "timeline_records_asset_date_idx" ON "public"."timeline_records" USING "btree" ("asset_id", "occurred_on" DESC);



CREATE INDEX "timeline_records_asset_scope_idx" ON "public"."timeline_records" USING "btree" ("asset_id", "scope", "occurred_on" DESC);



CREATE UNIQUE INDEX "timeline_records_dedupe_unique" ON "public"."timeline_records" USING "btree" ("asset_id", "dedupe_key") WHERE ("dedupe_key" IS NOT NULL);



CREATE INDEX "user_entitlements_plan_idx" ON "public"."user_entitlements" USING "btree" ("plan");



CREATE UNIQUE INDEX "ux_assets_kac_id" ON "public"."assets" USING "btree" ("kac_id") WHERE ("kac_id" IS NOT NULL);



CREATE UNIQUE INDEX "ux_event_inbox_owner_message_id" ON "public"."event_inbox" USING "btree" ("owner_id", "message_id") WHERE ("message_id" IS NOT NULL);



CREATE UNIQUE INDEX "ux_orgs_owner_user_id" ON "public"."orgs" USING "btree" ("owner_user_id") WHERE ("owner_user_id" IS NOT NULL);



CREATE UNIQUE INDEX "ux_profiles_username" ON "public"."profiles" USING "btree" ("lower"("username")) WHERE ("username" IS NOT NULL);



CREATE UNIQUE INDEX "ux_service_records_asset_dedupe" ON "public"."service_records" USING "btree" ("asset_id", "dedupe_key") WHERE ("dedupe_key" IS NOT NULL);



CREATE INDEX "vehicle_systems_asset_id_idx" ON "public"."vehicle_systems" USING "btree" ("asset_id");



CREATE INDEX "warranty_req_obj_idx" ON "public"."warranty_requirements" USING "btree" ("warranty_object_id", "enabled");



CREATE INDEX "warranty_req_org_idx" ON "public"."warranty_requirements" USING "btree" ("org_id");






CREATE OR REPLACE VIEW "public"."admin_asset_story_summary" AS
 SELECT "a"."id" AS "asset_id",
    "a"."kac_id",
    "a"."owner_id" AS "user_id",
    "a"."name",
    "a"."type",
    "a"."status",
    "a"."created_at",
    "count"(DISTINCT "s"."id") AS "system_count",
    "count"(DISTINCT "sr"."id") AS "service_record_count",
    "max"("sr"."created_at") AS "last_service_at",
    "count"(DISTINCT "att"."id") FILTER (WHERE ("att"."deleted_at" IS NULL)) AS "attachment_count"
   FROM ((("public"."assets" "a"
     LEFT JOIN "public"."systems" "s" ON (("s"."asset_id" = "a"."id")))
     LEFT JOIN "public"."service_records" "sr" ON (("sr"."asset_id" = "a"."id")))
     LEFT JOIN "public"."attachments" "att" ON (("att"."asset_id" = "a"."id")))
  WHERE ("a"."deleted_at" IS NULL)
  GROUP BY "a"."id";



CREATE OR REPLACE VIEW "public"."admin_system_story_summary" AS
 SELECT "s"."id" AS "system_id",
    "s"."asset_id",
    "a"."owner_id" AS "user_id",
    "s"."name",
    "s"."system_type",
    "s"."status",
    "s"."lifecycle_status",
    "s"."mode",
    "s"."created_at",
    "count"("sr"."id") AS "service_record_count",
    "max"("sr"."performed_at") AS "last_service_date"
   FROM (("public"."systems" "s"
     JOIN "public"."assets" "a" ON (("a"."id" = "s"."asset_id")))
     LEFT JOIN "public"."service_records" "sr" ON (("sr"."system_id" = "s"."id")))
  WHERE ("a"."deleted_at" IS NULL)
  GROUP BY "s"."id", "a"."owner_id";



CREATE OR REPLACE VIEW "public"."admin_user_assets" AS
 SELECT "a"."id" AS "asset_id",
    "a"."owner_id" AS "user_id",
    "a"."kac_id",
    "a"."name",
    "a"."type",
    "a"."status",
    "a"."created_at",
    "count"("s"."id") AS "system_count",
    "count"("sr"."id") AS "service_record_count"
   FROM (("public"."assets" "a"
     LEFT JOIN "public"."systems" "s" ON (("s"."asset_id" = "a"."id")))
     LEFT JOIN "public"."service_records" "sr" ON (("sr"."asset_id" = "a"."id")))
  WHERE ("a"."deleted_at" IS NULL)
  GROUP BY "a"."id";



CREATE OR REPLACE TRIGGER "keepr_pros_set_updated_at" BEFORE UPDATE ON "public"."keepr_pros" FOR EACH ROW EXECUTE FUNCTION "public"."set_current_timestamp_updated_at"();



CREATE OR REPLACE TRIGGER "trg_action_proposals_updated_at" BEFORE UPDATE ON "public"."action_proposals" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_action_types_updated_at" BEFORE UPDATE ON "public"."action_types" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_add_org_creator_as_owner" AFTER INSERT ON "public"."orgs" FOR EACH ROW EXECUTE FUNCTION "public"."add_org_creator_as_owner"();

ALTER TABLE "public"."orgs" DISABLE TRIGGER "trg_add_org_creator_as_owner";



CREATE OR REPLACE TRIGGER "trg_asset_owner_stewardship" AFTER INSERT ON "public"."assets" FOR EACH ROW EXECUTE FUNCTION "public"."ensure_asset_owner_stewardship"();



CREATE OR REPLACE TRIGGER "trg_attachment_meta_updated_at" BEFORE UPDATE ON "public"."attachment_meta" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_enforce_org_member_limit" BEFORE INSERT ON "public"."org_members" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_org_member_limit"();



CREATE OR REPLACE TRIGGER "trg_enrichment_runs_updated_at" BEFORE UPDATE ON "public"."enrichment_runs" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_ensure_asset_attachment_placement" AFTER INSERT OR UPDATE OF "asset_id", "deleted_at" ON "public"."attachments" FOR EACH ROW EXECUTE FUNCTION "public"."ensure_asset_attachment_placement"();



CREATE OR REPLACE TRIGGER "trg_keepr_enforce_asset_limit" BEFORE INSERT ON "public"."assets" FOR EACH ROW EXECUTE FUNCTION "public"."keepr_enforce_asset_limit"();



CREATE OR REPLACE TRIGGER "trg_keepr_enforce_plan_downgrade_storage" BEFORE UPDATE OF "plan" ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."keepr_enforce_plan_downgrade_storage"();



CREATE OR REPLACE TRIGGER "trg_keepr_enforce_systems_per_asset_limit" BEFORE INSERT ON "public"."systems" FOR EACH ROW EXECUTE FUNCTION "public"."keepr_enforce_systems_per_asset_limit"();



CREATE OR REPLACE TRIGGER "trg_keepr_protect_profile_sensitive_fields" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."keepr_protect_profile_sensitive_fields"();



CREATE OR REPLACE TRIGGER "trg_master_assets_updated_at" BEFORE UPDATE ON "public"."master_assets" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_object_actions_updated_at" BEFORE UPDATE ON "public"."object_actions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_object_type_actions_updated_at" BEFORE UPDATE ON "public"."object_type_actions" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_object_types_updated_at" BEFORE UPDATE ON "public"."object_types" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_objects_updated_at" BEFORE UPDATE ON "public"."objects" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_odometer_anchors_updated_at" BEFORE UPDATE ON "public"."odometer_anchors" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_ownership_bands_updated_at" BEFORE UPDATE ON "public"."ownership_bands" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_profiles_updated_at" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_set_attachment_org_id" BEFORE INSERT OR UPDATE OF "asset_id" ON "public"."attachments" FOR EACH ROW EXECUTE FUNCTION "public"."set_attachment_org_id_from_stewardship"();



CREATE OR REPLACE TRIGGER "trg_system_readiness_set_user_id" BEFORE INSERT ON "public"."system_readiness" FOR EACH ROW EXECUTE FUNCTION "public"."system_readiness_set_user_id"();



CREATE OR REPLACE TRIGGER "trg_timeline_records_updated_at" BEFORE UPDATE ON "public"."timeline_records" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_warranty_requirements_updated_at" BEFORE UPDATE ON "public"."warranty_requirements" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();






ALTER TABLE ONLY "public"."action_proposals"
    ADD CONSTRAINT "action_proposals_action_type_key_fkey" FOREIGN KEY ("action_type_key") REFERENCES "public"."action_types"("key");



ALTER TABLE ONLY "public"."action_proposals"
    ADD CONSTRAINT "action_proposals_enrichment_run_id_fkey" FOREIGN KEY ("enrichment_run_id") REFERENCES "public"."enrichment_runs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."action_proposals"
    ADD CONSTRAINT "action_proposals_object_type_key_fkey" FOREIGN KEY ("object_type_key") REFERENCES "public"."object_types"("key");



ALTER TABLE ONLY "public"."actions"
    ADD CONSTRAINT "actions_assigned_to_user_id_fkey" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."actions"
    ADD CONSTRAINT "actions_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."profiles"("id");



ALTER TABLE ONLY "public"."asset_engagement_events"
    ADD CONSTRAINT "asset_engagement_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."asset_engagement_events"
    ADD CONSTRAINT "asset_engagement_events_master_asset_id_fkey" FOREIGN KEY ("master_asset_id") REFERENCES "public"."master_assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_files"
    ADD CONSTRAINT "asset_files_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."asset_files"
    ADD CONSTRAINT "asset_files_master_asset_id_fkey" FOREIGN KEY ("master_asset_id") REFERENCES "public"."master_assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_identifiers"
    ADD CONSTRAINT "asset_identifiers_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_members"
    ADD CONSTRAINT "asset_members_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_members"
    ADD CONSTRAINT "asset_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_photos"
    ADD CONSTRAINT "asset_photos_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_photos"
    ADD CONSTRAINT "asset_photos_service_record_id_fkey" FOREIGN KEY ("service_record_id") REFERENCES "public"."service_records"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."asset_stewards"
    ADD CONSTRAINT "asset_stewards_master_asset_id_fkey" FOREIGN KEY ("master_asset_id") REFERENCES "public"."master_assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_stewards"
    ADD CONSTRAINT "asset_stewards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_stewardships"
    ADD CONSTRAINT "asset_stewardships_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_stewardships"
    ADD CONSTRAINT "asset_stewardships_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_stewardships"
    ADD CONSTRAINT "asset_stewardships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_thread_messages"
    ADD CONSTRAINT "asset_thread_messages_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_thread_messages"
    ADD CONSTRAINT "asset_thread_messages_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."asset_threads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_threads"
    ADD CONSTRAINT "asset_threads_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_threads"
    ADD CONSTRAINT "asset_threads_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_threads"
    ADD CONSTRAINT "asset_threads_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "public"."hubs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."asset_threads"
    ADD CONSTRAINT "asset_threads_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_transfers"
    ADD CONSTRAINT "asset_transfers_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."asset_transfers"
    ADD CONSTRAINT "asset_transfers_master_asset_id_fkey" FOREIGN KEY ("master_asset_id") REFERENCES "public"."master_assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."asset_transfers"
    ADD CONSTRAINT "asset_transfers_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_master_asset_id_fkey" FOREIGN KEY ("master_asset_id") REFERENCES "public"."master_assets"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."assets"
    ADD CONSTRAINT "assets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attachment_links"
    ADD CONSTRAINT "attachment_links_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attachment_placements"
    ADD CONSTRAINT "attachment_placements_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."attachments"
    ADD CONSTRAINT "attachments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."boat_systems"
    ADD CONSTRAINT "boat_systems_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."boat_systems"
    ADD CONSTRAINT "boat_systems_system_id_fkey" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."email_intake_addresses"
    ADD CONSTRAINT "email_intake_addresses_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."enrichment_runs"
    ADD CONSTRAINT "enrichment_runs_object_type_key_fkey" FOREIGN KEY ("object_type_key") REFERENCES "public"."object_types"("key");



ALTER TABLE ONLY "public"."event_inbox_attachments"
    ADD CONSTRAINT "event_inbox_attachments_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."event_inbox"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."event_inbox"
    ADD CONSTRAINT "event_inbox_home_system_id_fkey" FOREIGN KEY ("home_system_id") REFERENCES "public"."home_systems"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."event_inbox"
    ADD CONSTRAINT "event_inbox_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."home_system_photos"
    ADD CONSTRAINT "home_system_photos_system_id_fkey" FOREIGN KEY ("system_id") REFERENCES "public"."home_systems"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."home_systems"
    ADD CONSTRAINT "home_systems_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."home_systems"
    ADD CONSTRAINT "home_systems_system_id_fkey" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."hub_members"
    ADD CONSTRAINT "hub_members_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "public"."hubs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."hub_members"
    ADD CONSTRAINT "hub_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."hub_story_links"
    ADD CONSTRAINT "hub_story_links_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."hub_story_links"
    ADD CONSTRAINT "hub_story_links_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."hub_story_links"
    ADD CONSTRAINT "hub_story_links_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "public"."hubs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."hub_story_requests"
    ADD CONSTRAINT "hub_story_requests_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."hub_story_requests"
    ADD CONSTRAINT "hub_story_requests_hub_id_fkey" FOREIGN KEY ("hub_id") REFERENCES "public"."hubs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."hub_story_requests"
    ADD CONSTRAINT "hub_story_requests_requester_id_fkey" FOREIGN KEY ("requester_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."hub_story_requests"
    ADD CONSTRAINT "hub_story_requests_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."hubs"
    ADD CONSTRAINT "hubs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."inbox_items"
    ADD CONSTRAINT "inbox_items_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."inbox_items"
    ADD CONSTRAINT "inbox_items_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invite_events"
    ADD CONSTRAINT "invite_events_inviter_user_id_fkey" FOREIGN KEY ("inviter_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invite_events"
    ADD CONSTRAINT "invite_events_referred_user_id_fkey" FOREIGN KEY ("referred_user_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."keepr_pros"
    ADD CONSTRAINT "keepr_pros_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."locations"
    ADD CONSTRAINT "locations_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."maintenance_events"
    ADD CONSTRAINT "maintenance_events_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."maintenance_reminders"
    ADD CONSTRAINT "maintenance_reminders_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."object_actions"
    ADD CONSTRAINT "object_actions_action_type_key_fkey" FOREIGN KEY ("action_type_key") REFERENCES "public"."action_types"("key") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."object_actions"
    ADD CONSTRAINT "object_actions_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."object_actions"
    ADD CONSTRAINT "object_actions_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."object_actions"
    ADD CONSTRAINT "object_actions_proof_attachment_id_fkey" FOREIGN KEY ("proof_attachment_id") REFERENCES "public"."attachments"("id");



ALTER TABLE ONLY "public"."object_attachments"
    ADD CONSTRAINT "object_attachments_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."object_attachments"
    ADD CONSTRAINT "object_attachments_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."object_attachments"
    ADD CONSTRAINT "object_attachments_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."object_links"
    ADD CONSTRAINT "object_links_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."object_links"
    ADD CONSTRAINT "object_links_object_id_fkey" FOREIGN KEY ("object_id") REFERENCES "public"."objects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."object_links"
    ADD CONSTRAINT "object_links_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."object_links"
    ADD CONSTRAINT "object_links_system_id_fkey" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."object_type_actions"
    ADD CONSTRAINT "object_type_actions_action_type_key_fkey" FOREIGN KEY ("action_type_key") REFERENCES "public"."action_types"("key") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."object_type_actions"
    ADD CONSTRAINT "object_type_actions_object_type_key_fkey" FOREIGN KEY ("object_type_key") REFERENCES "public"."object_types"("key") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."objects"
    ADD CONSTRAINT "objects_object_type_key_fkey" FOREIGN KEY ("object_type_key") REFERENCES "public"."object_types"("key") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."objects"
    ADD CONSTRAINT "objects_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."org_members"
    ADD CONSTRAINT "org_members_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."org_members"
    ADD CONSTRAINT "org_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."orgs"
    ADD CONSTRAINT "orgs_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id");



ALTER TABLE ONLY "public"."orgs"
    ADD CONSTRAINT "orgs_photo_attachment_id_fkey" FOREIGN KEY ("photo_attachment_id") REFERENCES "public"."attachments"("id");



ALTER TABLE ONLY "public"."package_artifacts"
    ADD CONSTRAINT "package_artifacts_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."package_rows"
    ADD CONSTRAINT "package_rows_package_id_fkey" FOREIGN KEY ("package_id") REFERENCES "public"."packages"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."packages"
    ADD CONSTRAINT "packages_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."photos"
    ADD CONSTRAINT "photos_system_id_fkey" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_profile_photo_attachment_id_fkey" FOREIGN KEY ("profile_photo_attachment_id") REFERENCES "public"."attachments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."public_asset_thread_tokens"
    ADD CONSTRAINT "public_asset_thread_tokens_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."public_asset_thread_tokens"
    ADD CONSTRAINT "public_asset_thread_tokens_thread_id_fkey" FOREIGN KEY ("thread_id") REFERENCES "public"."asset_threads"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."public_intake_events"
    ADD CONSTRAINT "public_intake_events_public_link_id_fkey" FOREIGN KEY ("public_link_id") REFERENCES "public"."public_links"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."public_links"
    ADD CONSTRAINT "public_links_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."public_links"
    ADD CONSTRAINT "public_links_system_id_fkey" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."reminder_attachments"
    ADD CONSTRAINT "reminder_attachments_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."reminder_attachments"
    ADD CONSTRAINT "reminder_attachments_reminder_id_fkey" FOREIGN KEY ("reminder_id") REFERENCES "public"."reminders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_entries"
    ADD CONSTRAINT "service_entries_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_entries"
    ADD CONSTRAINT "service_entries_system_id_fkey" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."service_photos"
    ADD CONSTRAINT "service_photos_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "public"."system_service_records"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_record_documents"
    ADD CONSTRAINT "service_record_documents_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."service_record_documents"
    ADD CONSTRAINT "service_record_documents_service_record_id_fkey" FOREIGN KEY ("service_record_id") REFERENCES "public"."service_records"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."service_record_documents"
    ADD CONSTRAINT "service_record_documents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_record_photos"
    ADD CONSTRAINT "service_record_photos_service_record_id_fkey" FOREIGN KEY ("service_record_id") REFERENCES "public"."service_records"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_records"
    ADD CONSTRAINT "service_records_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."service_records"
    ADD CONSTRAINT "service_records_keepr_pro_id_fkey" FOREIGN KEY ("keepr_pro_id") REFERENCES "public"."keepr_pros"("id");



ALTER TABLE ONLY "public"."service_records"
    ADD CONSTRAINT "service_records_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "public"."service_record_documents"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."service_records"
    ADD CONSTRAINT "service_records_system_id_fkey" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."story_events"
    ADD CONSTRAINT "story_events_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."story_events"
    ADD CONSTRAINT "story_events_service_record_id_fkey" FOREIGN KEY ("service_record_id") REFERENCES "public"."service_records"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."story_events"
    ADD CONSTRAINT "story_events_system_id_fkey" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."system_photos"
    ADD CONSTRAINT "system_photos_system_id_fkey" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."system_readiness"
    ADD CONSTRAINT "system_readiness_asset_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."system_readiness"
    ADD CONSTRAINT "system_readiness_system_fk" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."system_service_records"
    ADD CONSTRAINT "system_service_records_system_id_fkey" FOREIGN KEY ("system_id") REFERENCES "public"."home_systems"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."system_stewards"
    ADD CONSTRAINT "system_stewards_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."system_stewards"
    ADD CONSTRAINT "system_stewards_system_id_fkey" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."systems"
    ADD CONSTRAINT "systems_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."thumbnail_jobs"
    ADD CONSTRAINT "thumbnail_jobs_attachment_id_fkey" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_entitlements"
    ADD CONSTRAINT "user_entitlements_user_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_systems"
    ADD CONSTRAINT "vehicle_systems_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "public"."assets"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."vehicle_systems"
    ADD CONSTRAINT "vehicle_systems_system_id_fkey" FOREIGN KEY ("system_id") REFERENCES "public"."systems"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."warranty_requirements"
    ADD CONSTRAINT "warranty_requirements_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."orgs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."warranty_requirements"
    ADD CONSTRAINT "warranty_requirements_warranty_object_id_fkey" FOREIGN KEY ("warranty_object_id") REFERENCES "public"."objects"("id") ON DELETE CASCADE;






CREATE POLICY "Authenticated users can create notifications" ON "public"."notifications" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Team members can read each other's profiles" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM ("public"."org_members" "my"
     JOIN "public"."org_members" "other" ON (("other"."org_id" = "my"."org_id")))
  WHERE (("my"."user_id" = "auth"."uid"()) AND ("other"."user_id" = "profiles"."id"))))));



CREATE POLICY "Users can create actions" ON "public"."actions" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "Users can delete their own loose notes" ON "public"."loose_notes" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can insert own profile" ON "public"."profiles" FOR INSERT TO "authenticated" WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "Users can insert their own loose notes" ON "public"."loose_notes" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can read assigned actions" ON "public"."actions" FOR SELECT TO "authenticated" USING (("assigned_to_user_id" = "auth"."uid"()));



CREATE POLICY "Users can read own invite events" ON "public"."invite_events" FOR SELECT USING (("auth"."uid"() = "inviter_user_id"));



CREATE POLICY "Users can read own notifications" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can update assigned actions" ON "public"."actions" FOR UPDATE TO "authenticated" USING (("assigned_to_user_id" = "auth"."uid"())) WITH CHECK (("assigned_to_user_id" = "auth"."uid"()));



CREATE POLICY "Users can update own profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("id" = "auth"."uid"())) WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "Users can update their own loose notes" ON "public"."loose_notes" FOR UPDATE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users can view own profile" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("id" = "auth"."uid"()));



CREATE POLICY "Users can view their own loose notes" ON "public"."loose_notes" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users delete their own pros" ON "public"."keepr_pros" FOR DELETE USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users insert their own pros" ON "public"."keepr_pros" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "Users own their vehicle systems" ON "public"."vehicle_systems" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "vehicle_systems"."asset_id") AND ("a"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "vehicle_systems"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "Users see their own pros" ON "public"."keepr_pros" FOR SELECT USING (("auth"."uid"() = "user_id"));



CREATE POLICY "Users update their own pros" ON "public"."keepr_pros" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."action_proposals" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "aee_insert_none" ON "public"."asset_engagement_events" FOR INSERT WITH CHECK (false);



CREATE POLICY "aee_select_stewards" ON "public"."asset_engagement_events" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."asset_stewards" "s"
  WHERE (("s"."master_asset_id" = "asset_engagement_events"."master_asset_id") AND ("s"."user_id" = "auth"."uid"()) AND ("s"."ended_at" IS NULL)))));



ALTER TABLE "public"."asset_engagement_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."asset_files" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "asset_files_delete_stewards" ON "public"."asset_files" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."asset_stewards" "s"
  WHERE (("s"."master_asset_id" = "asset_files"."master_asset_id") AND ("s"."user_id" = "auth"."uid"()) AND ("s"."ended_at" IS NULL)))));



CREATE POLICY "asset_files_insert_stewards" ON "public"."asset_files" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."asset_stewards" "s"
  WHERE (("s"."master_asset_id" = "asset_files"."master_asset_id") AND ("s"."user_id" = "auth"."uid"()) AND ("s"."ended_at" IS NULL)))));



CREATE POLICY "asset_files_select_stewards" ON "public"."asset_files" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."asset_stewards" "s"
  WHERE (("s"."master_asset_id" = "asset_files"."master_asset_id") AND ("s"."user_id" = "auth"."uid"()) AND ("s"."ended_at" IS NULL)))));



ALTER TABLE "public"."asset_identifiers" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "asset_identifiers_delete_via_asset" ON "public"."asset_identifiers" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "asset_identifiers"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "asset_identifiers_insert_via_asset" ON "public"."asset_identifiers" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "asset_identifiers"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "asset_identifiers_select_via_asset" ON "public"."asset_identifiers" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "asset_identifiers"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "asset_identifiers_update_via_asset" ON "public"."asset_identifiers" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "asset_identifiers"."asset_id") AND ("a"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "asset_identifiers"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



ALTER TABLE "public"."asset_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "asset_members_delete_owner_only" ON "public"."asset_members" FOR DELETE TO "authenticated" USING ("public"."keepr_is_asset_owner"("asset_id", "auth"."uid"()));



CREATE POLICY "asset_members_insert_owner_team_only" ON "public"."asset_members" FOR INSERT TO "authenticated" WITH CHECK (("public"."keepr_is_asset_owner"("asset_id", "auth"."uid"()) AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("lower"(COALESCE("p"."plan", ''::"text")) = 'team'::"text"))))));



CREATE POLICY "asset_members_select_owner_or_self" ON "public"."asset_members" FOR SELECT TO "authenticated" USING ((("user_id" = "auth"."uid"()) OR "public"."keepr_is_asset_owner"("asset_id", "auth"."uid"())));



ALTER TABLE "public"."asset_photos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "asset_photos_delete_via_asset_owner" ON "public"."asset_photos" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "asset_photos"."asset_id") AND ("a"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "asset_photos_insert_via_asset_owner" ON "public"."asset_photos" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "asset_photos"."asset_id") AND ("a"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



CREATE POLICY "asset_photos_select_via_asset_access" ON "public"."asset_photos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "asset_photos"."asset_id") AND (("a"."owner_id" = ( SELECT "auth"."uid"() AS "uid")) OR (EXISTS ( SELECT 1
           FROM "public"."asset_stewardships" "s"
          WHERE (("s"."asset_id" = "a"."id") AND ("s"."active" = true) AND (("s"."user_id" = ( SELECT "auth"."uid"() AS "uid")) OR (("s"."org_id" IS NOT NULL) AND (EXISTS ( SELECT 1
                   FROM "public"."org_members" "om"
                  WHERE (("om"."org_id" = "s"."org_id") AND ("om"."user_id" = ( SELECT "auth"."uid"() AS "uid")))))))))))))));



CREATE POLICY "asset_photos_update_via_asset_owner" ON "public"."asset_photos" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "asset_photos"."asset_id") AND ("a"."owner_id" = ( SELECT "auth"."uid"() AS "uid")))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "asset_photos"."asset_id") AND ("a"."owner_id" = ( SELECT "auth"."uid"() AS "uid"))))));



ALTER TABLE "public"."asset_stewards" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "asset_stewards_select" ON "public"."asset_stewards" FOR SELECT USING (("user_id" = "auth"."uid"()));



CREATE POLICY "asset_stewards_write_none" ON "public"."asset_stewards" USING (false) WITH CHECK (false);



ALTER TABLE "public"."asset_stewardships" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."asset_thread_messages" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."asset_threads" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."asset_transfers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."assets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "assets_delete_owner" ON "public"."assets" FOR DELETE TO "authenticated" USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "assets_insert_owner" ON "public"."assets" FOR INSERT TO "authenticated" WITH CHECK (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "assets_insert_owner_within_limit" ON "public"."assets" FOR INSERT TO "authenticated" WITH CHECK ((("owner_id" = "auth"."uid"()) AND "public"."can_create_asset"()));



CREATE POLICY "assets_select_own" ON "public"."assets" FOR SELECT TO "authenticated" USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "assets_select_owner" ON "public"."assets" FOR SELECT TO "authenticated" USING (("owner_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "assets_select_owner_or_collab" ON "public"."assets" FOR SELECT TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR "public"."keepr_is_asset_collaborator"("id", "auth"."uid"())));



CREATE POLICY "assets_select_steward" ON "public"."assets" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."asset_stewardships" "s"
  WHERE (("s"."asset_id" = "assets"."id") AND ("s"."active" = true) AND (("s"."user_id" = "auth"."uid"()) OR (("s"."org_id" IS NOT NULL) AND "public"."keepr_is_org_member"("s"."org_id")))))));



CREATE POLICY "assets_update_owner" ON "public"."assets" FOR UPDATE TO "authenticated" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "assets_update_owner_or_collab" ON "public"."assets" FOR UPDATE TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR "public"."keepr_is_asset_collaborator"("id", "auth"."uid"())));



ALTER TABLE "public"."assurance_records" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "assurance_records_delete_own" ON "public"."assurance_records" FOR DELETE USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "assurance_records_insert_own" ON "public"."assurance_records" FOR INSERT WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "assurance_records_select_own" ON "public"."assurance_records" FOR SELECT USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "assurance_records_update_own" ON "public"."assurance_records" FOR UPDATE USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



ALTER TABLE "public"."attachment_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."attachment_meta" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "attachment_meta_delete_own" ON "public"."attachment_meta" FOR DELETE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "attachment_meta_insert_own" ON "public"."attachment_meta" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "attachment_meta_select_own" ON "public"."attachment_meta" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "attachment_meta_update_own" ON "public"."attachment_meta" FOR UPDATE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."attachment_placements" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "attachment_placements_delete_owner_only" ON "public"."attachment_placements" FOR DELETE TO "authenticated" USING ("public"."keepr_is_asset_owner"("public"."keepr_asset_id_for_attachment_placement"("target_type", "target_id"), "auth"."uid"()));



CREATE POLICY "attachment_placements_insert_own" ON "public"."attachment_placements" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."attachments" "a"
  WHERE (("a"."id" = "attachment_placements"."attachment_id") AND ("a"."owner_user_id" = "auth"."uid"())))));



CREATE POLICY "attachment_placements_insert_visible" ON "public"."attachment_placements" FOR INSERT TO "authenticated" WITH CHECK ("public"."keepr_can_access_asset"("public"."keepr_asset_id_for_attachment_placement"("target_type", "target_id"), "auth"."uid"()));



CREATE POLICY "attachment_placements_select_visible" ON "public"."attachment_placements" FOR SELECT TO "authenticated" USING ("public"."keepr_can_access_asset"("public"."keepr_asset_id_for_attachment_placement"("target_type", "target_id"), "auth"."uid"()));



CREATE POLICY "attachment_placements_update_visible" ON "public"."attachment_placements" FOR UPDATE TO "authenticated" USING ("public"."keepr_can_access_asset"("public"."keepr_asset_id_for_attachment_placement"("target_type", "target_id"), "auth"."uid"()));



ALTER TABLE "public"."attachments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "attachments_own_all" ON "public"."attachments" TO "authenticated" USING ((("owner_user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "attachments"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))))) WITH CHECK ((("owner_user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "attachments"."asset_id") AND ("a"."owner_id" = "auth"."uid"()))))));



CREATE POLICY "attachments_select_org_member_via_stewardship" ON "public"."attachments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."asset_stewardships" "s"
     JOIN "public"."org_members" "om" ON (("om"."org_id" = "s"."org_id")))
  WHERE (("s"."asset_id" = "attachments"."asset_id") AND ("s"."active" = true) AND ("om"."user_id" = "auth"."uid"())))));



CREATE POLICY "attachments_select_own" ON "public"."attachments" FOR SELECT TO "authenticated" USING (("owner_user_id" = "auth"."uid"()));



CREATE POLICY "attachments_select_owner_or_member" ON "public"."attachments" FOR SELECT TO "authenticated" USING (((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "attachments"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))) OR (EXISTS ( SELECT 1
   FROM "public"."asset_members" "am"
  WHERE (("am"."asset_id" = "attachments"."asset_id") AND ("am"."user_id" = "auth"."uid"()))))));



CREATE POLICY "authenticated can insert thumbnail jobs" ON "public"."thumbnail_jobs" FOR INSERT TO "authenticated" WITH CHECK (true);



CREATE POLICY "authenticated can read thumbnail jobs" ON "public"."thumbnail_jobs" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "authenticated can view active hub members" ON "public"."hub_members" FOR SELECT TO "authenticated" USING (("status" = 'active'::"text"));



CREATE POLICY "authenticated users can add story links" ON "public"."hub_story_links" FOR INSERT TO "authenticated" WITH CHECK (("created_by" = "auth"."uid"()));



CREATE POLICY "authenticated users can create hubs" ON "public"."hubs" FOR INSERT TO "authenticated" WITH CHECK (("created_by" = "auth"."uid"()));



CREATE POLICY "authenticated users can remove own story links" ON "public"."hub_story_links" FOR DELETE TO "authenticated" USING (("created_by" = "auth"."uid"()));



CREATE POLICY "authenticated users can update own story links" ON "public"."hub_story_links" FOR UPDATE TO "authenticated" USING (("created_by" = "auth"."uid"())) WITH CHECK (("created_by" = "auth"."uid"()));



ALTER TABLE "public"."boat_systems" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "boat_systems_delete_via_asset" ON "public"."boat_systems" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "boat_systems"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "boat_systems_insert_via_asset" ON "public"."boat_systems" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "boat_systems"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "boat_systems_select_via_asset" ON "public"."boat_systems" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "boat_systems"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "boat_systems_update_via_asset" ON "public"."boat_systems" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "boat_systems"."asset_id") AND ("a"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "boat_systems"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "delete_own_readiness" ON "public"."system_readiness" FOR DELETE USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."email_intake_addresses" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."environment_profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "environment_profiles_read" ON "public"."environment_profiles" FOR SELECT TO "authenticated" USING (true);



ALTER TABLE "public"."event_inbox" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."event_inbox_attachments" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "event_inbox_attachments_delete_via_event" ON "public"."event_inbox_attachments" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."event_inbox" "e"
  WHERE (("e"."id" = "event_inbox_attachments"."event_id") AND ("e"."owner_id" = "auth"."uid"())))));



CREATE POLICY "event_inbox_attachments_insert_via_event" ON "public"."event_inbox_attachments" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."event_inbox" "e"
  WHERE (("e"."id" = "event_inbox_attachments"."event_id") AND ("e"."owner_id" = "auth"."uid"())))));



CREATE POLICY "event_inbox_attachments_select_via_event" ON "public"."event_inbox_attachments" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."event_inbox" "e"
  WHERE (("e"."id" = "event_inbox_attachments"."event_id") AND ("e"."owner_id" = "auth"."uid"())))));



CREATE POLICY "event_inbox_attachments_update_via_event" ON "public"."event_inbox_attachments" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."event_inbox" "e"
  WHERE (("e"."id" = "event_inbox_attachments"."event_id") AND ("e"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."event_inbox" "e"
  WHERE (("e"."id" = "event_inbox_attachments"."event_id") AND ("e"."owner_id" = "auth"."uid"())))));



CREATE POLICY "event_inbox_delete_own" ON "public"."event_inbox" FOR DELETE TO "authenticated" USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "event_inbox_delete_owner_only" ON "public"."event_inbox" FOR DELETE TO "authenticated" USING (((("owner_id" = "auth"."uid"()) AND ("asset_id" IS NULL)) OR (("asset_id" IS NOT NULL) AND "public"."keepr_is_asset_owner"("asset_id", "auth"."uid"()))));



CREATE POLICY "event_inbox_insert_own" ON "public"."event_inbox" FOR INSERT TO "authenticated" WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "event_inbox_insert_owner_only" ON "public"."event_inbox" FOR INSERT TO "authenticated" WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "event_inbox_select_own" ON "public"."event_inbox" FOR SELECT TO "authenticated" USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "event_inbox_select_visible" ON "public"."event_inbox" FOR SELECT TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR (("asset_id" IS NOT NULL) AND ("public"."keepr_is_asset_owner"("asset_id", "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."asset_members" "am"
  WHERE (("am"."asset_id" = "event_inbox"."asset_id") AND ("am"."user_id" = "auth"."uid"()))))))));



CREATE POLICY "event_inbox_update_own" ON "public"."event_inbox" FOR UPDATE TO "authenticated" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "event_inbox_update_visible" ON "public"."event_inbox" FOR UPDATE TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR (("asset_id" IS NOT NULL) AND ("public"."keepr_is_asset_owner"("asset_id", "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."asset_members" "am"
  WHERE (("am"."asset_id" = "event_inbox"."asset_id") AND ("am"."user_id" = "auth"."uid"()))))))));



CREATE POLICY "event_owner_delete_event_attachments" ON "public"."event_inbox_attachments" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."event_inbox" "e"
  WHERE (("e"."id" = "event_inbox_attachments"."event_id") AND ("e"."owner_id" = "auth"."uid"())))));



CREATE POLICY "event_owner_insert_event_attachments" ON "public"."event_inbox_attachments" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."event_inbox" "e"
  WHERE (("e"."id" = "event_inbox_attachments"."event_id") AND ("e"."owner_id" = "auth"."uid"())))));



CREATE POLICY "event_owner_select_event_attachments" ON "public"."event_inbox_attachments" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."event_inbox" "e"
  WHERE (("e"."id" = "event_inbox_attachments"."event_id") AND ("e"."owner_id" = "auth"."uid"())))));



CREATE POLICY "event_owner_update_event_attachments" ON "public"."event_inbox_attachments" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."event_inbox" "e"
  WHERE (("e"."id" = "event_inbox_attachments"."event_id") AND ("e"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."event_inbox" "e"
  WHERE (("e"."id" = "event_inbox_attachments"."event_id") AND ("e"."owner_id" = "auth"."uid"())))));



ALTER TABLE "public"."home_system_photos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "home_system_photos_delete_via_system" ON "public"."home_system_photos" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."systems" "s"
     JOIN "public"."assets" "a" ON (("a"."id" = "s"."asset_id")))
  WHERE (("s"."id" = "home_system_photos"."system_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "home_system_photos_insert_via_system" ON "public"."home_system_photos" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."systems" "s"
     JOIN "public"."assets" "a" ON (("a"."id" = "s"."asset_id")))
  WHERE (("s"."id" = "home_system_photos"."system_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "home_system_photos_select_via_system" ON "public"."home_system_photos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."systems" "s"
     JOIN "public"."assets" "a" ON (("a"."id" = "s"."asset_id")))
  WHERE (("s"."id" = "home_system_photos"."system_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "home_system_photos_update_via_system" ON "public"."home_system_photos" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."systems" "s"
     JOIN "public"."assets" "a" ON (("a"."id" = "s"."asset_id")))
  WHERE (("s"."id" = "home_system_photos"."system_id") AND ("a"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."systems" "s"
     JOIN "public"."assets" "a" ON (("a"."id" = "s"."asset_id")))
  WHERE (("s"."id" = "home_system_photos"."system_id") AND ("a"."owner_id" = "auth"."uid"())))));



ALTER TABLE "public"."home_systems" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "hub admins can delete members" ON "public"."hub_members" FOR DELETE TO "authenticated" USING ("public"."is_hub_admin"("hub_id"));



CREATE POLICY "hub admins can invite members" ON "public"."hub_members" FOR INSERT TO "authenticated" WITH CHECK ("public"."is_hub_admin"("hub_id"));



CREATE POLICY "hub creators can add themselves as owner" ON "public"."hub_members" FOR INSERT TO "authenticated" WITH CHECK ((("user_id" = "auth"."uid"()) AND ("role" = 'owner'::"text")));



CREATE POLICY "hub creators can view own hubs" ON "public"."hubs" FOR SELECT TO "authenticated" USING (("created_by" = "auth"."uid"()));



CREATE POLICY "hub members can view members" ON "public"."hub_members" FOR SELECT TO "authenticated" USING (("public"."is_hub_admin"("hub_id") OR ("user_id" = "auth"."uid"())));



CREATE POLICY "hub owners can update hubs" ON "public"."hubs" FOR UPDATE TO "authenticated" USING ((("created_by" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."hub_members" "hm"
  WHERE (("hm"."hub_id" = "hubs"."id") AND ("hm"."user_id" = "auth"."uid"()) AND ("hm"."role" = ANY (ARRAY['owner'::"text", 'admin'::"text"]))))))) WITH CHECK ((("created_by" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."hub_members" "hm"
  WHERE (("hm"."hub_id" = "hubs"."id") AND ("hm"."user_id" = "auth"."uid"()) AND ("hm"."role" = ANY (ARRAY['owner'::"text", 'admin'::"text"])))))));



ALTER TABLE "public"."hub_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hub_story_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hub_story_requests" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."hubs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "inbox_insert_sender" ON "public"."inbox_items" FOR INSERT WITH CHECK (("from_user_id" = "auth"."uid"()));



ALTER TABLE "public"."inbox_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "inbox_items_delete_participant" ON "public"."inbox_items" FOR DELETE USING ((("auth"."uid"() = "to_user_id") OR ("auth"."uid"() = "from_user_id")));



CREATE POLICY "inbox_items_select_participant" ON "public"."inbox_items" FOR SELECT USING ((("auth"."uid"() = "to_user_id") OR ("auth"."uid"() = "from_user_id")));



CREATE POLICY "inbox_read_recipient_or_sender" ON "public"."inbox_items" FOR SELECT USING ((("to_user_id" = "auth"."uid"()) OR ("from_user_id" = "auth"."uid"())));



CREATE POLICY "inbox_update_recipient" ON "public"."inbox_items" FOR UPDATE USING (("to_user_id" = "auth"."uid"())) WITH CHECK (("to_user_id" = "auth"."uid"()));



CREATE POLICY "insert_own_readiness" ON "public"."system_readiness" FOR INSERT WITH CHECK (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."invite_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invitees can accept hub invites" ON "public"."hub_members" FOR UPDATE TO "authenticated" USING ((("status" = 'invited'::"text") AND ("lower"("email") = "lower"(("auth"."jwt"() ->> 'email'::"text"))))) WITH CHECK ((("status" = 'active'::"text") AND ("user_id" = "auth"."uid"())));



ALTER TABLE "public"."keepr_pros" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."locations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "locations_delete_via_asset" ON "public"."locations" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "locations"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "locations_insert_via_asset" ON "public"."locations" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "locations"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "locations_select_via_asset" ON "public"."locations" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "locations"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "locations_update_via_asset" ON "public"."locations" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "locations"."asset_id") AND ("a"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "locations"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



ALTER TABLE "public"."loose_notes" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."maintenance_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."maintenance_reminders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."master_assets" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "master_assets_insert_none" ON "public"."master_assets" FOR INSERT WITH CHECK (false);



CREATE POLICY "master_assets_select_stewards" ON "public"."master_assets" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."asset_stewards" "s"
  WHERE (("s"."master_asset_id" = "master_assets"."id") AND ("s"."user_id" = "auth"."uid"()) AND ("s"."ended_at" IS NULL)))));



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "org members can read org" ON "public"."orgs" FOR SELECT USING ((("owner_user_id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."org_members" "om"
  WHERE (("om"."org_id" = "orgs"."id") AND ("om"."user_id" = "auth"."uid"()))))));



CREATE POLICY "org owner can update org" ON "public"."orgs" FOR UPDATE USING (("owner_user_id" = "auth"."uid"())) WITH CHECK (("owner_user_id" = "auth"."uid"()));



ALTER TABLE "public"."org_members" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "org_members_delete_owner_only" ON "public"."org_members" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."orgs" "o"
  WHERE (("o"."id" = "org_members"."org_id") AND ("o"."owner_user_id" = "auth"."uid"())))));



CREATE POLICY "org_members_insert_owner_only" ON "public"."org_members" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."orgs" "o"
  WHERE (("o"."id" = "org_members"."org_id") AND ("o"."owner_user_id" = "auth"."uid"())))));



CREATE POLICY "org_members_select_same_org_via_fn" ON "public"."org_members" FOR SELECT TO "authenticated" USING ("public"."keepr_is_org_member"("org_id"));



CREATE POLICY "org_members_select_self" ON "public"."org_members" FOR SELECT TO "authenticated" USING (("user_id" = "auth"."uid"()));



ALTER TABLE "public"."orgs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "orgs_insert_family_hoa" ON "public"."orgs" FOR INSERT WITH CHECK ((("owner_user_id" = "auth"."uid"()) AND ("org_type" = ANY (ARRAY['family'::"text", 'hoa'::"text"]))));



CREATE POLICY "orgs_insert_policy" ON "public"."orgs" FOR INSERT WITH CHECK ((("owner_user_id" = "auth"."uid"()) AND (("org_type" = ANY (ARRAY['family'::"text", 'hoa'::"text"])) OR (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = ANY (ARRAY['superkeepr'::"text", 'admin'::"text"]))))))));



CREATE POLICY "orgs_insert_superkeepr_admin" ON "public"."orgs" FOR INSERT WITH CHECK ((("org_type" = 'superkeepr'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."profiles" "p"
  WHERE (("p"."id" = "auth"."uid"()) AND ("p"."role" = 'admin'::"text"))))));



CREATE POLICY "orgs_insert_team_only" ON "public"."orgs" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_team_active"() AND ("owner_user_id" = "auth"."uid"())));



CREATE POLICY "orgs_select_visible" ON "public"."orgs" FOR SELECT TO "authenticated" USING ((("owner_user_id" = "auth"."uid"()) OR "public"."keepr_is_org_member"("id", "auth"."uid"())));



CREATE POLICY "orgs_update_owner_only" ON "public"."orgs" FOR UPDATE TO "authenticated" USING (("owner_user_id" = "auth"."uid"())) WITH CHECK (("owner_user_id" = "auth"."uid"()));



CREATE POLICY "owners can manage maintenance events" ON "public"."maintenance_events" USING (("auth"."uid"() = ( SELECT "assets"."owner_id"
   FROM "public"."assets"
  WHERE ("assets"."id" = "maintenance_events"."asset_id")))) WITH CHECK (("auth"."uid"() = ( SELECT "assets"."owner_id"
   FROM "public"."assets"
  WHERE ("assets"."id" = "maintenance_events"."asset_id"))));



CREATE POLICY "owners can manage reminders" ON "public"."maintenance_reminders" USING (("auth"."uid"() = ( SELECT "assets"."owner_id"
   FROM "public"."assets"
  WHERE ("assets"."id" = "maintenance_reminders"."asset_id")))) WITH CHECK (("auth"."uid"() = ( SELECT "assets"."owner_id"
   FROM "public"."assets"
  WHERE ("assets"."id" = "maintenance_reminders"."asset_id"))));



CREATE POLICY "owners delete their home systems" ON "public"."home_systems" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "home_systems"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "owners insert their home systems" ON "public"."home_systems" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "home_systems"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "owners manage their service photos" ON "public"."service_photos" USING ((EXISTS ( SELECT 1
   FROM (("public"."system_service_records" "r"
     JOIN "public"."home_systems" "s" ON (("s"."id" = "r"."system_id")))
     JOIN "public"."assets" "a" ON (("a"."id" = "s"."asset_id")))
  WHERE (("r"."id" = "service_photos"."service_id") AND ("a"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM (("public"."system_service_records" "r"
     JOIN "public"."home_systems" "s" ON (("s"."id" = "r"."system_id")))
     JOIN "public"."assets" "a" ON (("a"."id" = "s"."asset_id")))
  WHERE (("r"."id" = "service_photos"."service_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "owners manage their service records" ON "public"."system_service_records" USING ((EXISTS ( SELECT 1
   FROM ("public"."home_systems" "s"
     JOIN "public"."assets" "a" ON (("a"."id" = "s"."asset_id")))
  WHERE (("s"."id" = "system_service_records"."system_id") AND ("a"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."home_systems" "s"
     JOIN "public"."assets" "a" ON (("a"."id" = "s"."asset_id")))
  WHERE (("s"."id" = "system_service_records"."system_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "owners see their home systems" ON "public"."home_systems" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "home_systems"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "owners update their home systems" ON "public"."home_systems" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "home_systems"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



ALTER TABLE "public"."package_artifacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "package_artifacts_insert_via_package" ON "public"."package_artifacts" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."packages" "p"
  WHERE ("p"."id" = "package_artifacts"."package_id"))));



CREATE POLICY "package_artifacts_select_via_package" ON "public"."package_artifacts" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."packages" "p"
  WHERE ("p"."id" = "package_artifacts"."package_id"))));



ALTER TABLE "public"."package_rows" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "package_rows_insert_via_package" ON "public"."package_rows" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."packages" "p"
  WHERE ("p"."id" = "package_rows"."package_id"))));



CREATE POLICY "package_rows_select_via_package" ON "public"."package_rows" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."packages" "p"
  WHERE ("p"."id" = "package_rows"."package_id"))));



ALTER TABLE "public"."packages" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "packages_insert_owner" ON "public"."packages" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "packages"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "packages_select_owner" ON "public"."packages" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "packages"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



ALTER TABLE "public"."photos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "photos_delete_via_asset" ON "public"."photos" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "photos"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "photos_insert_via_asset" ON "public"."photos" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "photos"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "photos_select_via_asset" ON "public"."photos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "photos"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "photos_update_via_asset" ON "public"."photos" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "photos"."asset_id") AND ("a"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "photos"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "placements_if_own_attachment_all" ON "public"."attachment_placements" TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."attachments" "a"
  WHERE (("a"."id" = "attachment_placements"."attachment_id") AND ("a"."owner_user_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."attachments" "a"
  WHERE (("a"."id" = "attachment_placements"."attachment_id") AND ("a"."owner_user_id" = "auth"."uid"())))));



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles are readable by owner" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "profiles are updatable by owner" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "profiles: read own" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));



CREATE POLICY "profiles: update own" ON "public"."profiles" FOR UPDATE USING (("auth"."uid"() = "id"));



CREATE POLICY "profiles_select_self_or_org_owner" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM ("public"."org_members" "om"
     JOIN "public"."orgs" "o" ON (("o"."id" = "om"."org_id")))
  WHERE (("o"."owner_user_id" = "auth"."uid"()) AND ("om"."user_id" = "profiles"."id"))))));



CREATE POLICY "public can view approved story links for public hubs" ON "public"."hub_story_links" FOR SELECT USING ((("status" = 'approved'::"text") AND (EXISTS ( SELECT 1
   FROM "public"."hubs" "h"
  WHERE (("h"."id" = "hub_story_links"."hub_id") AND ("h"."visibility" = 'public'::"text"))))));



CREATE POLICY "public hubs viewable" ON "public"."hubs" FOR SELECT USING (("visibility" = 'public'::"text"));



ALTER TABLE "public"."public_asset_thread_tokens" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."public_links" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "public_links_owner" ON "public"."public_links" USING (("auth"."uid"() = "created_by")) WITH CHECK (("auth"."uid"() = "created_by"));



CREATE POLICY "select_own_readiness" ON "public"."system_readiness" FOR SELECT USING (("auth"."uid"() = "user_id"));



ALTER TABLE "public"."service_entries" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service_entries_delete_via_asset" ON "public"."service_entries" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "service_entries"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "service_entries_insert_via_asset" ON "public"."service_entries" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "service_entries"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "service_entries_select_via_asset" ON "public"."service_entries" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "service_entries"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "service_entries_update_via_asset" ON "public"."service_entries" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "service_entries"."asset_id") AND ("a"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "service_entries"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



ALTER TABLE "public"."service_photos" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."service_record_documents" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service_record_documents_delete_via_asset" ON "public"."service_record_documents" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "service_record_documents"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "service_record_documents_insert_via_asset" ON "public"."service_record_documents" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "service_record_documents"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "service_record_documents_select_via_asset" ON "public"."service_record_documents" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "service_record_documents"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "service_record_documents_update_via_asset" ON "public"."service_record_documents" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "service_record_documents"."asset_id") AND ("a"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "service_record_documents"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



ALTER TABLE "public"."service_record_photos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service_record_photos_delete_via_asset" ON "public"."service_record_photos" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "service_record_photos"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "service_record_photos_insert_via_asset" ON "public"."service_record_photos" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "service_record_photos"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "service_record_photos_select_via_asset" ON "public"."service_record_photos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "service_record_photos"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "service_record_photos_update_via_asset" ON "public"."service_record_photos" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "service_record_photos"."asset_id") AND ("a"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "service_record_photos"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



ALTER TABLE "public"."service_records" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service_records_delete_owner_only" ON "public"."service_records" FOR DELETE TO "authenticated" USING ("public"."keepr_is_asset_owner"("asset_id", "auth"."uid"()));



CREATE POLICY "service_records_delete_via_asset" ON "public"."service_records" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "service_records"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "service_records_insert_via_asset" ON "public"."service_records" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "service_records"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "service_records_insert_visible" ON "public"."service_records" FOR INSERT TO "authenticated" WITH CHECK ("public"."keepr_can_access_asset"("asset_id", "auth"."uid"()));



CREATE POLICY "service_records_select_via_asset" ON "public"."service_records" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "service_records"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "service_records_select_visible" ON "public"."service_records" FOR SELECT TO "authenticated" USING ("public"."keepr_can_access_asset"("asset_id", "auth"."uid"()));



CREATE POLICY "service_records_update_via_asset" ON "public"."service_records" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "service_records"."asset_id") AND ("a"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "service_records"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "service_records_update_visible" ON "public"."service_records" FOR UPDATE TO "authenticated" USING ("public"."keepr_can_access_asset"("asset_id", "auth"."uid"()));



CREATE POLICY "stewardships: insert by org managers/owners" ON "public"."asset_stewardships" FOR INSERT WITH CHECK (((("org_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."org_members" "om"
  WHERE (("om"."org_id" = "asset_stewardships"."org_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."member_role" = ANY (ARRAY['owner'::"text", 'manager'::"text"])))))) OR ("user_id" = "auth"."uid"())));



CREATE POLICY "stewardships: read for org members or direct" ON "public"."asset_stewardships" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR (("org_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."org_members" "om"
  WHERE (("om"."org_id" = "asset_stewardships"."org_id") AND ("om"."user_id" = "auth"."uid"())))))));



CREATE POLICY "stewardships: update by org managers/owners" ON "public"."asset_stewardships" FOR UPDATE USING (((("org_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."org_members" "om"
  WHERE (("om"."org_id" = "asset_stewardships"."org_id") AND ("om"."user_id" = "auth"."uid"()) AND ("om"."member_role" = ANY (ARRAY['owner'::"text", 'manager'::"text"])))))) OR ("user_id" = "auth"."uid"())));



ALTER TABLE "public"."story_events" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "story_events_delete_via_asset" ON "public"."story_events" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "story_events"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "story_events_insert_via_asset" ON "public"."story_events" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "story_events"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "story_events_select_via_asset" ON "public"."story_events" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "story_events"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "story_events_update_via_asset" ON "public"."story_events" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "story_events"."asset_id") AND ("a"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "story_events"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



ALTER TABLE "public"."system_photos" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "system_photos_delete_via_system" ON "public"."system_photos" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."systems" "s"
     JOIN "public"."assets" "a" ON (("a"."id" = "s"."asset_id")))
  WHERE (("s"."id" = "system_photos"."system_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "system_photos_insert_via_system" ON "public"."system_photos" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."systems" "s"
     JOIN "public"."assets" "a" ON (("a"."id" = "s"."asset_id")))
  WHERE (("s"."id" = "system_photos"."system_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "system_photos_select_via_system" ON "public"."system_photos" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."systems" "s"
     JOIN "public"."assets" "a" ON (("a"."id" = "s"."asset_id")))
  WHERE (("s"."id" = "system_photos"."system_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "system_photos_update_via_system" ON "public"."system_photos" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM ("public"."systems" "s"
     JOIN "public"."assets" "a" ON (("a"."id" = "s"."asset_id")))
  WHERE (("s"."id" = "system_photos"."system_id") AND ("a"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM ("public"."systems" "s"
     JOIN "public"."assets" "a" ON (("a"."id" = "s"."asset_id")))
  WHERE (("s"."id" = "system_photos"."system_id") AND ("a"."owner_id" = "auth"."uid"())))));



ALTER TABLE "public"."system_readiness" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "system_readiness_delete_via_asset" ON "public"."system_readiness" FOR DELETE USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "system_readiness"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "system_readiness_insert_via_asset" ON "public"."system_readiness" FOR INSERT WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "system_readiness"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "system_readiness_select_via_asset" ON "public"."system_readiness" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "system_readiness"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "system_readiness_update_via_asset" ON "public"."system_readiness" FOR UPDATE USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "system_readiness"."asset_id") AND ("a"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "system_readiness"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



ALTER TABLE "public"."system_service_records" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."systems" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "systems_delete_owner_only" ON "public"."systems" FOR DELETE TO "authenticated" USING ("public"."keepr_is_asset_owner"("asset_id", "auth"."uid"()));



CREATE POLICY "systems_delete_via_asset" ON "public"."systems" FOR DELETE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "systems"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "systems_insert_via_asset" ON "public"."systems" FOR INSERT TO "authenticated" WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "systems"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "systems_insert_visible" ON "public"."systems" FOR INSERT TO "authenticated" WITH CHECK ("public"."keepr_can_access_asset"("asset_id", "auth"."uid"()));



CREATE POLICY "systems_select_via_asset" ON "public"."systems" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "systems"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "systems_select_visible" ON "public"."systems" FOR SELECT TO "authenticated" USING ("public"."keepr_can_access_asset"("asset_id", "auth"."uid"()));



CREATE POLICY "systems_update_via_asset" ON "public"."systems" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "systems"."asset_id") AND ("a"."owner_id" = "auth"."uid"()))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."assets" "a"
  WHERE (("a"."id" = "systems"."asset_id") AND ("a"."owner_id" = "auth"."uid"())))));



CREATE POLICY "systems_update_visible" ON "public"."systems" FOR UPDATE TO "authenticated" USING ("public"."keepr_can_access_asset"("asset_id", "auth"."uid"()));



CREATE POLICY "thread participants can create messages" ON "public"."asset_thread_messages" FOR INSERT WITH CHECK ((("auth"."uid"() = "from_user_id") AND (EXISTS ( SELECT 1
   FROM "public"."asset_threads" "t"
  WHERE (("t"."id" = "asset_thread_messages"."thread_id") AND (("auth"."uid"() = "t"."owner_id") OR ("auth"."uid"() = "t"."created_by")))))));



CREATE POLICY "thread participants can create threads" ON "public"."asset_threads" FOR INSERT WITH CHECK (("auth"."uid"() = "created_by"));



CREATE POLICY "thread participants can read each other's profiles" ON "public"."profiles" FOR SELECT TO "authenticated" USING ((("id" = "auth"."uid"()) OR (EXISTS ( SELECT 1
   FROM "public"."asset_threads" "t"
  WHERE ((("t"."owner_id" = "auth"."uid"()) OR ("t"."created_by" = "auth"."uid"())) AND (("t"."owner_id" = "profiles"."id") OR ("t"."created_by" = "profiles"."id")))))));



CREATE POLICY "thread participants can read messages" ON "public"."asset_thread_messages" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."asset_threads" "t"
  WHERE (("t"."id" = "asset_thread_messages"."thread_id") AND (("auth"."uid"() = "t"."owner_id") OR ("auth"."uid"() = "t"."created_by"))))));



CREATE POLICY "thread participants can read threads" ON "public"."asset_threads" FOR SELECT USING ((("auth"."uid"() = "owner_id") OR ("auth"."uid"() = "created_by")));



ALTER TABLE "public"."thumbnail_jobs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "transfers_select" ON "public"."asset_transfers" FOR SELECT USING ((("from_user_id" = "auth"."uid"()) OR ("to_user_id" = "auth"."uid"())));



CREATE POLICY "transfers_write_none" ON "public"."asset_transfers" USING (false) WITH CHECK (false);



CREATE POLICY "update_own_readiness" ON "public"."system_readiness" FOR UPDATE USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "users_delete_own_intake" ON "public"."email_intake_addresses" FOR DELETE TO "authenticated" USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "users_insert_own_intake" ON "public"."email_intake_addresses" FOR INSERT TO "authenticated" WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "users_select_own_intake" ON "public"."email_intake_addresses" FOR SELECT TO "authenticated" USING (("owner_id" = "auth"."uid"()));



CREATE POLICY "users_update_own_intake" ON "public"."email_intake_addresses" FOR UPDATE TO "authenticated" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



ALTER TABLE "public"."vehicle_systems" ENABLE ROW LEVEL SECURITY;




GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






GRANT ALL ON FUNCTION "public"."accept_asset_transfer"("p_inbox_item_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."accept_asset_transfer"("p_inbox_item_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_asset_transfer"("p_inbox_item_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."accept_asset_transfer"("p_inbox_item_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."accept_asset_transfer"("p_inbox_item_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_asset_transfer"("p_inbox_item_id" "uuid", "p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."accept_asset_transfer_simple"("p_inbox_item_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."accept_asset_transfer_simple"("p_inbox_item_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."accept_asset_transfer_simple"("p_inbox_item_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."add_org_creator_as_owner"() TO "anon";
GRANT ALL ON FUNCTION "public"."add_org_creator_as_owner"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_org_creator_as_owner"() TO "service_role";



GRANT ALL ON FUNCTION "public"."add_org_member_by_email"("p_org_id" "uuid", "p_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."add_org_member_by_email"("p_org_id" "uuid", "p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."add_org_member_by_email"("p_org_id" "uuid", "p_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_action_proposal"("p_proposal_id" "uuid", "p_decided_by" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."apply_action_proposal"("p_proposal_id" "uuid", "p_decided_by" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_action_proposal"("p_proposal_id" "uuid", "p_decided_by" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_action_proposal_v1_plus"("p_proposal_id" "uuid", "p_decided_by" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."apply_action_proposal_v1_plus"("p_proposal_id" "uuid", "p_decided_by" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_action_proposal_v1_plus"("p_proposal_id" "uuid", "p_decided_by" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."apply_enrichment_run"("p_run_id" "uuid", "p_decided_by" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."apply_enrichment_run"("p_run_id" "uuid", "p_decided_by" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."apply_enrichment_run"("p_run_id" "uuid", "p_decided_by" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."can_create_asset"() TO "anon";
GRANT ALL ON FUNCTION "public"."can_create_asset"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."can_create_asset"() TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_inbox_items_for_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."claim_inbox_items_for_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_inbox_items_for_new_user"() TO "service_role";



GRANT ALL ON TABLE "public"."event_inbox" TO "anon";
GRANT ALL ON TABLE "public"."event_inbox" TO "authenticated";
GRANT ALL ON TABLE "public"."event_inbox" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_event_inbox_from_mode"("p_title" "text", "p_notes" "text", "p_occurred_at" "date", "p_amount_cents" integer, "p_currency" "text", "p_asset_id" "uuid", "p_system_id" "uuid", "p_home_system_id" "uuid", "p_keepr_pro_id" "uuid", "p_context" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."create_event_inbox_from_mode"("p_title" "text", "p_notes" "text", "p_occurred_at" "date", "p_amount_cents" integer, "p_currency" "text", "p_asset_id" "uuid", "p_system_id" "uuid", "p_home_system_id" "uuid", "p_keepr_pro_id" "uuid", "p_context" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_event_inbox_from_mode"("p_title" "text", "p_notes" "text", "p_occurred_at" "date", "p_amount_cents" integer, "p_currency" "text", "p_asset_id" "uuid", "p_system_id" "uuid", "p_home_system_id" "uuid", "p_keepr_pro_id" "uuid", "p_context" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_inbox_item_by_email"("p_to_email" "text", "p_type" "text", "p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_inbox_item_by_email"("p_to_email" "text", "p_type" "text", "p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."create_inbox_item_by_email"("p_to_email" "text", "p_type" "text", "p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_inbox_item_by_email"("p_to_email" "text", "p_type" "text", "p_payload" "jsonb") TO "service_role";



GRANT ALL ON TABLE "public"."master_assets" TO "anon";
GRANT ALL ON TABLE "public"."master_assets" TO "authenticated";
GRANT ALL ON TABLE "public"."master_assets" TO "service_role";



GRANT ALL ON FUNCTION "public"."create_master_asset_for_user"("p_asset_type" "text", "p_manufacturer" "text", "p_model" "text", "p_model_year" integer, "p_vin" "text", "p_hin" "text", "p_serial" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."create_master_asset_for_user"("p_asset_type" "text", "p_manufacturer" "text", "p_model" "text", "p_model_year" integer, "p_vin" "text", "p_hin" "text", "p_serial" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_master_asset_for_user"("p_asset_type" "text", "p_manufacturer" "text", "p_model" "text", "p_model_year" integer, "p_vin" "text", "p_hin" "text", "p_serial" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."decline_asset_transfer"("p_inbox_item_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."decline_asset_transfer"("p_inbox_item_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."decline_asset_transfer"("p_inbox_item_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."decline_asset_transfer"("p_inbox_item_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."decline_asset_transfer"("p_inbox_item_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."decline_asset_transfer"("p_inbox_item_id" "uuid", "p_user_id" "uuid") TO "service_role";





GRANT ALL ON FUNCTION "public"."enforce_org_member_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."enforce_org_member_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."enforce_org_member_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_asset_attachment_placement"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_asset_attachment_placement"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_asset_attachment_placement"() TO "service_role";



GRANT ALL ON FUNCTION "public"."ensure_asset_owner_stewardship"() TO "anon";
GRANT ALL ON FUNCTION "public"."ensure_asset_owner_stewardship"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_asset_owner_stewardship"() TO "service_role";



GRANT ALL ON FUNCTION "public"."find_user_id_by_email"("p_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."find_user_id_by_email"("p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."find_user_id_by_email"("p_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."generate_kac"() TO "anon";
GRANT ALL ON FUNCTION "public"."generate_kac"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_kac"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."generate_owner_systems_package"("p_asset_id" "uuid", "p_title" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_owner_systems_package"("p_asset_id" "uuid", "p_title" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_owner_systems_package"("p_asset_id" "uuid", "p_title" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_owner_systems_package"("p_asset_id" "uuid", "p_title" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."generate_system_readiness_package"("p_system_id" "uuid", "p_title" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_system_readiness_package"("p_system_id" "uuid", "p_title" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_system_readiness_package"("p_system_id" "uuid", "p_title" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_system_readiness_package"("p_system_id" "uuid", "p_title" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."generate_timeline_cost_package"("p_asset_id" "uuid", "p_title" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_timeline_cost_package"("p_asset_id" "uuid", "p_title" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."generate_timeline_cost_package"("p_asset_id" "uuid", "p_title" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."generate_timeline_cost_package"("p_asset_id" "uuid", "p_title" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_asset_keepr_progress"("p_asset_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_asset_keepr_progress"("p_asset_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_asset_keepr_progress"("p_asset_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_dashboard_hero_attachments"("placement_ids" "uuid"[]) TO "anon";
GRANT ALL ON FUNCTION "public"."get_dashboard_hero_attachments"("placement_ids" "uuid"[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_dashboard_hero_attachments"("placement_ids" "uuid"[]) TO "service_role";



GRANT ALL ON FUNCTION "public"."get_hub_members_for_view"("p_hub_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_hub_members_for_view"("p_hub_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_hub_members_for_view"("p_hub_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_hub_stories_for_view"("p_hub_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_hub_stories_for_view"("p_hub_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_hub_stories_for_view"("p_hub_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_hub_story_asset_owner"("p_asset_id" "uuid", "p_hub_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_hub_story_asset_owner"("p_asset_id" "uuid", "p_hub_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_hub_story_asset_owner"("p_asset_id" "uuid", "p_hub_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_achievements"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_achievements"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_achievements"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_public_asset_view"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_asset_view"("p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_asset_view"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_asset_view"("p_token" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_public_system_package"("p_token" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_public_system_package"("p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_public_system_package"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_public_system_package"("p_token" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_system_package"("p_system_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_system_package"("p_system_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."get_system_package"("p_system_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_system_package"("p_system_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."is_active_hub_member"("p_hub_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_active_hub_member"("p_hub_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_active_hub_member"("p_hub_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_hub_admin"("p_hub_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_hub_admin"("p_hub_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_hub_admin"("p_hub_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_team_active"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_team_active"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_team_active"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."keepr_asset_id_for_attachment_placement"("p_target_type" "text", "p_target_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."keepr_asset_id_for_attachment_placement"("p_target_type" "text", "p_target_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."keepr_asset_id_for_attachment_placement"("p_target_type" "text", "p_target_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."keepr_asset_id_for_attachment_placement"("p_target_type" "text", "p_target_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."keepr_asset_id_from_object_name"("p_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."keepr_asset_id_from_object_name"("p_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."keepr_asset_id_from_object_name"("p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."keepr_asset_id_from_object_name"("p_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."keepr_asset_limit_for_plan"("p_plan" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."keepr_asset_limit_for_plan"("p_plan" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."keepr_asset_limit_for_plan"("p_plan" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."keepr_can_access_asset"("p_asset_id" "uuid", "p_user" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."keepr_can_access_asset"("p_asset_id" "uuid", "p_user" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."keepr_can_access_asset"("p_asset_id" "uuid", "p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."keepr_can_access_asset"("p_asset_id" "uuid", "p_user" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."keepr_enforce_asset_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."keepr_enforce_asset_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."keepr_enforce_asset_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."keepr_enforce_plan_downgrade_storage"() TO "anon";
GRANT ALL ON FUNCTION "public"."keepr_enforce_plan_downgrade_storage"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."keepr_enforce_plan_downgrade_storage"() TO "service_role";



GRANT ALL ON FUNCTION "public"."keepr_enforce_storage_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."keepr_enforce_storage_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."keepr_enforce_storage_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."keepr_enforce_systems_per_asset_limit"() TO "anon";
GRANT ALL ON FUNCTION "public"."keepr_enforce_systems_per_asset_limit"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."keepr_enforce_systems_per_asset_limit"() TO "service_role";



GRANT ALL ON FUNCTION "public"."keepr_is_asset_collaborator"("p_asset_id" "uuid", "p_user" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."keepr_is_asset_collaborator"("p_asset_id" "uuid", "p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."keepr_is_asset_collaborator"("p_asset_id" "uuid", "p_user" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."keepr_is_asset_owner"("p_asset_id" "uuid", "p_user" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."keepr_is_asset_owner"("p_asset_id" "uuid", "p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."keepr_is_asset_owner"("p_asset_id" "uuid", "p_user" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."keepr_is_org_member"("p_org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."keepr_is_org_member"("p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."keepr_is_org_member"("p_org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."keepr_is_org_member"("p_org_id" "uuid", "p_user" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."keepr_is_org_member"("p_org_id" "uuid", "p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."keepr_is_org_member"("p_org_id" "uuid", "p_user" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."keepr_is_org_owner"("p_org_id" "uuid", "p_user" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."keepr_is_org_owner"("p_org_id" "uuid", "p_user" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."keepr_is_org_owner"("p_org_id" "uuid", "p_user" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."keepr_is_org_owner"("p_org_id" "uuid", "p_user" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."keepr_plan_limit_bytes_for_plan"("p_plan" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."keepr_plan_limit_bytes_for_plan"("p_plan" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."keepr_plan_limit_bytes_for_plan"("p_plan" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."keepr_profile_id_by_email"("p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."keepr_profile_id_by_email"("p_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."keepr_profile_id_by_email"("p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."keepr_profile_id_by_email"("p_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."keepr_profile_sensitive_update_allowed"() TO "anon";
GRANT ALL ON FUNCTION "public"."keepr_profile_sensitive_update_allowed"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."keepr_profile_sensitive_update_allowed"() TO "service_role";



GRANT ALL ON FUNCTION "public"."keepr_protect_profile_sensitive_fields"() TO "anon";
GRANT ALL ON FUNCTION "public"."keepr_protect_profile_sensitive_fields"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."keepr_protect_profile_sensitive_fields"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."keepr_resolve_attachment_storage_path"("p_attachment_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."keepr_resolve_attachment_storage_path"("p_attachment_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."keepr_resolve_attachment_storage_path"("p_attachment_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."keepr_resolve_attachment_storage_path"("p_attachment_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."keepr_resolve_kac_for_manifest_admin"("p_kac" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."keepr_resolve_kac_for_manifest_admin"("p_kac" "text") TO "authenticated";



GRANT ALL ON FUNCTION "public"."keepr_safe_bigint"("p_text" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."keepr_safe_bigint"("p_text" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."keepr_safe_bigint"("p_text" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."keepr_storage_limit_bytes_for_plan"("p_plan" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."keepr_storage_limit_bytes_for_plan"("p_plan" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."keepr_storage_limit_bytes_for_plan"("p_plan" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."keepr_storage_resolve_owner"("p_owner" "uuid", "p_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."keepr_storage_resolve_owner"("p_owner" "uuid", "p_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."keepr_storage_resolve_owner"("p_owner" "uuid", "p_name" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."keepr_storage_usage_bytes"("p_owner" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."keepr_storage_usage_bytes"("p_owner" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."keepr_storage_usage_bytes"("p_owner" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."keepr_systems_per_asset_limit_for_plan"("p_plan" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."keepr_systems_per_asset_limit_for_plan"("p_plan" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."keepr_systems_per_asset_limit_for_plan"("p_plan" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."keepr_user_id_by_email"("p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."keepr_user_id_by_email"("p_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."keepr_user_id_by_email"("p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."keepr_user_id_by_email"("p_email" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."keepr_user_plan"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."keepr_user_plan"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."keepr_user_plan"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."owner_systems_report_rows"("p_asset_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."owner_systems_report_rows"("p_asset_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."owner_systems_report_rows"("p_asset_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."plan_limits"("tier" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."plan_limits"("tier" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."plan_limits"("tier" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."promote_event_to_service_record"("p_event_id" "uuid", "p_owner_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."promote_event_to_service_record"("p_event_id" "uuid", "p_owner_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."promote_event_to_service_record"("p_event_id" "uuid", "p_owner_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."promote_event_to_service_record"("p_event_id" "uuid", "p_owner_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."remove_org_member"("p_org_id" "uuid", "p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."remove_org_member"("p_org_id" "uuid", "p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."remove_org_member"("p_org_id" "uuid", "p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."resolve_kac"("p_kac" "text", "p_channel" "text", "p_action" "text", "p_context" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."resolve_kac"("p_kac" "text", "p_channel" "text", "p_action" "text", "p_context" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."resolve_kac"("p_kac" "text", "p_channel" "text", "p_action" "text", "p_context" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."resolve_kac"("p_kac" "text", "p_channel" "text", "p_action" "text", "p_context" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_attachment_org_id_from_stewardship"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_attachment_org_id_from_stewardship"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_attachment_org_id_from_stewardship"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_current_timestamp_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_current_timestamp_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_current_timestamp_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."sync_profile_email"() TO "anon";
GRANT ALL ON FUNCTION "public"."sync_profile_email"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."sync_profile_email"() TO "service_role";



GRANT ALL ON FUNCTION "public"."system_readiness_set_user_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."system_readiness_set_user_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."system_readiness_set_user_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."timeline_cost_detail_rows"("p_asset_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."timeline_cost_detail_rows"("p_asset_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."timeline_cost_detail_rows"("p_asset_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."timeline_cost_year_rollup_rows"("p_asset_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."timeline_cost_year_rollup_rows"("p_asset_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."timeline_cost_year_rollup_rows"("p_asset_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."user_asset_count"("uid" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."user_asset_count"("uid" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."user_asset_count"("uid" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."action_proposals" TO "anon";
GRANT ALL ON TABLE "public"."action_proposals" TO "authenticated";
GRANT ALL ON TABLE "public"."action_proposals" TO "service_role";



GRANT ALL ON TABLE "public"."action_types" TO "anon";
GRANT ALL ON TABLE "public"."action_types" TO "authenticated";
GRANT ALL ON TABLE "public"."action_types" TO "service_role";



GRANT ALL ON TABLE "public"."actions" TO "anon";
GRANT ALL ON TABLE "public"."actions" TO "authenticated";
GRANT ALL ON TABLE "public"."actions" TO "service_role";



GRANT ALL ON TABLE "public"."admin_asset_story_summary" TO "anon";
GRANT ALL ON TABLE "public"."admin_asset_story_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_asset_story_summary" TO "service_role";



GRANT ALL ON TABLE "public"."admin_system_story_summary" TO "anon";
GRANT ALL ON TABLE "public"."admin_system_story_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_system_story_summary" TO "service_role";



GRANT ALL ON TABLE "public"."admin_user_assets" TO "anon";
GRANT ALL ON TABLE "public"."admin_user_assets" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_user_assets" TO "service_role";



GRANT ALL ON TABLE "public"."assets" TO "anon";
GRANT ALL ON TABLE "public"."assets" TO "authenticated";
GRANT ALL ON TABLE "public"."assets" TO "service_role";



GRANT ALL ON TABLE "public"."attachments" TO "anon";
GRANT ALL ON TABLE "public"."attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."attachments" TO "service_role";



GRANT ALL ON TABLE "public"."service_records" TO "anon";
GRANT ALL ON TABLE "public"."service_records" TO "authenticated";
GRANT ALL ON TABLE "public"."service_records" TO "service_role";



GRANT ALL ON TABLE "public"."systems" TO "anon";
GRANT ALL ON TABLE "public"."systems" TO "authenticated";
GRANT ALL ON TABLE "public"."systems" TO "service_role";



GRANT ALL ON TABLE "public"."admin_user_story_summary" TO "anon";
GRANT ALL ON TABLE "public"."admin_user_story_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."admin_user_story_summary" TO "service_role";



GRANT ALL ON TABLE "public"."asset_engagement_events" TO "anon";
GRANT ALL ON TABLE "public"."asset_engagement_events" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_engagement_events" TO "service_role";



GRANT ALL ON TABLE "public"."asset_files" TO "anon";
GRANT ALL ON TABLE "public"."asset_files" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_files" TO "service_role";



GRANT ALL ON TABLE "public"."asset_identifiers" TO "anon";
GRANT ALL ON TABLE "public"."asset_identifiers" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_identifiers" TO "service_role";



GRANT ALL ON TABLE "public"."asset_members" TO "anon";
GRANT ALL ON TABLE "public"."asset_members" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_members" TO "service_role";



GRANT ALL ON TABLE "public"."asset_photos" TO "anon";
GRANT ALL ON TABLE "public"."asset_photos" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_photos" TO "service_role";



GRANT ALL ON TABLE "public"."asset_stewards" TO "anon";
GRANT ALL ON TABLE "public"."asset_stewards" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_stewards" TO "service_role";



GRANT ALL ON TABLE "public"."asset_stewardships" TO "anon";
GRANT ALL ON TABLE "public"."asset_stewardships" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_stewardships" TO "service_role";



GRANT ALL ON TABLE "public"."asset_thread_messages" TO "anon";
GRANT ALL ON TABLE "public"."asset_thread_messages" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_thread_messages" TO "service_role";



GRANT ALL ON TABLE "public"."asset_threads" TO "anon";
GRANT ALL ON TABLE "public"."asset_threads" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_threads" TO "service_role";



GRANT ALL ON TABLE "public"."asset_transfers" TO "anon";
GRANT ALL ON TABLE "public"."asset_transfers" TO "authenticated";
GRANT ALL ON TABLE "public"."asset_transfers" TO "service_role";



GRANT ALL ON TABLE "public"."assurance_records" TO "anon";
GRANT ALL ON TABLE "public"."assurance_records" TO "authenticated";
GRANT ALL ON TABLE "public"."assurance_records" TO "service_role";



GRANT ALL ON TABLE "public"."attachment_links" TO "anon";
GRANT ALL ON TABLE "public"."attachment_links" TO "authenticated";
GRANT ALL ON TABLE "public"."attachment_links" TO "service_role";



GRANT ALL ON TABLE "public"."attachment_meta" TO "anon";
GRANT ALL ON TABLE "public"."attachment_meta" TO "authenticated";
GRANT ALL ON TABLE "public"."attachment_meta" TO "service_role";



GRANT ALL ON TABLE "public"."attachment_meta_backup_20260226" TO "anon";
GRANT ALL ON TABLE "public"."attachment_meta_backup_20260226" TO "authenticated";
GRANT ALL ON TABLE "public"."attachment_meta_backup_20260226" TO "service_role";



GRANT ALL ON TABLE "public"."attachment_placements" TO "anon";
GRANT ALL ON TABLE "public"."attachment_placements" TO "authenticated";
GRANT ALL ON TABLE "public"."attachment_placements" TO "service_role";



GRANT ALL ON TABLE "public"."attachment_placements_backup_20260226" TO "anon";
GRANT ALL ON TABLE "public"."attachment_placements_backup_20260226" TO "authenticated";
GRANT ALL ON TABLE "public"."attachment_placements_backup_20260226" TO "service_role";



GRANT ALL ON TABLE "public"."attachments_backup_20260226" TO "anon";
GRANT ALL ON TABLE "public"."attachments_backup_20260226" TO "authenticated";
GRANT ALL ON TABLE "public"."attachments_backup_20260226" TO "service_role";



GRANT ALL ON TABLE "public"."boat_systems" TO "anon";
GRANT ALL ON TABLE "public"."boat_systems" TO "authenticated";
GRANT ALL ON TABLE "public"."boat_systems" TO "service_role";



GRANT ALL ON TABLE "public"."email_intake_addresses" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."email_intake_addresses" TO "authenticated";



GRANT ALL ON TABLE "public"."enrichment_runs" TO "anon";
GRANT ALL ON TABLE "public"."enrichment_runs" TO "authenticated";
GRANT ALL ON TABLE "public"."enrichment_runs" TO "service_role";



GRANT ALL ON TABLE "public"."environment_profiles" TO "anon";
GRANT ALL ON TABLE "public"."environment_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."environment_profiles" TO "service_role";



GRANT ALL ON SEQUENCE "public"."environment_profiles_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."environment_profiles_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."environment_profiles_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."event_inbox_attachments" TO "anon";
GRANT ALL ON TABLE "public"."event_inbox_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."event_inbox_attachments" TO "service_role";



GRANT ALL ON TABLE "public"."home_system_photos" TO "anon";
GRANT ALL ON TABLE "public"."home_system_photos" TO "authenticated";
GRANT ALL ON TABLE "public"."home_system_photos" TO "service_role";



GRANT ALL ON TABLE "public"."home_systems" TO "anon";
GRANT ALL ON TABLE "public"."home_systems" TO "authenticated";
GRANT ALL ON TABLE "public"."home_systems" TO "service_role";



GRANT ALL ON TABLE "public"."hub_members" TO "anon";
GRANT ALL ON TABLE "public"."hub_members" TO "authenticated";
GRANT ALL ON TABLE "public"."hub_members" TO "service_role";



GRANT ALL ON TABLE "public"."hub_story_links" TO "anon";
GRANT ALL ON TABLE "public"."hub_story_links" TO "authenticated";
GRANT ALL ON TABLE "public"."hub_story_links" TO "service_role";



GRANT ALL ON TABLE "public"."hub_story_requests" TO "anon";
GRANT ALL ON TABLE "public"."hub_story_requests" TO "authenticated";
GRANT ALL ON TABLE "public"."hub_story_requests" TO "service_role";



GRANT ALL ON TABLE "public"."hubs" TO "anon";
GRANT ALL ON TABLE "public"."hubs" TO "authenticated";
GRANT ALL ON TABLE "public"."hubs" TO "service_role";



GRANT ALL ON TABLE "public"."inbox_items" TO "anon";
GRANT ALL ON TABLE "public"."inbox_items" TO "authenticated";
GRANT ALL ON TABLE "public"."inbox_items" TO "service_role";



GRANT ALL ON TABLE "public"."invite_events" TO "anon";
GRANT ALL ON TABLE "public"."invite_events" TO "authenticated";
GRANT ALL ON TABLE "public"."invite_events" TO "service_role";



GRANT ALL ON TABLE "public"."keepr_pros" TO "anon";
GRANT ALL ON TABLE "public"."keepr_pros" TO "authenticated";
GRANT ALL ON TABLE "public"."keepr_pros" TO "service_role";



GRANT ALL ON TABLE "public"."locations" TO "anon";
GRANT ALL ON TABLE "public"."locations" TO "authenticated";
GRANT ALL ON TABLE "public"."locations" TO "service_role";



GRANT ALL ON TABLE "public"."loose_notes" TO "anon";
GRANT ALL ON TABLE "public"."loose_notes" TO "authenticated";
GRANT ALL ON TABLE "public"."loose_notes" TO "service_role";



GRANT ALL ON TABLE "public"."maintenance_events" TO "anon";
GRANT ALL ON TABLE "public"."maintenance_events" TO "authenticated";
GRANT ALL ON TABLE "public"."maintenance_events" TO "service_role";



GRANT ALL ON TABLE "public"."maintenance_reminders" TO "anon";
GRANT ALL ON TABLE "public"."maintenance_reminders" TO "authenticated";
GRANT ALL ON TABLE "public"."maintenance_reminders" TO "service_role";



GRANT ALL ON TABLE "public"."maturity_requirements" TO "anon";
GRANT ALL ON TABLE "public"."maturity_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."maturity_requirements" TO "service_role";



GRANT ALL ON SEQUENCE "public"."maturity_requirements_id_seq" TO "anon";
GRANT ALL ON SEQUENCE "public"."maturity_requirements_id_seq" TO "authenticated";
GRANT ALL ON SEQUENCE "public"."maturity_requirements_id_seq" TO "service_role";



GRANT ALL ON TABLE "public"."notifications" TO "anon";
GRANT ALL ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."object_actions" TO "anon";
GRANT ALL ON TABLE "public"."object_actions" TO "authenticated";
GRANT ALL ON TABLE "public"."object_actions" TO "service_role";



GRANT ALL ON TABLE "public"."object_attachments" TO "anon";
GRANT ALL ON TABLE "public"."object_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."object_attachments" TO "service_role";



GRANT ALL ON TABLE "public"."object_links" TO "anon";
GRANT ALL ON TABLE "public"."object_links" TO "authenticated";
GRANT ALL ON TABLE "public"."object_links" TO "service_role";



GRANT ALL ON TABLE "public"."object_type_actions" TO "anon";
GRANT ALL ON TABLE "public"."object_type_actions" TO "authenticated";
GRANT ALL ON TABLE "public"."object_type_actions" TO "service_role";



GRANT ALL ON TABLE "public"."object_types" TO "anon";
GRANT ALL ON TABLE "public"."object_types" TO "authenticated";
GRANT ALL ON TABLE "public"."object_types" TO "service_role";



GRANT ALL ON TABLE "public"."objects" TO "anon";
GRANT ALL ON TABLE "public"."objects" TO "authenticated";
GRANT ALL ON TABLE "public"."objects" TO "service_role";



GRANT ALL ON TABLE "public"."odometer_anchors" TO "anon";
GRANT ALL ON TABLE "public"."odometer_anchors" TO "authenticated";
GRANT ALL ON TABLE "public"."odometer_anchors" TO "service_role";



GRANT ALL ON TABLE "public"."org_members" TO "anon";
GRANT ALL ON TABLE "public"."org_members" TO "authenticated";
GRANT ALL ON TABLE "public"."org_members" TO "service_role";



GRANT ALL ON TABLE "public"."orgs" TO "anon";
GRANT ALL ON TABLE "public"."orgs" TO "authenticated";
GRANT ALL ON TABLE "public"."orgs" TO "service_role";



GRANT ALL ON TABLE "public"."ownership_bands" TO "anon";
GRANT ALL ON TABLE "public"."ownership_bands" TO "authenticated";
GRANT ALL ON TABLE "public"."ownership_bands" TO "service_role";



GRANT ALL ON TABLE "public"."package_artifacts" TO "anon";
GRANT ALL ON TABLE "public"."package_artifacts" TO "authenticated";
GRANT ALL ON TABLE "public"."package_artifacts" TO "service_role";



GRANT ALL ON TABLE "public"."package_rows" TO "anon";
GRANT ALL ON TABLE "public"."package_rows" TO "authenticated";
GRANT ALL ON TABLE "public"."package_rows" TO "service_role";



GRANT ALL ON TABLE "public"."packages" TO "anon";
GRANT ALL ON TABLE "public"."packages" TO "authenticated";
GRANT ALL ON TABLE "public"."packages" TO "service_role";



GRANT ALL ON TABLE "public"."photos" TO "anon";
GRANT ALL ON TABLE "public"."photos" TO "authenticated";
GRANT ALL ON TABLE "public"."photos" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."public_asset_story_gallery" TO "anon";
GRANT ALL ON TABLE "public"."public_asset_story_gallery" TO "authenticated";
GRANT ALL ON TABLE "public"."public_asset_story_gallery" TO "service_role";



GRANT ALL ON TABLE "public"."public_asset_story_summary" TO "anon";
GRANT ALL ON TABLE "public"."public_asset_story_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."public_asset_story_summary" TO "service_role";



GRANT ALL ON TABLE "public"."public_asset_story_systems" TO "anon";
GRANT ALL ON TABLE "public"."public_asset_story_systems" TO "authenticated";
GRANT ALL ON TABLE "public"."public_asset_story_systems" TO "service_role";



GRANT ALL ON TABLE "public"."public_asset_story_timeline" TO "anon";
GRANT ALL ON TABLE "public"."public_asset_story_timeline" TO "authenticated";
GRANT ALL ON TABLE "public"."public_asset_story_timeline" TO "service_role";



GRANT ALL ON TABLE "public"."public_asset_thread_tokens" TO "anon";
GRANT ALL ON TABLE "public"."public_asset_thread_tokens" TO "authenticated";
GRANT ALL ON TABLE "public"."public_asset_thread_tokens" TO "service_role";



GRANT ALL ON TABLE "public"."public_intake_events" TO "anon";
GRANT ALL ON TABLE "public"."public_intake_events" TO "authenticated";
GRANT ALL ON TABLE "public"."public_intake_events" TO "service_role";



GRANT ALL ON TABLE "public"."public_links" TO "anon";
GRANT ALL ON TABLE "public"."public_links" TO "authenticated";
GRANT ALL ON TABLE "public"."public_links" TO "service_role";



GRANT ALL ON TABLE "public"."reminder_attachments" TO "anon";
GRANT ALL ON TABLE "public"."reminder_attachments" TO "authenticated";
GRANT ALL ON TABLE "public"."reminder_attachments" TO "service_role";



GRANT ALL ON TABLE "public"."reminders" TO "anon";
GRANT ALL ON TABLE "public"."reminders" TO "authenticated";
GRANT ALL ON TABLE "public"."reminders" TO "service_role";



GRANT ALL ON TABLE "public"."service_entries" TO "anon";
GRANT ALL ON TABLE "public"."service_entries" TO "authenticated";
GRANT ALL ON TABLE "public"."service_entries" TO "service_role";



GRANT ALL ON TABLE "public"."service_photos" TO "anon";
GRANT ALL ON TABLE "public"."service_photos" TO "authenticated";
GRANT ALL ON TABLE "public"."service_photos" TO "service_role";



GRANT ALL ON TABLE "public"."service_record_documents" TO "anon";
GRANT ALL ON TABLE "public"."service_record_documents" TO "authenticated";
GRANT ALL ON TABLE "public"."service_record_documents" TO "service_role";



GRANT ALL ON TABLE "public"."service_record_photos" TO "anon";
GRANT ALL ON TABLE "public"."service_record_photos" TO "authenticated";
GRANT ALL ON TABLE "public"."service_record_photos" TO "service_role";



GRANT ALL ON TABLE "public"."story_events" TO "anon";
GRANT ALL ON TABLE "public"."story_events" TO "authenticated";
GRANT ALL ON TABLE "public"."story_events" TO "service_role";



GRANT ALL ON TABLE "public"."system_photos" TO "anon";
GRANT ALL ON TABLE "public"."system_photos" TO "authenticated";
GRANT ALL ON TABLE "public"."system_photos" TO "service_role";



GRANT ALL ON TABLE "public"."system_readiness" TO "anon";
GRANT ALL ON TABLE "public"."system_readiness" TO "authenticated";
GRANT ALL ON TABLE "public"."system_readiness" TO "service_role";



GRANT ALL ON TABLE "public"."system_service_records" TO "anon";
GRANT ALL ON TABLE "public"."system_service_records" TO "authenticated";
GRANT ALL ON TABLE "public"."system_service_records" TO "service_role";



GRANT ALL ON TABLE "public"."system_stewards" TO "anon";
GRANT ALL ON TABLE "public"."system_stewards" TO "authenticated";
GRANT ALL ON TABLE "public"."system_stewards" TO "service_role";



GRANT ALL ON TABLE "public"."thumbnail_jobs" TO "anon";
GRANT ALL ON TABLE "public"."thumbnail_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."thumbnail_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."timeline_records" TO "anon";
GRANT ALL ON TABLE "public"."timeline_records" TO "authenticated";
GRANT ALL ON TABLE "public"."timeline_records" TO "service_role";



GRANT ALL ON TABLE "public"."user_entitlements" TO "anon";
GRANT ALL ON TABLE "public"."user_entitlements" TO "authenticated";
GRANT ALL ON TABLE "public"."user_entitlements" TO "service_role";



GRANT ALL ON TABLE "public"."vehicle_systems" TO "anon";
GRANT ALL ON TABLE "public"."vehicle_systems" TO "authenticated";
GRANT ALL ON TABLE "public"."vehicle_systems" TO "service_role";



GRANT ALL ON TABLE "public"."warranty_requirements" TO "anon";
GRANT ALL ON TABLE "public"."warranty_requirements" TO "authenticated";
GRANT ALL ON TABLE "public"."warranty_requirements" TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";










