// hooks/useAssets.js
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";

const ASSET_FETCH_TIMEOUT_MS = 30000;

function isAssetFetchTimeout(err) {
  return /timed out/i.test(String(err?.message || ""));
}

function withAssetFetchTimeout(request, label) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const query =
    controller && typeof request?.abortSignal === "function"
      ? request.abortSignal(controller.signal)
      : request;
  let timeoutId;
  const timeout = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      controller?.abort?.();
      reject(new Error(`${label || "Asset fetch"} timed out`));
    }, ASSET_FETCH_TIMEOUT_MS);
  });

  return Promise.race([query, timeout]).finally(() => clearTimeout(timeoutId));
}

/**
 * useAssets(type, options)
 *
 * Defaults:
 * - returns assets visible to the current user through RLS
 *   (owned assets plus explicitly shared Team/stewardship assets)
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
  const { user, initializing: authInitializing } = useAuth();

  const includeAllOwners = !!options.includeAllOwners;
  const includeDeleted = !!options.includeDeleted;

  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const assetsRef = useRef([]);
  const requestSeqRef = useRef(0);

  const applyAssets = useCallback((nextAssets) => {
    const safeAssets = Array.isArray(nextAssets) ? nextAssets : [];
    assetsRef.current = safeAssets;
    setAssets(safeAssets);
  }, []);

  const typeFilter = useMemo(() => {
    if (!type) return null;
    return type;
  }, [type]);

  const ownerId = user?.id || null;

  const fetchAssets = useCallback(async () => {
    if (!includeAllOwners && authInitializing) {
      setLoading(true);
      return;
    }

    const requestSeq = requestSeqRef.current + 1;
    requestSeqRef.current = requestSeq;
    setLoading(true);
    setError(null);

    try {
      // If we're in authenticated listing mode and we don't have a user yet, return empty.
      if (!includeAllOwners && !ownerId) {
        applyAssets([]);
        return;
      }
      if (includeAllOwners) {
        let query = supabase.from("assets").select("*");

        if (!includeDeleted) {
          query = query.is("deleted_at", null);
        }

        if (typeFilter) {
          query = query.eq("type", typeFilter);
        }

        query = query
          .order("sort_rank", { ascending: true, nullsLast: true })
          .order("created_at", { ascending: true });

        const { data, error: fetchError } = await withAssetFetchTimeout(
          query,
          `Asset list ${typeFilter || "all"}`
        );
        if (fetchError) throw fetchError;

        if (requestSeqRef.current !== requestSeq) return;
        applyAssets(data || []);
        return;
      }

      const { data, error: fetchError } = await withAssetFetchTimeout(
        supabase.rpc("get_authorized_assets", {
          p_asset_type: typeFilter,
          p_include_deleted: includeDeleted,
        }),
        `Authorized asset list ${typeFilter || "all"}`
      );

      if (fetchError) throw fetchError;

      if (requestSeqRef.current !== requestSeq) return;
      applyAssets((data || []).map((row) => row?.asset).filter(Boolean));
    } catch (err) {
      if (requestSeqRef.current !== requestSeq) return;
      console.error("useAssets fetchAssets error", err);
      if (!isAssetFetchTimeout(err) || assetsRef.current.length === 0) {
        applyAssets([]);
      }
      setError(err?.message || "Failed to load assets.");
    } finally {
      if (requestSeqRef.current === requestSeq) {
        setLoading(false);
      }
    }
  }, [applyAssets, authInitializing, includeAllOwners, includeDeleted, ownerId, typeFilter]);

  useEffect(() => {
    fetchAssets();
  }, [fetchAssets]);

  // ✅ Live updates (keeps Dashboard in sync for deletes/edits/transfers)
  useEffect(() => {
    // If we only care about my assets and we don't have a user yet, don't subscribe
    if (!includeAllOwners && (authInitializing || !ownerId)) return;

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
  }, [authInitializing, fetchAssets, includeAllOwners, ownerId, typeFilter]);

  return { assets, loading: authInitializing || loading, error, refetch: fetchAssets };
}

export default useAssets;
