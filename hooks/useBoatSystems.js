// hooks/useBoatSystems.js
import { useCallback, useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

export function useBoatSystems(assetId) {
  const [systems, setSystems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    if (!assetId) {
      setSystems([]);
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error } = await supabase
      .from("boat_systems")
      .select("*")
      .eq("asset_id", assetId)
      .order("system_type", { ascending: true });

    if (error) {
      console.error("Error loading boat systems", error);
      setError(error.message);
      setSystems([]);
    } else {
      setSystems(data || []);
    }

    setLoading(false);
  }, [assetId]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  return {
    systems,
    loading,
    error,
    refetch,
    setSystems,
  };
}
