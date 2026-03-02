import React, { createContext, useCallback, useMemo, useState } from "react";
import EnhanceAttachmentModal from "./EnhanceAttachmentModal";

export const EnhanceContext = createContext(null);

/**
 * Enhance Connector (global singleton)
 *
 * Screens call:
 *   enhance.open({ assetId, attachmentId, placementId, attachment, source })
 *
 *
 * This keeps AAS thin and prevents enrichment logic from living in screens.
 */
export function EnhanceProvider({ children }) {
  const [isOpen, setIsOpen] = useState(false);
  const [input, setInput] = useState(null);

  // Optional Connector configuration (wired once from App.js or a bootstrap module)
  const [config, setConfig] = useState({
    runEnrich: null, // async ({ assetId, attachmentId }) => { run_id, counts, ... }
    applyEnrichRun: null, // async ({ runId }) => { applied_count, ... }
  });

  const configure = useCallback((next = {}) => {
    setConfig((prev) => ({
      ...prev,
      ...next,
    }));
  }, []);

  const open = useCallback((nextInput) => {
    if (!nextInput || !nextInput.assetId) {
      console.log("Enhance.open missing assetId", nextInput);
      return;
    }
    setInput(nextInput);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => {
    setIsOpen(false);
    setInput(null);
  }, []);

  const handleSaved = useCallback(
    (result) => {
      try {
        if (typeof input?.onSaved === "function") input.onSaved(result);
      } finally {
        close();
      }
    },
    [input, close]
  );

  const ctx = useMemo(
    () => ({ open, close, configure }),
    [open, close, configure]
  );

  return (
    <EnhanceContext.Provider value={ctx}>
      {children}
      <EnhanceAttachmentModal
        isOpen={isOpen}
        input={input}
        config={config}
        onClose={close}
        onSaved={handleSaved}
      />
    </EnhanceContext.Provider>
  );
}
