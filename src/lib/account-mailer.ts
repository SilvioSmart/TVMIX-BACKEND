type AccountMail = {
  to: string;
  subject: string;
  text: string;
};

async function sendMail(mail: AccountMail): Promise<void> {
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

  console.info("[TVMIX mail fallback]", mail);
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
  });
}

