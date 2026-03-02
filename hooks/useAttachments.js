// hooks/useAttachments.js
import { useCallback, useEffect, useState } from "react";
import {
  listAttachmentsForTarget,
  listAttachmentsForAsset,
} from "../lib/attachmentsApi";

/**
 * Generic hook for attachments by target
 * targetType: "asset" | "system" | "record"
 */
export function useAttachments(targetType, targetId) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const refresh = useCallback(async () => {
    if (!targetType || !targetId) {
      setItems([]);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      let rows;

      if (targetType === "asset") {
        // Canonical grouped asset view
        rows = await listAttachmentsForAsset(targetId);
      } else {
        // System / record / other targets
        rows = await listAttachmentsForTarget(targetType, targetId);
      }

      setItems(rows || []);
    } catch (e) {
      setError(e);
    } finally {
      setLoading(false);
    }
  }, [targetType, targetId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { items, loading, error, refresh, setItems };
}

/**
 * Explicit asset-only hook
 * Returns canonical asset attachments with placements[]
 */
export function useAssetAttachments(assetId) {
  return useAttachments("asset", assetId);
}