// hooks/useAssetById.js
import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabaseClient";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === "string" && UUID_REGEX.test(value);
}

/**
 * useAssetById
 *
 * Default behavior:
 * - Only returns ACTIVE assets (deleted_at IS NULL)
 *
 * Options:
 * - includeDeleted: true will return deleted rows too (Admin use)
 */
export function useAssetById(id, options = {}) {
  const includeDeleted = !!options.includeDeleted;

  const [asset, setAsset] = useState(null);
  const [loading, setLoading] = useState(!!id);
  const [error, setError] = useState(null);

  const canFetch = useMemo(() => !!id && isUuid(id), [id]);

  const fetchAsset = useCallback(async () => {
    if (!canFetch) {
      setLoading(false);
      setAsset(null);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let q = supabase.from("assets").select("*").eq("id", id);

      // ✅ Global soft-delete rule: exclude deleted unless explicitly requested
      if (!includeDeleted) {
        q = q.is("deleted_at", null);
      }

      const { data, error: qErr } = await q.maybeSingle();

      if (qErr) {
        console.log("useAssetById error:", qErr);
        setError(qErr.message || "Failed to load asset.");
        setAsset(null);
      } else {
        // If soft-deleted and includeDeleted=false, data will be null (correct)
        setAsset(data || null);
        setError(null);
      }
    } catch (e) {
      console.log("useAssetById unexpected error:", e);
      setError(e?.message || "Failed to load asset.");
      setAsset(null);
    } finally {
      setLoading(false);
    }
  }, [canFetch, id, includeDeleted]);

  useEffect(() => {
    fetchAsset();
  }, [fetchAsset]);

  return { asset, loading, error, refetch: fetchAsset };
}
