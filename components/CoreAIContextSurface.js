import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { supabase } from "../lib/supabaseClient";
import { colors, radius, shadows, spacing } from "../styles/theme";

function safeText(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function labelize(value, fallback = "Unknown") {
  const text = safeText(value, fallback);
  return text
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function compact(values) {
  return values.map((value) => safeText(value)).filter(Boolean).join(" · ");
}

function originForLinks() {
  if (Platform.OS === "web" && typeof window !== "undefined") return window.location.origin;
  return "https://app.keeprhome.com";
}

function apiUrlForAddress(address, purpose = "llm_context") {
  const origin = originForLinks();
  return `${origin}/api/k/${encodeURIComponent(address)}/context?purpose=${encodeURIComponent(purpose)}`;
}

function publicUrlForAddress(address) {
  return `${originForLinks()}/k/${encodeURIComponent(address)}`;
}

function primaryResources(resources) {
  return resources.filter((resource) => String(resource?.ai_context_role || resource?.ai_context || "").toLowerCase() === "primary");
}

function supportingResources(resources) {
  return resources.filter((resource) => String(resource?.ai_context_role || resource?.ai_context || "").toLowerCase() === "supporting");
}

async function copyText(value) {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return true;
  }
  return false;
}

function Metric({ label, value, icon }) {
  return (
    <View style={styles.metric}>
      <View style={styles.metricIcon}>
        <Ionicons name={icon} size={17} color={colors.brandBlue} />
      </View>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

function StatusPill({ label, tone = "neutral" }) {
  return (
    <View style={[styles.pill, styles[`pill_${tone}`]]}>
      <Text style={[styles.pillText, styles[`pillText_${tone}`]]}>{label}</Text>
    </View>
  );
}

function EmptyLine({ children }) {
  return <Text style={styles.emptyText}>{children}</Text>;
}

function resourceAttachmentId(resource = {}) {
  return resource?.attachment_id || resource?.source_artifact?.attachment_id || null;
}

function legacyResourceId(resource = {}) {
  const id = safeText(resource?.id || resource?.resource_id);
  return id && !id.startsWith("attachment:") ? id : "";
}

function ResourceRow({ resource, actions = null }) {
  const aiContext = String(resource?.ai_context_role || resource?.ai_context || "").toLowerCase();
  const tone = aiContext === "primary" ? "primary" : "supporting";
  const title = safeText(resource?.title || resource?.file_name || resource?.url, "Untitled Resource");
  const scope = labelize(resource?.scope || resource?.ai_scope || resource?.applicability || "asset");
  const role = labelize(resource?.role || resource?.type || resource?.kind || "Resource");
  const authority = safeText(
    resource?.authority_state ||
      resource?.authority ||
      resource?.provider ||
      resource?.contributor ||
      resource?.source_context,
    "Unspecified authority"
  );
  const privacy = labelize(resource?.privacy || resource?.visibility || "public_safe");
  const canEditAttachment = actions && resourceAttachmentId(resource);
  const canDeleteResource = actions && (resourceAttachmentId(resource) || legacyResourceId(resource));

  return (
    <View style={styles.resourceRow}>
      <View style={styles.resourceIcon}>
        <Ionicons name="document-text-outline" size={18} color={colors.brandBlue} />
      </View>
      <View style={styles.resourceBody}>
        <View style={styles.resourceTitleRow}>
          <Text style={styles.resourceTitle} numberOfLines={2}>{title}</Text>
          <StatusPill label={aiContext === "primary" ? "Primary" : "Supporting"} tone={tone} />
        </View>
        <Text style={styles.resourceMeta} numberOfLines={2}>
          {compact([scope, role, authority])}
        </Text>
        <Text style={styles.resourcePrivacy} numberOfLines={1}>
          Visibility: {privacy}
        </Text>
        {canEditAttachment || canDeleteResource ? (
          <View style={styles.resourceActions}>
            {canEditAttachment ? (
              <>
                <TouchableOpacity style={styles.resourceActionButton} onPress={() => actions.onEdit?.(resource)} activeOpacity={0.86}>
                  <Ionicons name="create-outline" size={14} color={colors.brandBlue} />
                  <Text style={styles.resourceActionText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.resourceActionButton} onPress={() => actions.onSupersede?.(resource)} activeOpacity={0.86}>
                  <Ionicons name="archive-outline" size={14} color={colors.textSecondary} />
                  <Text style={styles.resourceActionText}>Supersede</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.resourceActionButton} onPress={() => actions.onDisable?.(resource)} activeOpacity={0.86}>
                  <Ionicons name="eye-off-outline" size={14} color={colors.textSecondary} />
                  <Text style={styles.resourceActionText}>AI off</Text>
                </TouchableOpacity>
              </>
            ) : null}
            <TouchableOpacity style={[styles.resourceActionButton, styles.resourceActionDanger]} onPress={() => actions.onDelete?.(resource)} activeOpacity={0.86}>
              <Ionicons name="trash-outline" size={14} color={colors.danger} />
              <Text style={[styles.resourceActionText, styles.resourceActionDangerText]}>Delete</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </View>
    </View>
  );
}

function ModelContextRow({ model, onOpenModel }) {
  const address = safeText(model?.address || model?.context_address || model?.template_key);
  const resources = asArray(model?.applicable_resources);
  const primary = primaryResources(resources).length;
  const supporting = supportingResources(resources).length;
  const gaps = asArray(model?.knowledge_gaps);
  const link = address ? apiUrlForAddress(address.replace(/^\/?k\//i, ""), "llm_context") : "";
  const title = compact([model?.model_year, model?.manufacturer, model?.model]) || model?.template_key || "Model";
  const buyerGuides = resources.filter((resource) =>
    /buyer|guide|catalog/i.test(`${resource?.title || ""} ${resource?.resource_type || ""}`)
  );

  return (
    <View style={styles.modelRow}>
      <View style={styles.modelIcon}>
        <Ionicons name="boat-outline" size={18} color={colors.brandBlue} />
      </View>
      <View style={styles.modelBody}>
        <View style={styles.resourceTitleRow}>
          <View style={styles.modelTitleBlock}>
            <Text style={styles.resourceTitle} numberOfLines={2}>{title}</Text>
            <Text style={styles.resourceMeta} numberOfLines={1}>
              {compact([model?.template_key, `${resources.length} AI resources`, `${gaps.length} gaps`])}
            </Text>
          </View>
          <View style={styles.modelPills}>
            {primary ? <StatusPill label={`${primary} Primary`} tone="primary" /> : null}
            {supporting ? <StatusPill label={`${supporting} Supporting`} tone="supporting" /> : null}
          </View>
        </View>
        {buyerGuides.length ? (
          <View style={styles.modelLinks}>
            {buyerGuides.slice(0, 3).map((resource, index) => (
              <Text key={resource.id || `${resource.title}-${index}`} style={styles.modelLinkText} numberOfLines={1}>
                {resource.title}
              </Text>
            ))}
          </View>
        ) : (
          <Text style={styles.resourcePrivacy} numberOfLines={1}>
            No buyer guide is participating in AI context yet.
          </Text>
        )}
        {link ? (
          <Text style={styles.modelContextLink} numberOfLines={1}>{link}</Text>
        ) : null}
        {typeof onOpenModel === "function" && model?.template_key ? (
          <TouchableOpacity
            style={styles.modelAction}
            onPress={() => onOpenModel(model)}
            activeOpacity={0.86}
          >
            <Ionicons name="create-outline" size={15} color={colors.brandBlue} />
            <Text style={styles.modelActionText}>Open model resources</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </View>
  );
}

function Section({ title, right, children }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>{title}</Text>
        {right || null}
      </View>
      {children}
    </View>
  );
}

export default function CoreAIContextSurface({
  address,
  label = "Organization",
  purpose = "llm_context",
  copyPurpose = "llm_context",
  onOpenModel = null,
  view = "aiContext",
  refreshKey = 0,
  organizationResourceComposer = null,
  organizationResourceActions = null,
}) {
  const [context, setContext] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    const target = safeText(address);
    if (!target) {
      setContext(null);
      setError("Missing KeeprLINK address.");
      setLoading(false);
      return;
    }

    setError("");
    const { data: sessionData } = await supabase.auth.getSession();
    const accessToken = sessionData?.session?.access_token;
    const response = await fetch(apiUrlForAddress(target, purpose), {
      headers: {
        Accept: "application/json",
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || json?.ok === false) {
      throw new Error(json?.error || `Could not load KeeprLINK context (${response.status}).`);
    }
    setContext(json || null);
  }, [address, purpose]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        setLoading(true);
        await load();
      } catch (err) {
        if (!cancelled) setError(err?.message || "Could not load KeeprLINK context.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [load, refreshKey]);

  const projection = context?.projection || {};
  const object = projection?.object || context?.canonical_object || {};
  const identity = projection?.identity || {};
  const models = useMemo(() => asArray(projection.models), [projection.models]);
  const systems = useMemo(() => asArray(projection.applicable_system_templates || projection.systems), [projection]);
  const resources = useMemo(() => asArray(projection.applicable_resources), [projection.applicable_resources]);
  const modelResources = useMemo(
    () => models.flatMap((model) => asArray(model?.applicable_resources)),
    [models]
  );
  const allResources = useMemo(() => [...resources, ...modelResources], [resources, modelResources]);
  const gaps = useMemo(() => asArray(projection.knowledge_gaps), [projection.knowledge_gaps]);
  const authorities = useMemo(() => {
    const values = new Set();
    allResources.forEach((resource) => {
      [
        resource?.authority_state,
        resource?.authority,
        resource?.provider,
        resource?.contributor,
        resource?.source_context,
      ].forEach((value) => {
        const text = safeText(value);
        if (text) values.add(text);
      });
    });
    systems.forEach((system) => {
      const text = safeText(system?.authority_state || system?.manufacturer || system?.supplier_org_id);
      if (text) values.add(text);
    });
    return Array.from(values);
  }, [allResources, systems]);
  const primary = useMemo(() => primaryResources(allResources), [allResources]);
  const supporting = useMemo(() => supportingResources(allResources), [allResources]);
  const publicAddress = publicUrlForAddress(address);
  const aiReadyAddress = apiUrlForAddress(address, copyPurpose);
  const isResourceWorkbench = view === "resources";

  const handleCopy = useCallback(async () => {
    await copyText(aiReadyAddress);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }, [aiReadyAddress]);

  if (loading) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.brandBlue} />
        <Text style={styles.emptyText}>Loading KeeprLINK context...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.section}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.secondaryButton} onPress={load} activeOpacity={0.86}>
          <Ionicons name="refresh-outline" size={16} color={colors.brandBlue} />
          <Text style={styles.secondaryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.surface}>
      <Section
        title="KeeprLINK"
        right={<StatusPill label="Public-safe" tone="primary" />}
      >
        <View style={styles.linkCard}>
          <View style={styles.linkIcon}>
            <Ionicons name="link-outline" size={20} color={colors.brandBlue} />
          </View>
          <View style={styles.linkBody}>
            <Text style={styles.kicker}>{label}</Text>
            <Text style={styles.linkTitle} numberOfLines={2}>
              {identity.canonical_name || object.name || address}
            </Text>
            <Text style={styles.linkText} numberOfLines={1}>{publicAddress}</Text>
            <Text style={styles.linkMeta}>
              Purpose ladder: understand, LLM context, Keepr enablement, self service
            </Text>
          </View>
          <TouchableOpacity style={styles.primaryButton} onPress={handleCopy} activeOpacity={0.86}>
            <Ionicons name={copied ? "checkmark-circle-outline" : "copy-outline"} size={16} color={colors.onPrimary} />
            <Text style={styles.primaryButtonText}>{copied ? "Copied" : "Copy for AI"}</Text>
          </TouchableOpacity>
        </View>
      </Section>

      <Section title={isResourceWorkbench ? "Resource Summary" : "AI Context Summary"}>
        <View style={styles.metricGrid}>
          <Metric label="Models represented" value={models.length} icon="library-outline" />
          <Metric label="System templates" value={systems.length} icon="hardware-chip-outline" />
          <Metric label="AI resources" value={allResources.length} icon="documents-outline" />
          <Metric label="Authorities" value={authorities.length} icon="shield-checkmark-outline" />
          <Metric label="Knowledge gaps" value={gaps.length} icon="alert-circle-outline" />
        </View>
      </Section>

      {models.length ? (
        <Section title={isResourceWorkbench ? "Resources By Model" : "Model Resource Matrix"}>
          {models.map((model, index) => (
            <ModelContextRow
              key={model.id || model.template_key || `${model.model}-${index}`}
              model={model}
              onOpenModel={onOpenModel}
            />
          ))}
        </Section>
      ) : null}

      <Section title={models.length ? "Organization-Wide Knowledge" : "Included Knowledge"}>
        {organizationResourceComposer || null}
        {resources.length ? resources.map((resource, index) => (
          <ResourceRow
            key={resource.id || resource.attachment_id || `${resource.title}-${index}`}
            resource={resource}
            actions={organizationResourceActions}
          />
        )) : <EmptyLine>No org-wide AI-enabled resources are included yet. Model resources are listed above.</EmptyLine>}
      </Section>

      <Section title="Coverage">
        <View style={styles.coverageGrid}>
          <View style={styles.coverageBlock}>
            <Text style={styles.coverageValue}>{models.length}</Text>
            <Text style={styles.coverageLabel}>model pages</Text>
          </View>
          <View style={styles.coverageBlock}>
            <Text style={styles.coverageValue}>{systems.length}</Text>
            <Text style={styles.coverageLabel}>system templates</Text>
          </View>
          <View style={styles.coverageBlock}>
            <Text style={styles.coverageValue}>{primary.length}</Text>
            <Text style={styles.coverageLabel}>primary resources</Text>
          </View>
          <View style={styles.coverageBlock}>
            <Text style={styles.coverageValue}>{supporting.length}</Text>
            <Text style={styles.coverageLabel}>supporting resources</Text>
          </View>
        </View>
        {gaps.length ? (
          <View style={styles.gapList}>
            {gaps.map((gap, index) => (
              <Text key={`${safeText(gap, "gap")}-${index}`} style={styles.gapText}>
                {typeof gap === "string" ? gap : safeText(gap?.title || gap?.label || gap?.description, "Unresolved mapping")}
              </Text>
            ))}
          </View>
        ) : (
          <EmptyLine>No unresolved knowledge gaps are reported by the resolver.</EmptyLine>
        )}
      </Section>

      <Section title="Copy For AI">
        <View style={styles.copyBox}>
          <Text style={styles.copyLabel}>AI-ready context route</Text>
          <Text style={styles.copyValue} numberOfLines={2}>{aiReadyAddress}</Text>
          <TouchableOpacity style={styles.secondaryButton} onPress={handleCopy} activeOpacity={0.86}>
            <Ionicons name={copied ? "checkmark-circle-outline" : "copy-outline"} size={16} color={colors.brandBlue} />
            <Text style={styles.secondaryButtonText}>{copied ? "Copied" : "Copy KeeprLINK for AI"}</Text>
          </TouchableOpacity>
        </View>
      </Section>
    </View>
  );
}

const styles = StyleSheet.create({
  surface: {
    gap: spacing.lg,
  },
  loading: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.xl,
  },
  section: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.lg,
    ...shadows.sm,
  },
  sectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    marginBottom: spacing.md,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 16,
    fontWeight: "900",
  },
  linkCard: {
    alignItems: "center",
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
  },
  linkIcon: {
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    borderRadius: radius.sm,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  linkBody: {
    flex: 1,
    minWidth: 0,
  },
  kicker: {
    color: colors.brandBlue,
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  linkTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "900",
    marginTop: 2,
  },
  linkText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 4,
  },
  linkMeta: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 4,
  },
  primaryButton: {
    alignItems: "center",
    backgroundColor: colors.brandNavy,
    borderRadius: radius.sm,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  primaryButtonText: {
    color: colors.onPrimary,
    fontSize: 12,
    fontWeight: "900",
  },
  secondaryButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.md,
    minHeight: 38,
    paddingHorizontal: spacing.md,
  },
  secondaryButtonText: {
    color: colors.brandBlue,
    fontSize: 12,
    fontWeight: "900",
  },
  metricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  metric: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexBasis: 150,
    flexGrow: 1,
    minWidth: 140,
    padding: spacing.md,
  },
  metricIcon: {
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    borderRadius: radius.sm,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  metricValue: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: "900",
    marginTop: spacing.sm,
  },
  metricLabel: {
    color: colors.textMuted,
    fontSize: 12,
    fontWeight: "800",
    marginTop: 2,
  },
  resourceRow: {
    alignItems: "flex-start",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  resourceIcon: {
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    borderRadius: radius.sm,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  resourceBody: {
    flex: 1,
    minWidth: 0,
  },
  resourceTitleRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  resourceTitle: {
    color: colors.textPrimary,
    flex: 1,
    fontSize: 14,
    fontWeight: "900",
    minWidth: 0,
  },
  resourceMeta: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 18,
    marginTop: 4,
  },
  resourcePrivacy: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "800",
    marginTop: 3,
  },
  resourceActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  resourceActionButton: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    minHeight: 30,
    paddingHorizontal: spacing.sm,
  },
  resourceActionText: {
    color: colors.textSecondary,
    fontSize: 11,
    fontWeight: "900",
  },
  resourceActionDanger: {
    borderColor: "#FCA5A5",
  },
  resourceActionDangerText: {
    color: colors.danger,
  },
  modelRow: {
    alignItems: "flex-start",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  modelIcon: {
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    borderRadius: radius.sm,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  modelBody: {
    flex: 1,
    minWidth: 0,
  },
  modelTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  modelPills: {
    alignItems: "flex-end",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    justifyContent: "flex-end",
    maxWidth: 260,
  },
  modelLinks: {
    gap: 3,
    marginTop: spacing.xs,
  },
  modelLinkText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 17,
  },
  modelContextLink: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "800",
    marginTop: spacing.xs,
  },
  modelAction: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    marginTop: spacing.sm,
    minHeight: 34,
    paddingHorizontal: spacing.sm,
  },
  modelActionText: {
    color: colors.brandBlue,
    fontSize: 11,
    fontWeight: "900",
  },
  pill: {
    borderRadius: radius.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  pill_primary: {
    backgroundColor: "#ECFDF5",
    borderColor: "#BBF7D0",
  },
  pill_supporting: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
  },
  pill_neutral: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
  },
  pillText: {
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  pillText_primary: {
    color: "#047857",
  },
  pillText_supporting: {
    color: colors.brandBlue,
  },
  pillText_neutral: {
    color: colors.textSecondary,
  },
  coverageGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  coverageBlock: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexBasis: "23%",
    flexGrow: 1,
    minWidth: 130,
    padding: spacing.md,
  },
  coverageValue: {
    color: colors.textPrimary,
    fontSize: 20,
    fontWeight: "900",
  },
  coverageLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
    marginTop: 2,
    textTransform: "uppercase",
  },
  gapList: {
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  gapText: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: "800",
    lineHeight: 18,
  },
  copyBox: {
    backgroundColor: colors.surfaceSubtle,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    padding: spacing.md,
  },
  copyLabel: {
    color: colors.textMuted,
    fontSize: 11,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  copyValue: {
    color: colors.textPrimary,
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19,
    marginTop: spacing.xs,
  },
  emptyText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 19,
  },
  errorText: {
    color: colors.danger || "#DC2626",
    fontSize: 13,
    fontWeight: "800",
    lineHeight: 19,
  },
});
