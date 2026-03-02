// hooks/useHomeSystems.js
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";
import { useAuth } from "../context/AuthContext";

function isUuid(value) {
  if (!value || typeof value !== "string") return false;
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value
  );
}

export function useHomeSystems(assetId) {
  const { user } = useAuth();
  const [systems, setSystems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchSystems = useCallback(async () => {
    // No user → nothing to load
    if (!user) {
      setSystems([]);
      setError(null);
      setLoading(false);
      return;
    }

    // Guard against old string IDs like "home-primary"
    if (!isUuid(assetId)) {
      console.log("useHomeSystems: skipping query, invalid assetId:", assetId);
      setSystems([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error: queryError } = await supabase
      .from("home_systems")
      .select("*")
      .eq("asset_id", assetId)
      .order("created_at", { ascending: true });

    if (queryError) {
      console.error("Error loading home systems:", queryError);
      setError(queryError.message || "Failed to load home systems");
      setSystems([]);
    } else {
      setSystems(data || []);
    }

    setLoading(false);
  }, [assetId, user?.id]);

  useEffect(() => {
    fetchSystems();
  }, [fetchSystems]);

  return {
    systems,
    loading,
    error,
    refetch: fetchSystems,
  };
}
