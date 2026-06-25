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
    const { to, hubName, inviteUrl, role } = await req.json();

    console.log("SEND HUB INVITE BODY", {
  to,
  hubName,
  inviteUrl,
  role,
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

    const subject = `You've been invited to ${hubName || "a Keepr Hub"}`;

    const html = `
      <div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;padding:24px;">
        <h1>${hubName || "Keepr Hub"}</h1>
        <p>You’ve been invited to join this Keepr Hub as a ${role || "member"}.</p>
        <p>View the member stories and add your asset.</p>
        <a href="${inviteUrl}" style="display:inline-block;padding:12px 18px;background:#111827;color:white;text-decoration:none;border-radius:10px;font-weight:700;">
          View Member Stories
        </a>
        <p style="font-size:12px;color:#777;margin-top:24px;">${inviteUrl}</p>
      </div>
    `;

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
        TextBody: `${hubName || "Keepr Hub"}\n\nAccept this invitation and add your Keepr Story:\n${inviteUrl}`,
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