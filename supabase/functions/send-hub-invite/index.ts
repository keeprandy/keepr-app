const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const { to, hubName, inviteUrl, role, personalNote } = await req.json();

    console.log("SEND HUB INVITE BODY", {
      to,
      hubName,
      inviteUrl,
      role,
      personalNote,
    });

    if (!to || !inviteUrl) {
      return new Response(
        JSON.stringify({ error: "Missing to or inviteUrl" }),
        { status: 400, headers: corsHeaders }
      );
    }

    const token = Deno.env.get("POSTMARK_SERVER_TOKEN");

    if (!token) {
      return new Response(
        JSON.stringify({ error: "Missing POSTMARK_SERVER_TOKEN" }),
        { status: 500, headers: corsHeaders }
      );
    }

    const safeNote = String(personalNote || "").trim();
    const subject = `You've been invited to ${hubName || "a Keepr Hub"}`;

    const noteHtml = safeNote
      ? `<p style="font-size:16px;line-height:1.5;margin:18px 0;padding:14px 16px;background:#f6f8fb;border-radius:12px;"><strong>Personal note:</strong><br/>${safeNote}</p>`
      : "";

    const noteText = safeNote
      ? `\n\nPersonal note:\n${safeNote}\n`
      : "";

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
        <h1>${hubName || "Keepr Hub"}</h1>
        <p>You’ve been invited to join this Keepr Hub as a ${role || "member"}.</p>
        ${noteHtml}
        <p>View the member stories and add your asset.</p>
        <a href="${inviteUrl}" style="display:inline-block;padding:12px 18px;background:#111827;color:white;text-decoration:none;border-radius:10px;font-weight:700;">
          View Member Stories
        </a>
        <p style="font-size:12px;color:#777;margin-top:24px;">${inviteUrl}</p>
      </div>
    `;

    const textBody =
      `${hubName || "Keepr Hub"}\n\n` +
      `You've been invited to join this Keepr Hub as a ${role || "member"}.\n` +
      noteText +
      `\nView the member stories and add your asset:\n${inviteUrl}`;

    const postmarkRes = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Postmark-Server-Token": token,
      },
      body: JSON.stringify({
        From: "Keepr <hello@keeprhome.com>",
        To: to,
        Subject: subject,
        HtmlBody: html,
        TextBody: textBody,
      }),
    });

    const resultText = await postmarkRes.text();

    console.log("POSTMARK STATUS", postmarkRes.status);
    console.log("POSTMARK RESPONSE", resultText);

    return new Response(resultText, {
      status: postmarkRes.status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json",
      },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ error: e?.message || "Unknown error" }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});