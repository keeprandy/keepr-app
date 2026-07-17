import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const repoRoot = path.resolve(new URL("..", import.meta.url).pathname);

function read(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function loadDeepLinkHelpers() {
  const source = read("lib/projectionDeepLinks.js").replaceAll("export ", "");
  return new Function(
    `${source}
return {
  buildProjectionThreadNotificationPayload,
  buildAuthenticatedThreadDeepLink,
  buildPublicSenderThreadDeepLink,
  getRequiredThreadNotificationKeys
};`
  )();
}

test("message notification payload preserves exact thread and message destination", () => {
  const { buildProjectionThreadNotificationPayload, getRequiredThreadNotificationKeys } =
    loadDeepLinkHelpers();

  const payload = buildProjectionThreadNotificationPayload({
    threadId: "thread-123",
    assetId: "asset-456",
    kac: "kpr-abc-123",
    messageId: "message-789",
    projectionType: "charter_inquiry",
    hubId: "hub-001",
  });

  assert.deepEqual(getRequiredThreadNotificationKeys(), ["thread_id", "asset_id", "kac"]);
  assert.deepEqual(payload, {
    thread_id: "thread-123",
    asset_id: "asset-456",
    kac: "KPR-ABC-123",
    message_id: "message-789",
    projection_type: "charter_inquiry",
    hub_id: "hub-001",
  });
});

test("authenticated thread links target exact asset thread and optional message", () => {
  const { buildAuthenticatedThreadDeepLink } = loadDeepLinkHelpers();

  assert.equal(
    buildAuthenticatedThreadDeepLink({
      assetId: "asset 1",
      threadId: "thread/2",
      messageId: "message 3",
    }),
    "/asset/asset%201/thread/thread%2F2/message/message%203"
  );

  assert.equal(
    buildAuthenticatedThreadDeepLink({
      kac: "kpr-6qeh-927h",
      threadId: "thread-2",
    }),
    "/k/KPR-6QEH-927H/thread/thread-2"
  );
});

test("public sender thread links use secure opaque token route", () => {
  const { buildPublicSenderThreadDeepLink } = loadDeepLinkHelpers();

  assert.equal(
    buildPublicSenderThreadDeepLink({
      publicThreadToken: "token/one",
      messageId: "message two",
    }),
    "/thread/token%2Fone/message/message%20two"
  );
});

test("App registers stable thread routes without Dashboard fallback", () => {
  const source = read("App.js");

  for (const routeName of [
    "KeeprThread",
    "KeeprThreadMessage",
    "KacThread",
    "KacThreadMessage",
    "PublicThread",
    "PublicThreadMessage",
  ]) {
    assert.match(source, new RegExp(`name="${routeName}" component=\\{KeeprActionScreen\\}`));
  }

  assert.match(source, /KeeprThread:\s*"asset\/:assetId\/thread\/:threadId"/);
  assert.match(source, /KeeprThreadMessage:\s*"asset\/:assetId\/thread\/:threadId\/message\/:messageId"/);
  assert.match(source, /KacThread:\s*"k\/:kac\/thread\/:threadId"/);
  assert.match(source, /PublicThread:\s*"thread\/:publicThreadToken"/);
  assert.match(source, /path\.startsWith\("\/asset\/"\)/);
  assert.match(source, /path\.startsWith\("\/thread\/"\)/);
  assert.doesNotMatch(source, /KeeprThread[\s\S]{0,200}Dashboard/);
  assert.doesNotMatch(source, /PublicThread[\s\S]{0,200}Dashboard/);
});

test("KeeprActionScreen narrows to the requested thread and highlights requested message", () => {
  const source = read("screens/KeeprActionScreen.js");

  assert.match(source, /threadId,/);
  assert.match(source, /messageId,/);
  assert.match(source, /publicThreadToken,/);
  assert.match(source, /projectionType,/);
  assert.match(source, /threadQuery = threadQuery\.eq\("id", threadId\);/);
  assert.match(source, /String\(m\.id\) === String\(messageId\)/);
  assert.match(source, /styles\.messageBubbleHighlight/);
});

test("KeeprActionScreen exposes explicit fallback states instead of Dashboard fallback", () => {
  const source = read("screens/KeeprActionScreen.js");

  assert.match(source, /missing_thread/);
  assert.match(source, /Thread unavailable/);
  assert.match(source, /access_denied/);
  assert.match(source, /Access denied/);
  assert.match(source, /private_link_expired/);
  assert.match(source, /Private link expired/);
  assert.match(source, /requires_sign_in/);
  assert.match(source, /continueRoute/);
  assert.match(source, /continueParams/);
  assert.match(source, /You can still use asset Actions from here/);
  assert.doesNotMatch(source, /navigation\.navigate\("Dashboard"/);
});

test("AuthScreen resumes preserved deep-link destination after sign-in", () => {
  const source = read("screens/AuthScreen.js");

  assert.match(source, /const continueRoute = route\?\.params\?\.continueRoute;/);
  assert.match(source, /const continueParams = route\?\.params\?\.continueParams;/);
  assert.match(source, /navigation\.replace\(continueRoute, continueParams \|\| \{\}\);/);
  assert.match(source, /const continued = await continueActivationJourney\(\);/);
});

test("asset-thread-notify reuses the existing Postmark transaction path", () => {
  const source = read("supabase/functions/asset-thread-notify/index.ts");

  assert.match(source, /POSTMARK_SERVER_TOKEN/);
  assert.match(source, /https:\/\/api\.postmarkapp\.com\/email/);
  assert.match(source, /From:\s*"Keepr <hello@keeprhome\.com>"/);
  assert.match(source, /HtmlBody/);
  assert.match(source, /TextBody/);
  assert.match(source, /console\.log\("POSTMARK ASSET THREAD STATUS"/);
  assert.doesNotMatch(source, /sendgrid|mailgun|ses|resend/i);
});

test("asset-thread-notify sends privacy-safe exact-thread notifications non-blockingly", () => {
  const source = read("supabase/functions/asset-thread-notify/index.ts");

  assert.match(source, /type:\s*"asset_thread_message"/);
  assert.match(source, /thread_id:\s*threadId/);
  assert.match(source, /asset_id:\s*assetId/);
  assert.match(source, /kac,/);
  assert.match(source, /message_id:\s*messageId/);
  assert.match(source, /projection_type:\s*projectionType/);
  assert.match(source, /hub_id:/);
  assert.match(source, /buildThreadUrl/);
  assert.match(source, /catch \(emailError\) \{\s*console\.error\("Asset thread email failed"/s);
  assert.doesNotMatch(source, /Subject:\s*.*body/);
  assert.doesNotMatch(source, /Subject:\s*.*message/i);
});
