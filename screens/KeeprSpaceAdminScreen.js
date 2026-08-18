import { Ionicons } from "@expo/vector-icons";
import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import ActivatorBreadcrumb from "../components/ActivatorBreadcrumb";
import { useWorkspace } from "../context/WorkspaceContext";
import {
  getKeeprSpaceOrgConfig,
  updateKeeprSpaceServiceProfile,
  upsertKeeprSpaceOrgLocation,
  upsertKeeprSpaceOrgMemberAssignment,
  upsertKeeprSpaceOrgProfile,
  upsertKeeprSpaceOrgRelationship,
  upsertKeeprSpaceOrgServiceOffering,
  upsertKeeprSpaceOrgTeam,
} from "../lib/keeprspaceApi";
import {
  brandProfileFromOrgConfig,
  brandProfileFromKeeprSpaceContext,
  defaultBrandProfile,
  KeeprSpaceAdminPanel,
  listFromValue,
  pickAndUploadBrandImage,
} from "./ActivatorHomeScreen";
import { colors, radius, shadows, spacing } from "../styles/theme";

function workspaceDisplayName(workspace, config) {
  return (
    config?.organization?.display_name ||
    config?.organization?.name ||
    workspace?.display?.name ||
    workspace?.display_name ||
    workspace?.org_name ||
    workspace?.name ||
    workspace?.label ||
    "KeeprSpace"
  );
}

function workspaceKind(workspace) {
  const type = workspace?.workspace_type || workspace?.type;
  if (type === "keeproem") return "oem";
  if (type === "keeprdealer") return "dealer";
  if (type === "keeprpro" || type === "pro") return "pro";
  return "owner";
}

function modeLabel(kind) {
  if (kind === "oem") return "OEM";
  if (kind === "dealer") return "Dealer";
  if (kind === "pro") return "Service";
  return "Owner";
}

