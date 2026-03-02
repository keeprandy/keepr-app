// context/OperationFeedbackContext.js
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from "react";

/**
 * OperationFeedback (global)
 * - showSuccess / showError: centered modal that fades out
 * - showBusy / hideBusy: centered blocking modal for long operations (e.g., Uploading…)
 * - runMutation: wrapper for async actions that guarantees feedback
 *
 * Usage:
 *   const { runMutation, showBusy, hideBusy } = useOperationFeedback();
 *   await runMutation({ action: async () => supabase..., success: "Saved", error: "Couldn't save" });
 */

const OperationFeedbackContext = createContext(null);

export function OperationFeedbackProvider({ children }) {
  // Toast-like center feedback (auto-dismiss)
  const [feedback, setFeedback] = useState({ visible: false, type: "success", message: "" });

  // Busy modal (blocking)
  const [busy, setBusy] = useState({ visible: false, message: "Working…" });

  const feedbackTimerRef = useRef(null);

  const clearFeedbackTimer = () => {
    if (feedbackTimerRef.current) {
      clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = null;
    }
  };

  const showSuccess = useCallback((message = "Saved") => {
    clearFeedbackTimer();
    setFeedback({ visible: true, type: "success", message });
    feedbackTimerRef.current = setTimeout(() => {
      setFeedback((prev) => ({ ...prev, visible: false }));
    }, 1400);
  }, []);

  const showError = useCallback((message = "Something went wrong") => {
    clearFeedbackTimer();
    setFeedback({ visible: true, type: "error", message });
    feedbackTimerRef.current = setTimeout(() => {
      setFeedback((prev) => ({ ...prev, visible: false }));
    }, 2200);
  }, []);

  const hideFeedback = useCallback(() => {
    clearFeedbackTimer();
    setFeedback((prev) => ({ ...prev, visible: false }));
  }, []);

  const showBusy = useCallback((message = "Working…") => {
    setBusy({ visible: true, message });
  }, []);

  const hideBusy = useCallback(() => {
    setBusy((prev) => ({ ...prev, visible: false }));
  }, []);

  /**
   * runMutation
   * - action: async () => { data, error } OR throws
   * - success: string message
   * - error: string message (fallback)
   * - busyMessage: show blocking busy modal if the action takes > busyDelayMs
   */
  const runMutation = useCallback(
    async ({
      action,
      success = "Saved",
      error = "Couldn’t save",
      busyMessage = null,
      busyDelayMs = 450,
      // optional: allow caller to handle errors
      throwOnError = false,
      // optional: transform error message
      mapError = null,
    }) => {
      let busyDelayTimer = null;
      try {
        if (busyMessage) {
          busyDelayTimer = setTimeout(() => showBusy(busyMessage), busyDelayMs);
        }

        const result = await action();

        // Supabase-style result: { data, error }
        if (result && typeof result === "object" && "error" in result && result.error) {
          const msg = mapError ? mapError(result.error) : (result.error.message || error);
          showError(msg || error);
          if (throwOnError) throw result.error;
          return { ok: false, result };
        }

        showSuccess(success);
        return { ok: true, result };
      } catch (e) {
        const msg = mapError ? mapError(e) : (e?.message || error);
        showError(msg || error);
        if (throwOnError) throw e;
        return { ok: false, error: e };
      } finally {
        if (busyDelayTimer) clearTimeout(busyDelayTimer);
        hideBusy();
      }
    },
    [showBusy, hideBusy, showSuccess, showError]
  );

  const value = useMemo(
    () => ({
      feedback,
      busy,
      showSuccess,
      showError,
      hideFeedback,
      showBusy,
      hideBusy,
      runMutation,
    }),
    [feedback, busy, showSuccess, showError, hideFeedback, showBusy, hideBusy, runMutation]
  );

  return <OperationFeedbackContext.Provider value={value}>{children}</OperationFeedbackContext.Provider>;
}

export function useOperationFeedback() {
  const ctx = useContext(OperationFeedbackContext);
  if (!ctx) {
    throw new Error("useOperationFeedback must be used within OperationFeedbackProvider");
  }
  return ctx;
}
