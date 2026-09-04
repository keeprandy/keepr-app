// context/WorkspaceContext.js
import React, {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import { useAuth } from "./AuthContext";
import { supabase } from "../lib/supabaseClient";

/**
 * WorkspaceContext
 *
 * "Workspace" = which side of Keepr you're in. Workspaces shape navigation
 * and tools. Asset authorization remains relationship-driven in the database.
 */

const WorkspaceContext = createContext(null);

const PERSONAL_FALLBACK_WORKSPACE = {
  workspace_id: "keepr:fallback",
  id: "keepr:fallback",
  workspace_type: "keepr",
  type: "personal",
  label: "Keepr",
  display_name: "My Keepr",
  name: "My Keepr",
  description: "Owner workspace",
  capabilities: [
    "own_assets",
    "manage_owner_care",
    "authorize_relationships",
    "transfer_prepare",
    "owner_projection",
  ],
  authority: {
    subject_type: "profile",
  },
  display: {
    title: "My Keepr",
    subtitle: "Owner workspace",
    icon: "person-outline",
  },
  metadata: {
    source: "client_fallback",
    is_personal_workspace: true,
  },
};

const LEGACY_PRO_FALLBACK_WORKSPACE = {
  workspace_id: "legacy:keeprpro",
  id: "legacy:keeprpro",
  workspace_type: "keeprpro",
  type: "pro",
  label: "KeeprPro",
  display_name: "KeeprPro",
  name: "KeeprPro",
  description: "Service provider workspace",
  capabilities: [
    "service_provider",
    "service_workspace",
    "service_records",
    "provider_messaging",
  ],
  authority: {
    subject_type: "legacy_profile_role",
    legacy_profile_role: "keeprpro",
  },
  display: {
    title: "KeeprPro",
    subtitle: "Legacy KeeprPro workspace",
    icon: "briefcase-outline",
  },
  metadata: {
    source: "legacy_profile_role_fallback",
  },
};

function normalizeWorkspace(row) {
  const workspaceType = row?.workspace_type || row?.type || "keepr";
  const id = row?.workspace_id || row?.id || "keepr:fallback";

  return {
    ...row,
    id,
    workspace_id: id,
    workspace_type: workspaceType,
    type: workspaceType === "keepr" ? "personal" : workspaceType === "keeprpro" ? "pro" : workspaceType,
    name: row?.display_name || row?.name || row?.label || "Workspace",
    display_name: row?.display_name || row?.name || row?.label || "Workspace",
    capabilities: Array.isArray(row?.capabilities) ? row.capabilities : [],
    authority: row?.authority || {},
    display: row?.display || {},
    metadata: row?.metadata || {},
  };
}

function fallbackWorkspacesForRole(role) {
  if (role === "keeprpro") {
    return [
      normalizeWorkspace(PERSONAL_FALLBACK_WORKSPACE),
      normalizeWorkspace(LEGACY_PRO_FALLBACK_WORKSPACE),
    ];
  }

  return [normalizeWorkspace(PERSONAL_FALLBACK_WORKSPACE)];
}

const STORAGE_KEY = "keepr.activeWorkspaceId.v1";

function organizationIdFromWorkspaceId(workspaceId) {
  const id = String(workspaceId || "");
  return id.startsWith("org:") ? id.slice(4) : null;
}

function webLocationWorkspaceRequest() {
  if (Platform.OS !== "web") return { workspaceId: null, organizationId: null, wantsOrgWorkspace: false };

  try {
    const path = window?.location?.pathname || "";
    const params = new URLSearchParams(window?.location?.search || "");
    const workspaceId = params.get("workspaceId") || null;
    return {
      workspaceId,
      organizationId: params.get("organizationId") || organizationIdFromWorkspaceId(workspaceId),
      wantsOrgWorkspace:
        path === "/workspace" ||
        path.startsWith("/workspace/") ||
        path === "/wilson" ||
        path.startsWith("/wilson/") ||
        path === "/activator" ||
        path.startsWith("/activator/"),
    };
  } catch {
    return { workspaceId: null, organizationId: null, wantsOrgWorkspace: false };
  }
}

function isOrgWorkspace(workspace) {
  return workspace?.workspace_type && workspace.workspace_type !== "keepr";
}

function isOrgEntryWebPath() {
  if (Platform.OS !== "web") return false;
  try {
    const path = window?.location?.pathname || "";
    return (
      path === "/" ||
      path === "/auth" ||
      path.startsWith("/auth/") ||
      path === "/OnboardingStack" ||
      path.startsWith("/OnboardingStack/")
    );
  } catch {
    return false;
  }
}

function workspaceMatchesOrganization(workspace, organizationId) {
  const orgId = String(organizationId || "");
  if (!workspace || !orgId) return false;

  return (
    workspace.organization_id === orgId ||
    workspace.org_id === orgId ||
    workspace.authority?.organization_id === orgId ||
    workspace.authority?.org_id === orgId ||
    workspace.authority?.subject_id === orgId ||
    workspace.workspace_id === `org:${orgId}` ||
    workspace.id === `org:${orgId}`
  );
}

function isPersonalFallbackWorkspaceId(value) {
  return value === "keepr:fallback";
}

const DEFAULT_WORKSPACES = [
  {
    id: "keepr:fallback",
    workspace_id: "keepr:fallback",
    workspace_type: "keepr",
    type: "personal", // anything that is NOT "pro" is treated as consumer mode
    name: "My Keepr",
    display_name: "My Keepr",
    description: "Your personal assets",
  },
];

export function WorkspaceProvider({ children }) {
  const { user } = useAuth();
  const [workspaces, setWorkspaces] = useState(DEFAULT_WORKSPACES.map(normalizeWorkspace));
  const [currentWorkspaceId, setCurrentWorkspaceId] = useState("keepr:fallback");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [legacyProfileRole, setLegacyProfileRole] = useState(null);

  const currentWorkspace = useMemo(() => {
    return (
      workspaces.find((w) => w.workspace_id === currentWorkspaceId || w.id === currentWorkspaceId) ||
      workspaces[0]
    );
  }, [workspaces, currentWorkspaceId]);

  const loadWorkspaces = useCallback(async () => {
    if (!user?.id) {
      setWorkspaces(DEFAULT_WORKSPACES.map(normalizeWorkspace));
      setCurrentWorkspaceId("keepr:fallback");
      setLegacyProfileRole(null);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { data: resolved, error: rpcError } = await supabase.rpc("get_my_workspaces");

      if (rpcError) throw rpcError;

      const nextWorkspaces = (resolved?.workspaces || []).map(normalizeWorkspace);
      const safeWorkspaces = nextWorkspaces.length
        ? nextWorkspaces
        : fallbackWorkspacesForRole(resolved?.legacy_profile_role);

      let storedId = null;
      try {
        storedId = Platform.OS === "web"
          ? window?.localStorage?.getItem(STORAGE_KEY)
          : await AsyncStorage.getItem(STORAGE_KEY);
      } catch {}

      const requested = webLocationWorkspaceRequest();
      const requestedWorkspace = requested.workspaceId
        ? safeWorkspaces.find((w) => w.workspace_id === requested.workspaceId || w.id === requested.workspaceId)
        : null;
      const requestedOrgWorkspace = requested.organizationId
        ? safeWorkspaces.find((workspace) => isOrgWorkspace(workspace) && workspaceMatchesOrganization(workspace, requested.organizationId))
        : null;
      const defaultOrgWorkspace = requested.wantsOrgWorkspace
        ? requestedOrgWorkspace || safeWorkspaces.find(isOrgWorkspace)
        : null;
      const resolvedActiveId = resolved?.active_workspace_id || safeWorkspaces[0]?.workspace_id;
      const firstOrgWorkspace = safeWorkspaces.find(isOrgWorkspace);
      const shouldPreferOrgEntry =
        isOrgEntryWebPath() &&
        firstOrgWorkspace?.workspace_id &&
        (!storedId || !safeWorkspaces.some((w) => w.workspace_id === storedId && isOrgWorkspace(w)));
      const nextActiveId = (
          requested.wantsOrgWorkspace &&
          isPersonalFallbackWorkspaceId(requested.workspaceId) &&
          defaultOrgWorkspace?.workspace_id
        )
        ? defaultOrgWorkspace.workspace_id
        : requestedWorkspace?.workspace_id
        || defaultOrgWorkspace?.workspace_id
        || (shouldPreferOrgEntry ? firstOrgWorkspace.workspace_id : null)
        || (safeWorkspaces.some((w) => w.workspace_id === storedId)
        ? storedId
        : resolvedActiveId);

      setWorkspaces(safeWorkspaces);
      setCurrentWorkspaceId(nextActiveId || safeWorkspaces[0]?.workspace_id || "keepr:fallback");
      setLegacyProfileRole(resolved?.legacy_profile_role || null);
    } catch (err) {
      console.log("Workspace resolver unavailable, using legacy fallback:", err?.message || err);

      let role = null;
      try {
        const { data } = await supabase
          .from("profiles")
          .select("role")
          .eq("id", user.id)
          .single();
        role = data?.role || "consumer";
      } catch {
        role = "consumer";
      }

      const fallback = fallbackWorkspacesForRole(role);
      setWorkspaces(fallback);
      setCurrentWorkspaceId(role === "keeprpro" ? "legacy:keeprpro" : fallback[0].workspace_id);
      setLegacyProfileRole(role);
      setError(err?.message || "Workspace resolver unavailable");
    } finally {
      setLoading(false);
    }
  }, [user?.id]);

  useEffect(() => {
    loadWorkspaces();
  }, [loadWorkspaces]);

  /**
   * Set the active workspace by ID.
   * Example: setCurrentWorkspaceId("org:<uuid>")
   */
  const setWorkspaceById = useCallback(async (id) => {
    const exists = workspaces.some((w) => w.id === id || w.workspace_id === id);
    if (!exists) return;
    setCurrentWorkspaceId(id);
    try {
      if (Platform.OS === "web") {
        window?.localStorage?.setItem(STORAGE_KEY, id);
      } else {
        await AsyncStorage.setItem(STORAGE_KEY, id);
      }
    } catch {}
  }, [workspaces]);

  /**
   * Simple toggle through resolved workspaces.
   */
  const toggleWorkspace = useCallback(() => {
    const currentIndex = workspaces.findIndex((w) => w.workspace_id === currentWorkspaceId);
    const next = workspaces[(currentIndex + 1) % Math.max(workspaces.length, 1)];
    if (next?.workspace_id) setWorkspaceById(next.workspace_id);
  }, [currentWorkspaceId, setWorkspaceById, workspaces]);

  const value = {
    workspaces,
    currentWorkspace,
    currentWorkspaceId,
    loading,
    error,
    legacyProfileRole,
    refreshWorkspaces: loadWorkspaces,
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
