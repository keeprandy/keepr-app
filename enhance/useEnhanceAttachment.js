import { useContext } from "react";
import { EnhanceContext } from "./EnhanceProvider";

/**
 * Screen-level API: stable entry point.
 * Screens should not own modal state or enrichment logic.
 */
export function useEnhanceAttachment() {
  const ctx = useContext(EnhanceContext);
  if (!ctx) {
    throw new Error(
      "useEnhanceAttachment must be used within an EnhanceProvider (App.js)."
    );
  }
  return ctx; // { open, close, configure }
}
