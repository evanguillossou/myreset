import Anthropic from "@anthropic-ai/sdk";
import { SYSTEM_PROMPT } from "./prompt.js";

const client = new Anthropic(); // lit ANTHROPIC_API_KEY
const MAX_REPRISES = 4; // reprises d'un tour mis en pause par la recherche web

// Empêche un champ saisi de fermer ou d'ouvrir une balise du message.
const neutre = (s) => String(s).replace(/[<>]/g, (c) => (c === "<" ? "‹" : "›"));

function messageDemande(d) {
  return `Nouvelle demande de diagnostic reçue via le formulaire du site.

<demande>
<date_reception>${d.recue.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })}</date_reception>
<nom_ou_pseudonyme>${neutre(d.name)}</nom_ou_pseudonyme>
<nom_a_rechercher>${d.nom_google ? neutre(d.nom_google) : ""}</nom_a_rechercher>
<situation>${neutre(d.situation)}</situation>
</demande>`;
}

function bloc(texte, balise) {
  const m = texte.match(new RegExp(`<${balise}>([\\s\\S]*?)</${balise}>`));
  return m ? m[1].trim() : "";
}

export async function rediger(d) {
  const tools = d.nom_google
    ? [{
        type: "web_search_20260209",
        name: "web_search",
        max_uses: 6,
        user_location: { type: "approximate", country: "FR", timezone: "Europe/Paris" },
      }]
    : undefined;

  const messages = [{ role: "user", content: messageDemande(d) }];
  const tours = [];
  let message;

  for (let i = 0; i <= MAX_REPRISES; i++) {
    const stream = client.beta.messages.stream({
      model: "claude-opus-5-5",
      max_tokens: 32000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      ...(tools && { tools }),
      messages,
    });
    message = await stream.finalMessage();
    tours.push(message);
    if (message.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: message.content });
  }

  if (message.stop_reason === "refusal") {
    throw new Error(`Le modèle a refusé la demande (${message.stop_details?.category ?? "catégorie inconnue"}).`);
  }
  if (message.stop_reason !== "end_turn") {
    throw new Error(`Rédaction interrompue (stop_reason : ${message.stop_reason}).`);
  }

  const texte = tours
    .flatMap((t) => t.content)
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("");

  const sources = new Map();
  for (const b of tours.flatMap((t) => t.content)) {
    if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
      for (const r of b.content) if (r.url) sources.set(r.url, r.title ?? r.url);
    }
  }

  const lettre = bloc(texte, "lettre");
  if (!lettre) throw new Error("Réponse du modèle sans bloc <lettre>.");

  return {
    objet: bloc(texte, "objet") || "Votre diagnostic confidentiel — MyReset",
    lettre,
    note: bloc(texte, "note_interne"),
    sources: [...sources].map(([url, titre]) => ({ url, titre })),
    modele: message.model,
  };
}
