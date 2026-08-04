import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);
const migrationPath =
  "supabase/migrations/20260803143000_organization_backed_keeprpro_harris_wilson.sql";
const actionSliceMigrationPath =
  "supabase/migrations/20260803154500_harris_wilson_provider_action_slice.sql";
const actionCompletionMigrationPath =
  "supabase/migrations/20260803170000_harris_wilson_provider_action_completion.sql";
const actionCompletionSourceTypeMigrationPath =
  "supabase/migrations/20260803171000_harris_wilson_provider_action_completion_source_type.sql";
const portfolioMigrationPath =
  "supabase/migrations/20260803172000_keeprpro_portfolio_workspace_real_harris_data.sql";
const portalStateMigrationPath =
  "supabase/migrations/20260803173000_harris_wilson_relationship_portal_state.sql";
const visualPortfolioMigrationPath =
  "supabase/migrations/20260803174000_keeprpro_visual_stewardship_portfolio.sql";
const portalSourceOfTruthMigrationPath =
  "supabase/migrations/20260803175000_harris_wilson_portal_source_of_truth.sql";
const portalOperationsMigrationPath =
  "supabase/migrations/20260803176000_harris_wilson_portal_operations.sql";
const syncStewardshipsMigrationPath =
  "supabase/migrations/20260803177000_sync_asset_keeprpro_stewardships.sql";
const messageAttachmentAggregateMigrationPath =
  "supabase/migrations/20260803179000_keeprpro_message_attachment_aggregate.sql";
const canonicalWorkspaceMigrationPath =
  "supabase/migrations/20260803180000_canonical_relationship_workspace_resolver.sql";
const claimedProfileMigrationPath =
  "supabase/migrations/20260803181000_keeprpro_claimed_profile_identity.sql";

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

test("migration reuses orgs, org_members, and existing Wilson KeeprPro identity", () => {
  const sql = read(migrationPath);

  assert.match(sql, /alter table public\.orgs[\s\S]*add column if not exists slug text/);
  assert.match(sql, /alter table public\.org_members[\s\S]*add column if not exists role text/);
  assert.match(sql, /alter table public\.keepr_pros[\s\S]*organization_id uuid references public\.orgs/);
  assert.match(sql, /drop constraint if exists ux_orgs_owner_user_id/);
  assert.match(sql, /coalesce\(org_type, 'personal'\) = 'personal'/);
  assert.match(sql, /v_wilson_pro_id uuid := 'b570b6b3-6c44-4925-a44e-d39bb22f2816'/);
  assert.match(sql, /slug = 'wilsonmarine'/);
  assert.match(sql, /profile_status = 'demo'/);
});

test("provider stewardship is separate from broad team asset stewardship", () => {
  const sql = read(migrationPath);

  assert.match(sql, /create table if not exists public\.asset_provider_stewardships/);
  assert.match(sql, /relationship_type[\s\S]*servicing_dealer/);
  assert.match(sql, /access_scope[\s\S]*service_stewardship/);
  assert.match(sql, /v_harris_asset_id uuid := '9733c254-579b-47ab-8b51-593b1d44f8fa'/);
  assert.doesNotMatch(sql, /insert into public\.asset_stewardships/i);
});

test("stewardship projection exposes only the Harris-Wilson service slice", () => {
  const sql = read(actionSliceMigrationPath);

  assert.match(sql, /create or replace function public\.get_keeprpro_stewardship_asset/);
  assert.match(sql, /public\.keeprpro_user_can_act_for_org\(auth\.uid\(\), aps\.organization_id\)/);
  assert.match(sql, /'view_label', 'Stewardship View · '/);
  assert.match(sql, /'relationship_label'/);
  assert.match(sql, /'access_scope', v_row\.access_scope/);
  assert.match(sql, /'owner_display_name'/);
  assert.match(sql, /from public\.service_records sr[\s\S]*sr\.keepr_pro_id = v_row\.keepr_pro_id/);
  assert.match(sql, /from public\.reminders r[\s\S]*keeprpro_can_access_provider_action/);
  assert.match(sql, /projection_config -> 'included_system_ids'/);
  assert.match(sql, /s\.id = any\(v_included_system_ids\)/);
  assert.doesNotMatch(sql, /purchase_price/);
  assert.doesNotMatch(sql, /estimated_value/);
  assert.doesNotMatch(sql, /'cost'/);
  assert.match(sql, /'hero_media'/);
  assert.match(sql, /a\.hero_placement_id/);
  assert.match(sql, /ap\.id = v_row\.hero_placement_id/);
  assert.equal((sql.match(/'storage_path'/g) || []).length, 1);
});

