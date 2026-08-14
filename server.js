"use strict";

/* Serveur de la télécommande.
 *
 * Jalon 1 : audio seulement. Le flux SSE, le média et l'écran arriveront à
 * leur jalon respectif — les routes correspondantes n'existent pas encore.
 *
 * Zéro dépendance : modules intégrés uniquement.
 */

const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const audio = require("./lib/audio.js");
const sse = require("./lib/sse.js");
const state = require("./lib/state.js");

/* Le sondage démarre à l'arrivée du premier client et s'arrête au départ du
   dernier : sans personne pour écouter, aucun process n'est forké. */
sse.configure({ onFirst: state.start, onLast: state.stop });

const PORT = 8765;
const PUBLIC_DIR = path.resolve(__dirname, "public");
const CONFIG_DIR = path.join(os.homedir(), ".remote");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

/* Le corps d'une requête ne dépasse jamais quelques dizaines d'octets ici. */
const MAX_BODY = 4096;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml"
};

/* Distingue une faute du client (400) d'une panne système (500). */
class BadRequest extends Error {}

/* ---------- token ---------- */

/* Généré au premier lancement, conservé ensuite. Un token par machine :
   les installations sont indépendantes et ne partagent rien. */
function loadToken() {
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, "utf8"));
    if (typeof config.token === "string" && /^[0-9a-f]{32}$/.test(config.token)) {
      return config.token;
    }
  } catch (e) {
    /* Premier lancement, ou fichier illisible : on en régénère un. */
  }
  const token = crypto.randomBytes(16).toString("hex");
  fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify({ token }, null, 2) + "\n", { mode: 0o600 });
  return token;
}

const TOKEN = loadToken();

/* En-tête X-Token, ou paramètre « t » dans l'URL. Les deux sont nécessaires :
   EventSource n'accepte aucun en-tête personnalisé, et le flux SSE devra donc
   passer par l'URL au jalon 3. Comparaison à temps constant. */
function checkToken(req, url) {
  const given = String(req.headers["x-token"] || url.searchParams.get("t") || "");
  const a = Buffer.from(given);
  const b = Buffer.from(TOKEN);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------- réponses ---------- */

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function sendText(res, status, message) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(message);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > MAX_BODY) {
        req.destroy();
        reject(new BadRequest("corps trop volumineux"));
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        return reject(new BadRequest("corps JSON invalide"));
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return reject(new BadRequest("corps JSON invalide"));
      }
      resolve(parsed);
    });
    req.on("error", reject);
  });
}

/* ---------- API ---------- */

async function handleVolume(req, res) {
  if (!audio.state.controllable) {
    return sendJson(res, 409, { error: "cette sortie audio ne laisse pas régler son volume" });
  }

  const body = await readBody(req);
  let value;

  if (Object.prototype.hasOwnProperty.call(body, "value")) {
    if (!Number.isInteger(body.value) || body.value < 0 || body.value > 100) {
      throw new BadRequest("value doit être un entier de 0 à 100");
    }
    value = body.value;
  } else if (Object.prototype.hasOwnProperty.call(body, "delta")) {
    if (!Number.isInteger(body.delta) || body.delta < -100 || body.delta > 100) {
      throw new BadRequest("delta doit être un entier de -100 à 100");
    }
    /* Le delta s'applique à l'état réel du moment, pas à ce que croit le
       client : quand plusieurs télécommandes coexistent, une valeur absolue
       écraserait le réglage de quelqu'un d'autre. */
    value = Math.min(100, Math.max(0, audio.state.volume + body.delta));
  } else {
    throw new BadRequest("corps attendu : { value } ou { delta }");
  }

  const result = await audio.setVolume(value);
  state.publish(result);
  return sendJson(res, 200, result);
}

async function handleMute(req, res) {
  const body = await readBody(req);
  let muted;

  if (body.toggle === true) {
    muted = !audio.state.muted;
  } else if (typeof body.muted === "boolean") {
    muted = body.muted;
  } else {
    throw new BadRequest("corps attendu : { muted } ou { toggle: true }");
  }

  const result = await audio.setMuted(muted);
  state.publish(result);
  return sendJson(res, 200, result);
}

async function handleApi(req, res, url) {
  if (!checkToken(req, url)) {
    return sendJson(res, 401, { error: "token absent ou invalide" });
  }

  try {
    if (req.method === "GET" && url.pathname === "/api/state") {
      return sendJson(res, 200, await audio.read());
    }
    if (req.method === "GET" && url.pathname === "/api/events") {
      /* État courant sans relecture : le client fait de toute façon un
         GET /api/state à l'affichage, inutile de forker deux fois. */
      return sse.attach(req, res, audio.snapshot());
    }
    if (req.method === "POST" && url.pathname === "/api/volume") {
      return await handleVolume(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/mute") {
      return await handleMute(req, res);
    }
    return sendJson(res, 404, { error: "route inconnue" });
  } catch (err) {
    if (err instanceof BadRequest) {
      return sendJson(res, 400, { error: err.message });
    }
    /* Seules les erreurs sont journalisées. */
    console.error("[erreur]", url.pathname, err.message);
    return sendJson(res, 500, { error: "échec de la commande système" });
  }
}

/* ---------- fichiers statiques ---------- */

/* Non protégés par le token, conformément au §9 : la page seule ne peut rien
   déclencher, et c'est elle qui transporte le token dans son URL. */
function serveStatic(req, res, url) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    return sendText(res, 405, "méthode non autorisée");
  }

  let name;
  try {
    name = decodeURIComponent(url.pathname);
  } catch (e) {
    return sendText(res, 400, "chemin invalide");
  }
  const file = path.resolve(PUBLIC_DIR, name === "/" ? "index.html" : name.replace(/^\/+/, ""));

  /* Empêche de sortir de public/ par des « .. ». */
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    return sendText(res, 403, "accès refusé");
  }

  fs.readFile(file, (err, data) => {
    if (err) return sendText(res, 404, "introuvable");
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Content-Length": data.length,
      "Cache-Control": "no-cache"
    });
    res.end(req.method === "HEAD" ? undefined : data);
  });
}

/* ---------- serveur ---------- */

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    return handleApi(req, res, url);
  }
  return serveStatic(req, res, url);
});

audio.init().then(() => {
  /* 0.0.0.0 est indispensable pour que l'iPhone joigne le Mac. Le pare-feu
     macOS demandera l'autorisation au premier lancement. */
  server.listen(PORT, "0.0.0.0", () => {
    const host = os.hostname();
    console.log("remote — jalon 1 (audio)");
    console.log("  local   http://localhost:" + PORT + "/?t=" + TOKEN);
    console.log("  réseau  http://" + host + ":" + PORT + "/?t=" + TOKEN);
    console.log("  token   " + CONFIG_FILE);
  });
}).catch(err => {
  console.error("impossible de lire l'état audio au démarrage :", err.message);
  process.exit(1);
});
