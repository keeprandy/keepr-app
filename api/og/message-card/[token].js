import crypto from "crypto";
import {
  buildDescription,
  getRequestBaseUrl,
  getSupabaseClient,
  h,
  safeString,
  sendImageResponse,
} from "../_shared.js";

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function previewText(value, max = 120) {
  const text = safeString(value).replace(/\s+/g, " ");
  return text.length > max ? `${text.slice(0, max - 1).trim()}…` : text;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(safeString(value));
}

async function canFetchImage(url) {
  if (!isHttpUrl(url)) return false;
  try {
    const head = await fetch(url, { method: "HEAD" });
    const type = head.headers.get("content-type") || "";
    if (head.ok && type.toLowerCase().startsWith("image/")) return true;
  } catch (_) {
    // Some storage backends reject HEAD; try a tiny GET below.
  }

  try {
    const get = await fetch(url, { headers: { range: "bytes=0-1023" } });
    const type = get.headers.get("content-type") || "";
    return get.ok && type.toLowerCase().startsWith("image/");
  } catch (_) {
    return false;
  }
}

function buildMessageCardElement({
  senderName,
  subjectName,
  description,
  imageUrl,
  isFallback,
}) {
  return h(
    "div",
    {
      style: {
        width: "1200px",
        height: "630px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "#EAF1FF",
        fontFamily: "Arial",
      },
    },
    h(
      "div",
      {
        style: {
          width: "1132px",
          height: "562px",
          display: "flex",
          flexDirection: "row",
          gap: "58px",
          padding: "38px",
          borderRadius: "46px",
          background: "linear-gradient(135deg, #FFFFFF 0%, #F3F7FF 100%)",
          boxShadow: "0 24px 70px rgba(15, 23, 42, 0.18)",
          border: "1px solid rgba(37, 99, 235, 0.13)",
        },
      },
      h(
        "div",
        {
          style: {
            width: "470px",
            height: "486px",
            display: "flex",
            borderRadius: "34px",
            overflow: "hidden",
            background: "#DCE8FF",
            border: "10px solid rgba(255, 255, 255, 0.78)",
          },
        },
        h("img", {
          src: imageUrl,
          width: 470,
          height: 486,
          style: {
            width: "470px",
            height: "486px",
            objectFit: isFallback ? "contain" : "cover",
          },
        })
      ),
      h(
        "div",
        {
          style: {
            width: "512px",
            height: "486px",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          },
        },
        h(
          "div",
          {
            style: {
              display: "flex",
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "24px",
            },
          },
          h(
            "div",
            {
              style: {
                display: "flex",
                color: "#2563EB",
                fontSize: "28px",
                fontWeight: 800,
              },
            },
            "Keepr Message"
          ),
          h(
            "div",
            {
              style: {
                width: "76px",
                height: "76px",
                borderRadius: "38px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                background: "rgba(37, 99, 235, 0.16)",
              },
            },
            h(
              "div",
              {
                style: {
                  width: "44px",
                  height: "44px",
                  borderRadius: "22px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#FFFFFF",
                  background: "#2563EB",
                  fontSize: "24px",
                  fontWeight: 900,
                },
              },
              "K"
            )
          )
        ),
        h(
          "div",
          {
            style: {
              display: "flex",
              color: "#0F172A",
              fontSize: "48px",
              fontWeight: 900,
              lineHeight: "1.04",
              marginBottom: "20px",
            },
          },
          `${senderName} sent you a Keepr message`
        ),
        h(
          "div",
          {
            style: {
              display: "flex",
              color: "#2563EB",
              fontSize: "26px",
              fontWeight: 850,
              lineHeight: "1.18",
              marginBottom: "20px",
            },
          },
          subjectName
        ),
        h(
          "div",
          {
            style: {
              display: "flex",
              color: "#475569",
              fontSize: "24px",
              fontWeight: 500,
              lineHeight: "1.28",
              marginBottom: "26px",
            },
          },
          description
        ),
        h(
          "div",
          {
            style: {
              width: "244px",
              height: "56px",
              borderRadius: "28px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#FFFFFF",
              background: "#2563EB",
              fontSize: "22px",
              fontWeight: 800,
            },
          },
          "Open in Keepr"
        )
      )
    )
  );
}

async function loadCard(token) {
  const supabase = getSupabaseClient({ service: true });
  if (!supabase || !token) return null;

  const { data: tokenRow } = await supabase
    .from("public_asset_thread_tokens")
    .select("thread_id, sender_name, expires_at, revoked_at")
    .eq("token_hash", hashToken(token))
    .maybeSingle();
  if (!tokenRow?.thread_id || tokenRow.revoked_at) return null;
  if (tokenRow.expires_at && new Date(tokenRow.expires_at).getTime() < Date.now()) return null;

  const { data: thread } = await supabase
    .from("asset_threads")
    .select("id, asset_id, system_id, created_by")
    .eq("id", tokenRow.thread_id)
    .maybeSingle();
  if (!thread?.id) return null;

  const [{ data: asset }, { data: system }, { data: firstMessages }, { data: profile }] =
    await Promise.all([
      supabase.from("assets").select("id, name, kac_id").eq("id", thread.asset_id).maybeSingle(),
      thread.system_id
        ? supabase.from("systems").select("id, name").eq("id", thread.system_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase
        .from("asset_thread_messages")
        .select("body")
        .eq("thread_id", thread.id)
        .order("created_at", { ascending: true })
        .limit(1),
      thread.created_by
        ? supabase.from("profiles").select("display_name, full_name, avatar_url, photo_url").eq("id", thread.created_by).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

  const senderName =
    safeString(profile?.display_name || profile?.full_name) ||
    safeString(tokenRow.sender_name) ||
    "A Keepr member";
  const subjectName = safeString(system?.name) || safeString(asset?.name) || "Keepr";
  return {
    senderName,
    subjectName: `About ${subjectName}${system?.name && asset?.name ? ` on ${asset.name}` : ""}`,
    description: buildDescription([
      previewText(firstMessages?.[0]?.body),
    ], "Continue the conversation in Keepr."),
    imageUrl: safeString(profile?.avatar_url || profile?.photo_url),
  };
}

export default async function handler(req, res) {
  const baseUrl = getRequestBaseUrl(req);
  const rawToken = req.query?.token;
  const token = safeString(Array.isArray(rawToken) ? rawToken[0] : rawToken);
  let card = null;
  try {
    card = await loadCard(token);
  } catch (_) {
    card = null;
  }

  const fallbackImage = `${baseUrl}/og/member-node-default.png`;
  const useProfileImage = await canFetchImage(card?.imageUrl);
  const imageUrl = useProfileImage ? card.imageUrl.trim() : fallbackImage;

  return sendImageResponse(
    res,
    buildMessageCardElement({
      senderName: card?.senderName || "A Keepr member",
      subjectName: card?.subjectName || "Keepr conversation",
      description: card?.description || "Continue the conversation in Keepr.",
      imageUrl,
      isFallback: !useProfileImage,
    })
  );
}