export default function KeeprSpaceAdminScreen({ navigation }) {
  const { currentWorkspace } = useWorkspace();
  const organizationId = currentWorkspace?.organization_id || currentWorkspace?.org_id || null;
  const kind = workspaceKind(currentWorkspace);
  const [orgConfig, setOrgConfig] = useState(null);
  const [orgConfigLoading, setOrgConfigLoading] = useState(false);
  const [adminTab, setAdminTab] = useState("profile");
  const [brandProfile, setBrandProfile] = useState(defaultBrandProfile(currentWorkspace));
  const [savingProfile, setSavingProfile] = useState(false);
  const [adminSavingKey, setAdminSavingKey] = useState(null);
  const [uploadingBrandImage, setUploadingBrandImage] = useState(null);
  const [error, setError] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async ({ quiet = false } = {}) => {
    if (!organizationId) {
      setOrgConfig(null);
      setError("This KeeprSpace does not have an organization id.");
      setOrgConfigLoading(false);
      setRefreshing(false);
      return;
    }

    if (!quiet) setOrgConfigLoading(true);
    setError(null);
    try {
      const nextConfig = await getKeeprSpaceOrgConfig({ organizationId });
      setOrgConfig(nextConfig);
      if (nextConfig?.organization) {
        setBrandProfile(brandProfileFromOrgConfig(nextConfig, currentWorkspace));
      } else {
        setBrandProfile(brandProfileFromKeeprSpaceContext(nextConfig?.context, currentWorkspace));
      }
    } catch (err) {
      setOrgConfig(null);
      setError(err?.message || "Could not load organization configuration.");
      setBrandProfile(defaultBrandProfile(currentWorkspace));
    } finally {
      setOrgConfigLoading(false);
      setRefreshing(false);
    }
  }, [currentWorkspace, organizationId]);

  useEffect(() => {
    setBrandProfile(defaultBrandProfile(currentWorkspace));
  }, [currentWorkspace]);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = () => {
    setRefreshing(true);
    load({ quiet: true });
  };

  const currentOrgId = () => brandProfile.organizationId || organizationId || null;

  const pickBrandLogo = async () => {
    try {
      setUploadingBrandImage("logo");
      const uri = await pickAndUploadBrandImage({ profile: brandProfile, field: "logo_url" });
      if (uri) setBrandProfile((current) => ({ ...current, logoUri: uri }));
    } catch (err) {
      Alert.alert("Upload failed", err?.message || "Could not upload this profile image.");
    } finally {
      setUploadingBrandImage(null);
    }
  };

  const pickBrandHeader = async () => {
    try {
      setUploadingBrandImage("header");
      const uri = await pickAndUploadBrandImage({ profile: brandProfile, field: "header_image_url" });
      if (uri) setBrandProfile((current) => ({ ...current, headerImageUri: uri }));
    } catch (err) {
      Alert.alert("Upload failed", err?.message || "Could not upload this header image.");
    } finally {
      setUploadingBrandImage(null);
    }
  };

  const saveBrandProfile = async () => {
    const orgId = currentOrgId();
    const keeprProId = brandProfile.keeprProId || orgConfig?.keepr_pro?.id || null;
    if (!orgId) {
      Alert.alert("Profile not connected", "This KeeprSpace does not have an organization profile to update yet.");
      return;
    }

    setSavingProfile(true);
    try {
      const orgPatch = {
        display_name: brandProfile.displayName,
        slug: brandProfile.slug,
        photo_url: brandProfile.logoUri,
        team_photo_url: brandProfile.headerImageUri,
        logo_url: brandProfile.logoUri,
        header_image_url: brandProfile.headerImageUri,
        short_description: brandProfile.shortDescription,
        public_description: brandProfile.publicDescription,
        phone: brandProfile.phone,
        email: brandProfile.email,
        website: brandProfile.website,
        location: brandProfile.location,
        publish_status: brandProfile.profileStatus,
        service_offerings: listFromValue(brandProfile.serviceOfferings),
        packages: listFromValue(brandProfile.packages),
        source_metadata: { managed_from: "keeprspace_admin" },
      };
      const nextConfig = await upsertKeeprSpaceOrgProfile({
        organizationId: orgId,
        patch: orgPatch,
      });
      if (nextConfig) {
        setOrgConfig(nextConfig);
        setBrandProfile(brandProfileFromOrgConfig(nextConfig, currentWorkspace));
      }

      if (keeprProId) {
        await updateKeeprSpaceServiceProfile({
          organizationId: orgId,
          keeprProId,
          patch: {
            display_name: brandProfile.displayName,
            slug: brandProfile.slug,
            logo_url: brandProfile.logoUri,
            header_image_url: brandProfile.headerImageUri,
            short_description: brandProfile.shortDescription,
            public_description: brandProfile.publicDescription,
            phone: brandProfile.phone,
            email: brandProfile.email,
            website: brandProfile.website,
            location: brandProfile.location,
            publish_status: brandProfile.profileStatus,
            service_offerings: listFromValue(brandProfile.serviceOfferings),
            packages: listFromValue(brandProfile.packages),
            locations: listFromValue(brandProfile.location).map((label) => ({ label })),
          },
        });
      }
      await load({ quiet: true });
    } catch (err) {
      Alert.alert("Could not save profile", err?.message || "Please try again.");
    } finally {
      setSavingProfile(false);
    }
  };

  const saveOrgLocation = async (location) => {
    const orgId = currentOrgId();
    if (!orgId) return;
    setAdminSavingKey("location");
    try {
      const nextConfig = await upsertKeeprSpaceOrgLocation({ organizationId: orgId, location });
      setOrgConfig(nextConfig);
    } catch (err) {
      Alert.alert("Could not save location", err?.message || "Please try again.");
    } finally {
      setAdminSavingKey(null);
    }
  };

  const saveOrgTeam = async (team) => {
    const orgId = currentOrgId();
    if (!orgId) return;
    setAdminSavingKey("team");
    try {
      const nextConfig = await upsertKeeprSpaceOrgTeam({ organizationId: orgId, team });
      setOrgConfig(nextConfig);
    } catch (err) {
      Alert.alert("Could not save team", err?.message || "Please try again.");
    } finally {
      setAdminSavingKey(null);
    }
  };

  const saveOrgMemberAssignment = async (assignment) => {
    const orgId = currentOrgId();
    if (!orgId) return;
    setAdminSavingKey("assignment");
    try {
      const nextConfig = await upsertKeeprSpaceOrgMemberAssignment({ organizationId: orgId, assignment });
      setOrgConfig(nextConfig);
    } catch (err) {
      Alert.alert("Could not save assignment", err?.message || "Please try again.");
    } finally {
      setAdminSavingKey(null);
    }
  };

  const saveOrgService = async (service) => {
    const orgId = currentOrgId();
    if (!orgId) return;
    setAdminSavingKey("service");
    try {
      const nextConfig = await upsertKeeprSpaceOrgServiceOffering({ organizationId: orgId, service });
      setOrgConfig(nextConfig);
    } catch (err) {
      Alert.alert("Could not save service", err?.message || "Please try again.");
    } finally {
      setAdminSavingKey(null);
    }
  };

  const saveOrgRelationship = async (relationship) => {
    const orgId = currentOrgId();
    if (!orgId) return;
    setAdminSavingKey("relationship");
    try {
      const nextConfig = await upsertKeeprSpaceOrgRelationship({
        fromOrgId: orgId,
        toOrgId: relationship.to_org_id || null,
        toOrgName: relationship.to_org_name || relationship.brand_name || relationship.name,
        relationshipType: relationship.relationship_type || "represented_brand",
        payload: relationship,
      });
      setOrgConfig(nextConfig);
    } catch (err) {
      Alert.alert("Could not save relationship", err?.message || "Please try again.");
    } finally {
      setAdminSavingKey(null);
    }
  };

  const saveOrgCapabilities = async (capabilities) => {
    const orgId = currentOrgId();
    if (!orgId) return;
    setAdminSavingKey("capabilities");
    try {
      const nextConfig = await upsertKeeprSpaceOrgProfile({
        organizationId: orgId,
        patch: { workspace_capabilities: listFromValue(capabilities) },
      });
      setOrgConfig(nextConfig);
    } catch (err) {
      Alert.alert("Could not save capabilities", err?.message || "Please try again.");
    } finally {
      setAdminSavingKey(null);
    }
  };

  const displayName = workspaceDisplayName(currentWorkspace, orgConfig);
  const label = modeLabel(kind);

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} />}
      >
        <ActivatorBreadcrumb
          navigation={navigation}
          homeRoute="KeeprSpaceHome"
          current="KeeprSpace Admin"
          right={(
            <View style={styles.breadcrumbWorkspace}>
              <Ionicons name="briefcase-outline" size={14} color={colors.brandNavy} />
              <Text style={styles.breadcrumbWorkspaceText} numberOfLines={1}>{displayName}</Text>
              <Text style={styles.breadcrumbSwitchText}>{label}</Text>
            </View>
          )}
        />

        {error && !orgConfig ? (
          <View style={styles.emptyPanel}>
            <ActivityIndicator color={colors.brandBlue} />
            <Text style={styles.errorTitle}>KeeprSpace Admin unavailable</Text>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : (
          <KeeprSpaceAdminPanel
            profile={brandProfile}
            kind={kind}
            config={orgConfig}
            activeTab={adminTab}
            onTabChange={setAdminTab}
            onChangeProfile={setBrandProfile}
            onPickLogo={pickBrandLogo}
            onPickHeader={pickBrandHeader}
            onSaveProfile={kind === "owner" ? null : saveBrandProfile}
            onSaveLocation={saveOrgLocation}
            onSaveTeam={saveOrgTeam}
            onSaveAssignment={saveOrgMemberAssignment}
            onSaveService={saveOrgService}
            onSaveCapabilities={saveOrgCapabilities}
            onSaveRelationship={saveOrgRelationship}
            savingProfile={savingProfile}
            savingKey={adminSavingKey}
            uploadingLogo={uploadingBrandImage === "logo"}
            uploadingHeader={uploadingBrandImage === "header"}
            loading={orgConfigLoading}
          />
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    gap: spacing.lg,
    padding: spacing.xl,
  },
  breadcrumbWorkspace: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    maxWidth: 320,
    minHeight: 32,
    paddingHorizontal: spacing.md,
  },
  breadcrumbWorkspaceText: {
    color: colors.brandNavy,
    fontSize: 12,
    fontWeight: "900",
  },
  breadcrumbSwitchText: {
    color: colors.brandBlue,
    fontSize: 10,
    fontWeight: "900",
    textTransform: "uppercase",
  },
  emptyPanel: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radius.sm,
    borderWidth: 1,
    gap: spacing.sm,
    minHeight: 220,
    padding: spacing.xl,
    ...shadows.sm,
  },
  errorTitle: {
    color: colors.textPrimary,
    fontSize: 18,
    fontWeight: "900",
  },
  errorText: {
    color: colors.textMuted,
    fontSize: 13,
    lineHeight: 20,
    maxWidth: 720,
    textAlign: "center",
  },
});
