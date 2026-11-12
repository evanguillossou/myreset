import { waitUntil } from "@vercel/functions";
import { rediger } from "../lib/diagnostic.js";
import { livrer, alerterEchec } from "../lib/mail.js";

const ORIGINES = new Set(["https://myreset.fr", "https://www.myreset.fr"]);
const LIMITES = { name: 120, email: 200, nom_google: 150, situation: 2000 };

const reponse = (status) =>
  new Response(JSON.stringify({ ok: status < 400 }), {
    status,
    headers: { "Content-Type": "application/json" },
  });

async function traiter(d) {
  try {
    await livrer(d, await rediger(d));
  } catch (err) {
    console.error("Diagnostic échoué :", err);
    await alerterEchec(d, err).catch((e) => console.error("Alerte d'échec non envoyée :", e));
  }
}

export async function POST(request) {
  if (!ORIGINES.has(request.headers.get("origin"))) return reponse(403);

  let corps;
  try {
    corps = await request.json();
  } catch {
    return reponse(400);
  }
  if (corps.botcheck) return reponse(202); // champ piège rempli : robot, on ignore

  const d = {};
  for (const [champ, max] of Object.entries(LIMITES)) {
    d[champ] = String(corps[champ] ?? "").trim().slice(0, max);
  }
  if (!d.name || !d.situation || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) return reponse(400);
  d.recue = new Date();

  // Répond tout de suite au navigateur ; l'analyse continue en arrière-plan.
  waitUntil(traiter(d));
  return reponse(202);
}
