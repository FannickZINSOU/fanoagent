import express from "express";
import Anthropic from "@anthropic-ai/sdk";

const app = express();
app.use(express.json());

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const conversations = new Map();
const MAX_HISTORY = 20;

const SYSTEM_PROMPT = `Tu es un assistant multifonction au service de Fannick, gérant deux rôles :

## RÔLE 1 — Service Client (Business d'impression / print-on-demand)
Quand un client pose une question sur les commandes, les prix ou la livraison :
- Accueille chaleureusement en français (ou dans la langue du client)
- Réponds aux questions fréquentes :
  • Délais de production : 3–5 jours ouvrés
  • Livraison : 2–5 jours selon la zone
  • Formats disponibles : T-shirts, sweats, polos, tote bags, affiches
  • Paiement : virement, Mobile Money, PayPal
- Pour les devis personnalisés, dis : "Je transmets votre demande à Fannick, il vous recontactera sous 24h."

## RÔLE 2 — Assistant Personnel de Fannick
Quand le message provient du numéro personnel de Fannick :
- Tu es son assistant privé : rappels, organisation, recherche d'infos, aide à la rédaction
- Réponds toujours en français sauf demande contraire
- Sois direct et efficace

## RÈGLES GÉNÉRALES
- Messages courts et clairs
- Pas de markdown dans les réponses
- Si tu ne sais pas, dis-le honnêtement`;

function isOwner(phone) {
  return phone === process.env.OWNER_PHONE;
}

function getHistory(phone) {
  if (!conversations.has(phone)) conversations.set(phone, []);
  return conversations.get(phone);
}

function addToHistory(phone, role, content) {
  const history = getHistory(phone);
  history.push({ role, content });
  if (history.length > MAX_HISTORY) history.splice(0, history.length - MAX_HISTORY);
}

async function sendWhatsAppMessage(to, text) {
  const res = await fetch(
    `https://graph.facebook.com/v19.0/${process.env.PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: text },
      }),
    }
  );
  const data = await res.json();
  if (!res.ok) console.error("WhatsApp send error:", data);
  return data;
}

async function getAIResponse(phone, userMessage) {
  const ownerContext = isOwner(phone)
    ? "\n\n[MODE : Assistant Personnel de Fannick]"
    : "\n\n[MODE : Service Client]";

  addToHistory(phone, "user", userMessage);

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    system: SYSTEM_PROMPT + ownerContext,
    messages: getHistory(phone),
  });

  const aiText = response.content[0].text;
  addToHistory(phone, "assistant", aiText);
  return aiText;
}

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];
  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);
  try {
    const messages = req.body?.entry?.[0]?.changes?.[0]?.value?.messages;
    if (!messages || messages.length === 0) return;
    const msg = messages[0];
    if (msg.type !== "text") return;
    const phone = msg.from;
    const text = msg.text.body.trim();
    console.log(`Message de ${phone}: ${text}`);
    const reply = await getAIResponse(phone, text);
    await sendWhatsAppMessage(phone, reply);
  } catch (err) {
    console.error("Erreur:", err);
  }
});

app.get("/", (req, res) => res.json({ status: "OK" }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Agent démarré sur le port ${PORT}`));