test("KeeprPro mode has its own navigation stack and does not use owner story screens", () => {
  const app = read("App.js");
  const home = read("screens/KeeprProHomeScreen.js");
  const view = read("screens/KeeprProStewardshipViewScreen.js");
  const actionDetail = read("screens/KeeprProActionDetailScreen.js");
  const sidebar = read("components/SidebarNav.js");
  const messagePanel = read("components/MessageThreadPanel.js");

  assert.match(app, /const KeeprProStackNav = createNativeStackNavigator\(\)/);
  assert.match(app, /name="KeeprProStack"/);
  assert.match(app, /role === "keeprpro"/);
  assert.match(app, /PublicKeeprProProfile: "pro\/:slug"/);
  assert.match(home, /get_keeprpro_portfolio_workspace/);
  assert.match(home, /PRO_TABS/);
  assert.match(home, /Needs Attention/);
  assert.match(home, /Portfolio/);
  assert.match(home, /Messages/);
  assert.match(home, /Profile/);
  assert.match(home, /const \[activeTab, setActiveTab\] = useState\("needs"\)/);
  assert.match(home, /const \[assetViewMode, setAssetViewMode\] = useState\("list"\)/);
  assert.match(home, /Who needs Wilson right now/);
  assert.match(home, /Stewardship customer database/);
  assert.match(home, /Customer conversations attached to a relationship/);
  assert.match(home, /Search asset, owner, KAC, make, model/);
  assert.match(home, /navigation\.navigate\("KeeprProStewardshipView"/);
  assert.match(home, /openWorkspaceForAssetId/);
  assert.match(home, /kac: asset\.kac_id/);
  assert.match(home, /asset\.hero_media/);
  assert.match(home, /asset\.what_next/);
  assert.match(home, /asset\.open_action_count/);
  assert.match(home, /getSignedUrl/);
  assert.match(view, /get_keeprpro_stewardship_asset_by_kac/);
  assert.match(view, /get_keeprpro_stewardship_messages/);
  assert.match(view, /get_keeprpro_relationship_portal/);
  assert.match(view, /KeeprSpace/);
  assert.match(view, /Where we are now/);
  assert.match(view, /No next step has been set/);
  assert.match(view, /No Playbook is connected/);
  assert.match(view, /No appointment is scheduled/);
  assert.match(view, /Linked system/);
  assert.match(view, /Last activity/);
  assert.match(view, /No concise description has been set/);
  assert.match(view, /View original request details/);
  assert.match(view, /showOriginalRequestDetails/);
  assert.doesNotMatch(view, /<Text style=\{styles\.portalNote\}>\{currentAction\.notes\}<\/Text>/);
  assert.match(view, /Files in this conversation/);
  assert.match(view, /No files yet/);
  assert.match(view, /Wilson has not replied yet/);
  assert.doesNotMatch(view, /winterization deposit paid/);
  assert.doesNotMatch(view, /spot reserved/);
  assert.match(view, /Visual View/);
  assert.match(view, /List View/);
  assert.match(view, /hero_media/);
  assert.match(view, /getSignedUrl/);
  assert.match(view, /navigation\.navigate\("KeeprProActionDetail"/);
  assert.match(view, /sendKeeprProStewardshipThreadReply/);
  assert.match(view, /startKeeprProStewardshipThread/);
  assert.match(view, /Start messages/);
  assert.match(view, /Reply as Wilson Marine/);
  assert.match(view, /MessageThreadPanel/);
  assert.match(view, /perspective="keepr_pro"/);
  assert.match(view, /perspective: "keepr_pro"/);
  assert.match(view, /organizationId: projection\?\.organization\?\.id \|\| organizationId/);
  assert.doesNotMatch(view, /renderMessageBubble/);
  assert.match(messagePanel, /perspective === "keepr_pro"/);
  assert.match(messagePanel, /sender_type === "keepr_pro"/);
  assert.match(messagePanel, /cleanSenderName\(message\.sender_name\)/);
  assert.match(messagePanel, /if \(mine\) return "You"/);
  assert.match(messagePanel, /messageMine/);
  assert.match(messagePanel, /messageOther/);
  assert.match(messagePanel, /DocumentPicker\.getDocumentAsync/);
  assert.match(messagePanel, /ImagePicker\.launchImageLibraryAsync/);
  assert.match(messagePanel, /ImagePicker\.launchCameraAsync/);
  assert.match(messagePanel, /pendingAttachments/);
  assert.match(messagePanel, /message\.attachments/);
  assert.match(messagePanel, /onOpenAttachment/);
  const actionMessages = read("screens/KeeprActionScreen.js");
  assert.match(actionMessages, /MessageThreadPanel/);
  assert.match(actionMessages, /useFocusEffect/);
  assert.match(actionMessages, /refresh\(\{ quiet: true, force: true \}\)/);
  assert.match(actionMessages, /loadKeeprProStewardshipThread/);
  assert.match(actionMessages, /sendKeeprProStewardshipThreadReply/);
  assert.match(actionMessages, /pendingAttachments/);
  assert.match(actionMessages, /isKeeprProPerspective \? "keepr_pro" : "member"/);
  const startThreadMigration = read("supabase/migrations/20260803182000_start_keeprpro_stewardship_thread.sql");
  assert.match(startThreadMigration, /start_keeprpro_stewardship_thread/);
  assert.match(startThreadMigration, /asset_provider_stewardships/);
  assert.match(startThreadMigration, /keeprpro_user_can_act_for_org/);
  assert.match(startThreadMigration, /'keeprpro_stewardship'/);
  assert.match(view, /update_keeprpro_stewardship_action_response/);
  assert.match(view, /complete_keeprpro_stewardship_action/);
  assert.match(view, /uploadAttachmentFromUri/);
  assert.match(view, /Add file/);
  assert.match(view, /AttachmentViewerModal/);
  assert.match(view, /navigation\.navigate\("TimelineRecord"/);
  assert.doesNotMatch(view, /records\.slice\(0, 5\)/);
  assert.match(actionDetail, /get_keeprpro_stewardship_action/);
  assert.match(actionDetail, /update_keeprpro_stewardship_action_response/);
  assert.match(actionDetail, /complete_keeprpro_stewardship_action/);
  assert.match(actionDetail, /Professional stewardship mode/);
  assert.doesNotMatch(home, /navigation\.navigate\("BoatStory"/);
  assert.doesNotMatch(view, /navigation\.navigate\("BoatStory"/);
  assert.doesNotMatch(actionDetail, /CreateReminder/);
  assert.match(sidebar, /const KEEPRPRO_ITEMS/);
  assert.match(sidebar, /const NAV_PERSIST_KEY = "keepr\.nav\.state\.v1"/);
  assert.match(sidebar, /const KEEPRPRO_HOME_PATH = "\/pro-mode"/);
  assert.match(sidebar, /sessionStorage\?\.removeItem\(NAV_PERSIST_KEY\)/);
  assert.match(sidebar, /location\.reload\(\)/);
  assert.match(sidebar, /location\.assign\(KEEPRPRO_HOME_PATH\)/);
  assert.match(sidebar, /CommonActions\.reset/);
  assert.match(sidebar, /key === "KeeprProHome"/);
  assert.match(sidebar, /name: "KeeprProStack"/);
  assert.match(sidebar, /name: "KeeprProHome"/);
  assert.match(sidebar, /routeName === "KeeprProStewardshipView" \|\| routeName === "KeeprProActionDetail"/);
});

test("claimed Wilson profile route becomes owner relationship portal with service entry", () => {
  const screen = read("screens/PublicKeeprProProfileScreen.js");
  const boat = read("screens/BoatStoryScreen.js");
  const card = read("components/KeeprProCommunicationCard.js");
  const proHome = read("screens/KeeprProHomeScreen.js");
  const profileSql = read(claimedProfileMigrationPath);

  assert.match(screen, /get_public_keeprpro_profile/);
  assert.match(screen, /assetContext/);
  assert.match(screen, /asset_provider_stewardships/);
  assert.match(screen, /owner_claimed_keeprpro_portal/);
  assert.match(screen, /preferred_provider_id/);
  assert.match(screen, /sendThreadReply/);
  assert.match(screen, /startOwnerKeeprProRelationshipThread/);
  assert.match(screen, /Start conversation with Wilson Marine/);
  assert.match(screen, /profile\.public_description/);
  assert.match(screen, /Service Offerings/);
  assert.match(screen, /Packages \/ Playbooks/);
  assert.match(screen, /Request Service/);
  assert.match(screen, /Relationship Workspace/);
  assert.match(boat, /resolveClaimedKeeprProSlug/);
  assert.match(boat, /assetContext: buildOwnerKeeprProAssetContext/);
  assert.match(boat, /messageKeeprPro/);
  assert.match(boat, /startOwnerKeeprProRelationshipThread/);
  assert.match(card, /onMessage/);
  assert.match(proHome, /Claimed professional identity/);
  assert.match(proHome, /update_keeprpro_claimed_profile/);
  assert.match(proHome, /logo_url/);
  assert.match(proHome, /header_image_url/);
  assert.match(profileSql, /claim_keeprpro_profile/);
  assert.match(profileSql, /claimed_existing_keepr_pro_id/);
  assert.match(profileSql, /where kp\.slug = 'wilsonmarine'/);
  assert.doesNotMatch(screen, /CreateReminder/);
  assert.doesNotMatch(screen, /get_keeprpro_stewardship_asset/);
});

test("mode switch only enters KeeprPro when an organization context exists", () => {
  const settings = read("screens/SettingsScreen.js");
  const adminSettings = read("screens/AdminSettingsScreen.js");

  for (const source of [settings, adminSettings]) {
    assert.match(source, /get_my_keeprpro_contexts/);
    assert.match(source, /hasKeeprProContext/);
    assert.match(source, /"keeprpro"/);
  }
});

test("real Harris-Wilson portfolio data is authorized by provider stewardship", () => {
  const sql = [
    read(actionSliceMigrationPath),
    read(portfolioMigrationPath),
    read(portalStateMigrationPath),
    read(visualPortfolioMigrationPath),
    read(portalSourceOfTruthMigrationPath),
    read(portalOperationsMigrationPath),
  ].join("\n");

  assert.match(sql, /create or replace function public\.get_keeprpro_portfolio_workspace/);
  assert.match(sql, /create or replace function public\.get_keeprpro_stewardship_asset_by_kac/);
  assert.match(sql, /create or replace function public\.get_keeprpro_stewardship_messages/);
  assert.match(sql, /create or replace function public\.get_keeprpro_relationship_portal/);
  assert.match(sql, /upper\(a\.kac_id\) = upper\(trim\(coalesce\(p_kac, ''\)\)\)/);
  assert.match(sql, /create or replace function public\.keeprpro_can_access_provider_action/);
  assert.match(sql, /r\.extra_metadata ->> 'source' = 'keeprpro_private_request'/);
  assert.match(sql, /harris_wilson_demo/);
  assert.match(sql, /superseded_by_existing_harris_wilson_winterization_action/);
  assert.match(sql, /asset_threads/);
  assert.match(read(portalSourceOfTruthMigrationPath), /service_state' - 'relationship_portal_kind'/);
  assert.match(read(portalSourceOfTruthMigrationPath), /No ordered Action Playbook is connected/);
  assert.match(read(portalSourceOfTruthMigrationPath), /reminders\.extra_metadata\.provider_response\.next_step/);
  assert.match(read(portalOperationsMigrationPath), /create or replace function public\.send_keeprpro_stewardship_thread_reply/);
  assert.match(read(portalOperationsMigrationPath), /sender_type,\s*sender_name/);
  assert.match(read(portalOperationsMigrationPath), /'keepr_pro'/);
  const attachmentAggregateSql = read(messageAttachmentAggregateMigrationPath);
  assert.match(attachmentAggregateSql, /asset_thread_message/);
  assert.match(attachmentAggregateSql, /asset_provider_stewardship/);
  assert.match(attachmentAggregateSql, /target_type = 'reminder'/);
  assert.match(attachmentAggregateSql, /Shared files are aggregated/);
  const canonicalWorkspaceSql = read(canonicalWorkspaceMigrationPath);
  assert.match(canonicalWorkspaceSql, /create or replace function public\.resolve_relationship_workspace/);
  assert.match(canonicalWorkspaceSql, /'workspace_identity'/);
  assert.match(canonicalWorkspaceSql, /'open_action_count'/);
  assert.match(canonicalWorkspaceSql, /public\.resolve_relationship_workspace\(v_asset_id, p_organization_id, null\)/);
  assert.match(canonicalWorkspaceSql, /r\.extra_metadata #>> '\{provider_target,id\}' = aps\.keepr_pro_id::text/);
  assert.doesNotMatch(canonicalWorkspaceSql, /title ilike '%winterization%'/);
  assert.match(read(portalOperationsMigrationPath), /p_status text default null/);
  assert.match(read(portalOperationsMigrationPath), /ap\.role = 'relationship_shared'/);
  assert.doesNotMatch(read(portalSourceOfTruthMigrationPath), /deposit_status/);
  assert.doesNotMatch(read(portalSourceOfTruthMigrationPath), /pickup_status/);
  assert.doesNotMatch(read(portalSourceOfTruthMigrationPath), /Reserved/);
  assert.match(sql, /KeeprPro projection thread/);
  assert.match(sql, /'hero_media'/);
  assert.match(sql, /'what_next'/);
  assert.match(sql, /'open_action_count'/);
  assert.match(sql, /recent_message_preview/);
  assert.doesNotMatch(sql, /action_participants/);
});

test("provider completion creates Wilson service history through the same Action", () => {
  const sql = `${read(actionCompletionMigrationPath)}\n${read(actionCompletionSourceTypeMigrationPath)}`;
  const actionDetail = read("screens/KeeprProActionDetailScreen.js");

  assert.match(sql, /create or replace function public\.complete_keeprpro_stewardship_action/);
  assert.match(sql, /keeprpro_can_access_provider_action/);
  assert.match(sql, /insert into public\.service_records/);
  assert.match(sql, /keepr_pro_id/);
  assert.match(sql, /'keeprpro_stewardship_action_completion'/);
  assert.match(sql, /'reminder_id'/);
  assert.match(sql, /'linked_service_record_id'/);
  assert.match(read(actionCompletionSourceTypeMigrationPath), /'manual'/);
  assert.match(sql, /status = 'completed'/);
  assert.match(sql, /return public\.get_keeprpro_stewardship_action/);
  assert.match(actionDetail, /Complete and add history/);
  assert.doesNotMatch(sql, /insert into public\.reminders/i);
});

test("owner-linked KeeprPros sync into the KeeprPro stewardship portfolio", () => {
  const sql = read(syncStewardshipsMigrationPath);
  const editAsset = read("screens/EditAssetScreen.js");

  assert.match(sql, /create or replace function public\.sync_asset_provider_stewardships/);
  assert.match(sql, /a\.owner_id = auth\.uid\(\)/);
  assert.match(sql, /insert into public\.asset_provider_stewardships/);
  assert.match(sql, /'service_stewardship'/);
  assert.match(sql, /'servicing_dealer'/);
  assert.match(sql, /kp\.organization_id is not null/);
  assert.match(sql, /status = 'revoked'/);
  assert.match(sql, /extra_metadata #> '\{standard,relationships,keepr_pro_ids\}'/);
  assert.match(sql, /on conflict do nothing/);
  assert.match(editAsset, /sync_asset_provider_stewardships/);
  assert.match(editAsset, /p_keepr_pro_ids: selectedIds/);
});
