import nodemailer from "nodemailer";
import MailComposer from "nodemailer/lib/mail-composer/index.js";
import { ImapFlow } from "imapflow";

const BOITE = "contact@myreset.fr";
const SERVEUR = "mail.infomaniak.com";
const auth = () => ({ user: BOITE, pass: process.env.MAIL_PASSWORD });

const smtp = () =>
  nodemailer.createTransport({ host: SERVEUR, port: 465, secure: true, auth: auth() });

function resumeDemande(d) {
  return [
    `Reçue le : ${d.recue.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}`,
    `Nom / pseudonyme : ${d.name}`,
    `Email : ${d.email}`,
    `Nom recherché : ${d.nom_google || "non fourni (aucune recherche web)"}`,
    `Situation : « ${d.situation} »`,
  ].join("\n");
}

// Dépose la lettre dans le dossier Brouillons, adressée au prospect.
async function deposerBrouillon(d, diag) {
  const brut = await new MailComposer({
    from: `"MyReset" <${BOITE}>`,
    to: d.email,
    subject: diag.objet,
    text: diag.lettre,
    date: new Date(),
  }).compile().build();

  const imap = new ImapFlow({ host: SERVEUR, port: 993, secure: true, auth: auth(), logger: false });
  await imap.connect();
  try {
    const dossiers = await imap.list();
    const brouillons = dossiers.find((b) => b.specialUse === "\\Drafts")?.path ?? "Drafts";
    await imap.append(brouillons, brut, ["\\Draft", "\\Seen"]);
  } finally {
    await imap.logout();
  }
}

export async function livrer(d, diag) {
  let brouillonOk = true;
  try {
    await deposerBrouillon(d, diag);
  } catch (err) {
    brouillonOk = false;
    console.error("Brouillon IMAP impossible :", err);
  }

  const sources = diag.sources.length
    ? diag.sources.map((s) => `– ${s.titre}\n  ${s.url}`).join("\n")
    : "Aucune (pas de recherche web).";

  const entete = brouillonOk
    ? `Le diagnostic est prêt dans le dossier « Brouillons » de ${BOITE}, déjà adressé à ${d.email}.\nRelis-le, corrige si besoin, puis clique « Envoyer ».`
    : `⚠️ Le brouillon n'a pas pu être déposé dans « Brouillons ». Le texte complet est en bas de ce mail : copie-le dans un nouveau message à ${d.email}.`;

  const corps = [
    entete,
    "",
    "━━ LA DEMANDE ━━",
    resumeDemande(d),
    "",
    "━━ NOTE INTERNE DE L'ANALYSE ━━",
    diag.note || "(aucune note)",
    "",
    "━━ SOURCES CONSULTÉES ━━",
    sources,
    ...(brouillonOk ? [] : ["", "━━ TEXTE DU DIAGNOSTIC À ENVOYER ━━", `Objet : ${diag.objet}`, "", diag.lettre]),
    "",
    `— Pré-analyse automatique (${diag.modele}). Ne transfère pas ce mail au prospect.`,
  ].join("\n");

  await smtp().sendMail({
    from: `"Agent diagnostic MyReset" <${BOITE}>`,
    to: BOITE,
    subject: `[À valider] Diagnostic — ${d.name}`,
    text: corps,
  });
}

export async function alerterEchec(d, err) {
  await smtp().sendMail({
    from: `"Agent diagnostic MyReset" <${BOITE}>`,
    to: BOITE,
    subject: `[Échec] Diagnostic automatique — ${d.name}`,
    text: [
      "Le diagnostic automatique n'a pas pu être rédigé. La demande, elle, est bien arrivée : fais le diagnostic à la main.",
      "",
      resumeDemande(d),
      "",
      `Erreur : ${err?.message ?? err}`,
    ].join("\n"),
  });
}
