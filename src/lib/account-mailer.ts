type AccountMail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
};

function mailFrom() {
  return process.env.MAIL_FROM ?? "TVMIX <noreply@tvmix.it>";
}

function senderEmailAndName() {
  const from = mailFrom();
  const match = from.match(/^(.*)<(.+)>$/);
  if (!match) return { email: from.trim(), name: "TVMIX" };
  const [, rawName = "", rawEmail = from] = match;
  return {
    name: rawName.trim() || "TVMIX",
    email: rawEmail.trim(),
  };
}

async function sendViaResend(mail: AccountMail, apiKey: string): Promise<void> {
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: mailFrom(),
      to: [mail.to],
      subject: mail.subject,
      text: mail.text,
      ...(mail.html ? { html: mail.html } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Invio email Resend fallito: ${response.status} ${await response.text()}`);
  }
}

async function sendViaBrevo(mail: AccountMail, apiKey: string): Promise<void> {
  const sender = senderEmailAndName();
  const response = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender,
      to: [{ email: mail.to }],
      subject: mail.subject,
      textContent: mail.text,
      ...(mail.html ? { htmlContent: mail.html } : {}),
    }),
  });

  if (!response.ok) {
    throw new Error(`Invio email Brevo fallito: ${response.status} ${await response.text()}`);
  }
}

async function sendMail(mail: AccountMail): Promise<void> {
  const resendApiKey = process.env.RESEND_API_KEY;
  if (resendApiKey) {
    await sendViaResend(mail, resendApiKey);
    return;
  }

  const brevoApiKey = process.env.BREVO_API_KEY;
  if (brevoApiKey) {
    await sendViaBrevo(mail, brevoApiKey);
    return;
  }

  const webhookUrl = process.env.MAIL_WEBHOOK_URL;

  if (webhookUrl) {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(process.env.MAIL_WEBHOOK_TOKEN
          ? { Authorization: `Bearer ${process.env.MAIL_WEBHOOK_TOKEN}` }
          : {}),
      },
      body: JSON.stringify(mail),
    });

    if (!response.ok) {
      throw new Error(`Invio email fallito: ${response.status}`);
    }
    return;
  }

  console.info("[TVMIX mail fallback: nessun provider email configurato]", {
    ...mail,
    html: mail.html ? "[omesso]" : undefined,
  });
}

function linkHtml(title: string, body: string, url: string) {
  return [
    "<!doctype html>",
    '<html lang="it">',
    "<body style=\"margin:0;background:#020a13;color:#f8fafc;font-family:Arial,sans-serif;padding:32px;\">",
    '<main style="max-width:560px;margin:0 auto;background:#06111d;border:1px solid #1d3044;border-radius:16px;padding:28px;">',
    '<div style="font-size:28px;font-weight:900;letter-spacing:-1px;"><span>TV</span><span style="color:#16b9f4;">MIX</span></div>',
    `<h1 style="margin:24px 0 8px;font-size:22px;">${title}</h1>`,
    `<p style="line-height:1.6;color:#cbd5e1;">${body}</p>`,
    `<p style="margin:28px 0;"><a href="${url}" style="display:inline-block;background:#16b9f4;color:white;text-decoration:none;font-weight:800;border-radius:10px;padding:14px 18px;">Apri link sicuro</a></p>`,
    `<p style="word-break:break-all;color:#94a3b8;font-size:12px;">${url}</p>`,
    '<p style="margin-top:28px;color:#64748b;font-size:12px;">Se non hai richiesto questa operazione, ignora questa email.</p>',
    "</main>",
    "</body>",
    "</html>",
  ].join("");
}

export async function sendEmailVerificationMail(to: string, url: string): Promise<void> {
  await sendMail({
    to,
    subject: "Verifica la tua email TVMIX",
    text: [
      "Ciao,",
      "per certificare la casella email del tuo account TVMIX apri questo link:",
      url,
      "Il link scade tra 24 ore.",
    ].join("\n\n"),
    html: linkHtml(
      "Verifica la tua email",
      "Per certificare la casella email del tuo account TVMIX apri il link sicuro qui sotto. Il link scade tra 24 ore.",
      url,
    ),
  });
}

export async function sendPasswordResetMail(to: string, url: string): Promise<void> {
  await sendMail({
    to,
    subject: "Recupero password TVMIX",
    text: [
      "Ciao,",
      "per impostare una nuova password del tuo account TVMIX apri questo link:",
      url,
      "Il link scade tra 2 ore. Se non hai richiesto il recupero, ignora questa email.",
    ].join("\n\n"),
    html: linkHtml(
      "Recupero password",
      "Per impostare una nuova password del tuo account TVMIX apri il link sicuro qui sotto. Il link scade tra 2 ore.",
      url,
    ),
  });
}
