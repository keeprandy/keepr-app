import { createClient } from "@supabase/supabase-js";
import { getRequestBaseUrl, h, sendImageResponse } from "../_shared.js";

function isUsableDisplayName(value) {
  const name = String(value || "").trim();
  return !!name && name.toLowerCase() !== "keepr member";
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || "").trim());
}

async function canFetchImage(url) {
  if (!isHttpUrl(url)) return false;

  try {
    const head = await fetch(url, { method: "HEAD" });
    const type = head.headers.get("content-type") || "";
    if (head.ok && type.toLowerCase().startsWith("image/")) return true;
  } catch (_) {
    // Some storage backends reject HEAD; try a bounded GET below.
  }

  try {
    const get = await fetch(url, {
      headers: { range: "bytes=0-1023" },
    });
    const type = get.headers.get("content-type") || "";
    return get.ok && type.toLowerCase().startsWith("image/");
  } catch (_) {
    return false;
  }
}

function buildCardElement({ displayName, imageUrl, isFallback }) {
  const name = isUsableDisplayName(displayName) ? displayName.trim() : null;
  const title = name ? `${name} invited you to Keepr` : "A Keepr member invited you.";
  const subtitle = "I’m a Keepr. Become one.";

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
          gap: "70px",
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
            width: "500px",
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
              marginBottom: "26px",
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
                "Keepr Invitation"
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
              fontSize: "54px",
              fontWeight: 900,
              lineHeight: "1.03",
              marginBottom: "28px",
            },
          },
          title
        ),
        h(
          "div",
          {
            style: {
              display: "flex",
              color: "#2563EB",
              fontSize: "38px",
              fontWeight: 850,
              marginBottom: "28px",
            },
          },
          subtitle
        ),
        h(
          "div",
          {
            style: {
              display: "flex",
              color: "#475569",
              fontSize: "25px",
              fontWeight: 500,
              lineHeight: "1.32",
              marginBottom: "34px",
            },
          },
          "A trusted place to keep the story, records, and proof behind what you own."
        ),
        h(
          "div",
          {
            style: {
              width: "270px",
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
          "Become a Keepr"
        )
      )
    )
  );
}

export default async function handler(req, res) {
  const baseUrl = getRequestBaseUrl(req);
  const rawSlug = req.query?.slug;
  const slug = Array.isArray(rawSlug) ? rawSlug[0] : rawSlug;
  const fallbackImage = `${baseUrl}/og/member-node-default.png`;

  let displayName = null;
  let candidateImage = null;

  try {
    const SUPABASE_URL =
      process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
    const SUPABASE_ANON_KEY =
      process.env.SUPABASE_ANON_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

    if (slug && SUPABASE_URL && SUPABASE_ANON_KEY) {
      const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: { persistSession: false },
      });
      const { data } = await supabase.rpc("resolve_member_invite_link", {
        p_slug: slug,
      });
      const row = Array.isArray(data) ? data[0] : data;
      displayName = row?.display_name || null;
      candidateImage = row?.image_url || null;
    }
  } catch (_) {
    displayName = null;
    candidateImage = null;
  }

  const useProfileImage = await canFetchImage(candidateImage);
  const imageUrl = useProfileImage ? candidateImage.trim() : fallbackImage;

  return sendImageResponse(
    res,
    buildCardElement({
      displayName,
      imageUrl,
      isFallback: !useProfileImage,
    })
  );
}
