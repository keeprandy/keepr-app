// hooks/useAssets.js
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";

/**
 * useAssets(type, options)
 *
 * Defaults:
 * - ONLY returns assets owned by the current user (owner_id = user.id)
 * - excludes soft-deleted assets (deleted_at IS NULL)
 *
 * options:
 * - includeAllOwners: true  -> admin/dev use (no owner_id filter)
 * - includeDeleted: true    -> includes deleted rows
 *
 * Live updates:
 * - listens to Postgres changes on public.assets and refetches
 */
export function useAssets(type, options = {}) {
  const { user } = useAuth();

  const includeAllOwners = !!options.includeAllOwners;
  const includeDeleted = !!options.includeDeleted;

  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const typeFilter = useMemo(() => {
    if (type === "home" || type === "vehicle" || type === "boat") return type;
    return null;
  }, [type]);

  const ownerId = user?.id || null;

  const fetchAssets = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      // If we're in "owned assets only" mode and we don't have a user yet, return empty
      if (!includeAllOwners && !ownerId) {
        setAssets([]);
        return;
      }

      let query = supabase.from("assets").select("*");

      // IMPORTANT:
      // Do NOT filter by owner_id here.
      // RLS determines which assets are visible (owned + shared via asset_members).
      // includeAllOwners remains for admin usage only.
      if (includeAllOwners) {
        // no owner filter
      }

      // ✅ default: exclude deleted
      if (!includeDeleted) {
        query = query.is("deleted_at", null);
      }

      // ✅ optional type filter
      if (typeFilter) {
        query = query.eq("type", typeFilter);
      }

      // ✅ ordering: explicit sort_rank first, then created_at
      query = query
        .order("sort_rank", { ascending: true, nullsLast: true })
        .order("created_at", { ascending: true });

      const { data, error: fetchError } = await query;
      if (fetchError) throw fetchError;

      setAssets(data || []);
    } catch (err) {
      console.error("useAssets fetchAssets error", err);
      setError(err?.message || "Failed to load assets.");
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, [includeAllOwners, includeDeleted, ownerId, typeFilter]);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  // ✅ Live updates (keeps Dashboard in sync for deletes/edits/transfers)
  useEffect(() => {
    // If we only care about my assets and we don't have a user yet, don't subscribe
    if (!includeAllOwners && !ownerId) return;

    const filterParts = [];

    if (typeFilter) {
      filterParts.push(`type=eq.${typeFilter}`);
    }
    // Note: we still refetch and apply deleted_at filter in fetchAssets()

    const channel = supabase
      .channel(`assets_changes_${includeAllOwners ? "all" : ownerId}_${typeFilter || "all"}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "assets",
          ...(filterParts.length ? { filter: filterParts.join(",") } : {}),
        },
        () => {
          fetchAssets();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [fetchAssets, includeAllOwners, ownerId, typeFilter]);

  return { assets, loading, error, refetch: fetchAssets };
}

export default useAssets;
