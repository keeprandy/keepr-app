// context/WorkspaceContext.js
import React, {
  createContext,
  useContext,
  useState,
  useMemo,
} from "react";

/**
 * WorkspaceContext
 *
 * "Workspace" = which side of Keepr you're in:
 * - My Keepr (personal owner view)
 * - Keepr Pro (e.g., Wilson Marine)
 */

const WorkspaceContext = createContext(null);

const DEFAULT_WORKSPACES = [
  {
    id: "my-keepr",
    type: "personal", // anything that is NOT "pro" is treated as consumer mode
    name: "My Keepr",
    description: "Your personal assets",
  },
  {
    id: "wilson-marine",
    type: "pro",
    name: "Wilson Marine",
    description: "Keepr Pro workspace",
  },
];

export function WorkspaceProvider({ children }) {
  const [workspaces] = useState(DEFAULT_WORKSPACES);
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState(
    "my-keepr"
  );

  const currentWorkspace = useMemo(() => {
    return (
      workspaces.find((w) => w.id === currentWorkspaceId) ||
      workspaces[0]
    );
  }, [workspaces, currentWorkspaceId]);

  /**
   * Set the active workspace by ID.
   * Example: setCurrentWorkspaceId("wilson-marine")
   */
  const setWorkspaceById = (id) => {
    const exists = workspaces.some((w) => w.id === id);
    if (!exists) return;
    setCurrentWorkspaceId(id);
  };

  /**
   * Simple toggle between My Keepr and Keepr Pro.
   * Great for the demo: one tap / gesture to switch viewpoints.
   */
  const toggleWorkspace = () => {
    if (currentWorkspaceId === "my-keepr") {
      setCurrentWorkspaceId("wilson-marine");
    } else {
      setCurrentWorkspaceId("my-keepr");
    }
  };

  const value = {
    workspaces,
    currentWorkspace,
    currentWorkspaceId,
    setCurrentWorkspaceId: setWorkspaceById,
    toggleWorkspace,
  };

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

/**
 * Hook to access workspace info.
 *
 * Example:
 *   const { currentWorkspace, toggleWorkspace } = useWorkspace();
 */
export function useWorkspace() {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error(
      "useWorkspace must be used within a WorkspaceProvider"
    );
  }
  return ctx;
}

