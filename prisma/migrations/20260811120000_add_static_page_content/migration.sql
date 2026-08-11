CREATE TABLE IF NOT EXISTS "StaticPageContent" (
  "slug" VARCHAR(64) NOT NULL,
  "title" TEXT NOT NULL,
  "subtitle" TEXT,
  "body" TEXT NOT NULL,
  "seoTitle" TEXT,
  "seoDescription" TEXT,
  "published" BOOLEAN NOT NULL DEFAULT true,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "updatedBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StaticPageContent_pkey" PRIMARY KEY ("slug")
);

CREATE INDEX IF NOT EXISTS "StaticPageContent_published_sortOrder_idx" ON "StaticPageContent"("published", "sortOrder");

INSERT INTO "StaticPageContent" ("slug", "title", "subtitle", "body", "sortOrder")
VALUES
  ('chi-siamo', 'Chi siamo', 'La piattaforma editoriale e video di TVMIX.', 'Inserisci da backend il testo istituzionale della pagina Chi siamo.', 10),
  ('contatti', 'Contatti', 'Come entrare in contatto con la redazione e con TVMIX.', 'Inserisci da backend indirizzi, email, recapiti e riferimenti operativi.', 20),
  ('assistenza', 'Assistenza', 'Supporto agli utenti e informazioni tecniche.', 'Inserisci da backend le istruzioni per assistenza, FAQ e supporto.', 30),
  ('lavora-con-noi', 'Lavora con noi', 'Opportunità, collaborazioni e candidature.', 'Inserisci da backend le informazioni per collaborare o candidarsi.', 40),
  ('privacy-policy', 'Privacy Policy', 'Informativa sul trattamento dei dati personali.', 'Inserisci da backend il testo completo della Privacy Policy.', 50),
  ('cookie', 'Cookie', 'Informativa sull’utilizzo dei cookie.', 'Inserisci da backend il testo completo della Cookie Policy.', 60)
ON CONFLICT ("slug") DO NOTHING;
