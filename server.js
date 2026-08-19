/* Winx Remote — télécommande de volume, de lecture et d'écran pour un Mac.
 * Copyright (C) 2026 Emmanuel Danan <emmanuel.danan@gmail.com>
 *
 * Distribué sous licence GNU General Public License, version 3 ou
 * ultérieure. Voir le fichier LICENSE à la racine du projet.
 */

"use strict";

/* Serveur de la télécommande.
 *
 * Zéro dépendance : modules intégrés uniquement.
 */

const http = require("node:http");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const audio = require("./lib/audio.js");
const brightness = require("./lib/brightness.js");
const fullscreen = require("./lib/fullscreen.js");
const media = require("./lib/media.js");
const webplayer = require("./lib/webplayer.js");
const display = require("./lib/display.js");
const sse = require("./lib/sse.js");
const state = require("./lib/state.js");

const MEDIA_ACTIONS = ["playpause", "next", "previous"];

/* Le sondage démarre à l'arrivée du premier client et s'arrête au départ du
   dernier : sans personne pour écouter, aucun process n'est forké. */
sse.configure({ onFirst: state.start, onLast: state.stop });

const PORT = 8765;
const PUBLIC_DIR = path.resolve(__dirname, "public");
const CONFIG_DIR = path.join(os.homedir(), ".remote");
const CONFIG_FILE = path.join(CONFIG_DIR, "config.json");

/* Durée de mise en cache des fichiers statiques, en secondes. */
const CACHE_STATIQUE = 604800;

/* Le corps d'une requête ne dépasse jamais quelques dizaines d'octets ici. */
const MAX_BODY = 4096;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2"
};

/* ---------- version de l'interface ---------- */

/* Les fichiers statiques sont mis en cache pour une semaine, faute de quoi
   la télécommande ne s'ouvre pas du tout sans réseau : le navigateur exige
   de revalider, la revalidation échoue, et l'écran hors connexion lui-même
   ne peut pas s'afficher. Un service worker ferait mieux, mais il réclame un
   contexte sécurisé — inaccessible en HTTP sur une adresse locale (§8).

   Le cache empêcherait alors de voir les modifications de l'interface. On
   publie donc son empreinte : la page connaît la sienne, l'API annonce
   l'actuelle, et le client se recharge de lui-même quand les deux diffèrent.
   L'empreinte est recalculée dès que le fichier change de date. */
const PAGE = path.join(PUBLIC_DIR, "index.html");
let versionCache = { mtime: 0, valeur: "0", contenu: null };

function pageVersionnee() {
  let mtime = 0;
  try {
    mtime = fs.statSync(PAGE).mtimeMs;
  } catch (e) {
    return versionCache;
  }
  if (mtime !== versionCache.mtime) {
    const brut = fs.readFileSync(PAGE, "utf8");
    const valeur = crypto.createHash("sha1").update(brut).digest("hex").slice(0, 8);
    versionCache = { mtime, valeur, contenu: brut.split("__VERSION__").join(valeur) };
  }
  return versionCache;
}

/* Distingue une faute du client (400) d'une panne système (500). */
class BadRequest extends Error {}

/* ---------- périmètre réseau ---------- */

/* Le serveur écoute sur toutes les interfaces, faute de quoi l'iPhone ne
   pourrait pas le joindre. Mais il n'a aucune raison de répondre ailleurs
   que sur le réseau domestique : sans ce filtre, emporter le MacBook dans
   un café l'exposerait à tout le sous-réseau public.

   La protection a une limite qu'il faut connaître : un réseau public
   distribue lui aussi des adresses privées. Ce filtre supprime l'exposition
   absurde, pas le voisin de table — c'est le token qui s'en charge. */
function isLocalAddress(address) {
  if (!address) return false;
  let addr = String(address);

  /* Node renvoie parfois une adresse IPv4 encapsulée en IPv6. */
  if (addr.indexOf("::ffff:") === 0) addr = addr.slice(7);
  if (addr === "::1") return true;

  const v6 = addr.toLowerCase();
  if (v6.indexOf("fe80:") === 0) return true;        // lien-local
  if (/^f[cd][0-9a-f]{2}:/.test(v6)) return true;     // adresses uniques locales

  const parts = addr.split(".");
  if (parts.length !== 4) return false;
  const n = parts.map(Number);
  if (n.some(v => !Number.isInteger(v) || v < 0 || v > 255)) return false;

  if (n[0] === 127) return true;                              // boucle locale
  if (n[0] === 10) return true;                               // 10/8
  if (n[0] === 172 && n[1] >= 16 && n[1] <= 31) return true;  // 172.16/12
  if (n[0] === 192 && n[1] === 168) return true;              // 192.168/16
  if (n[0] === 169 && n[1] === 254) return true;              // lien-local
  return false;
}

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

/* Adresses par lesquelles ce Mac est joignable en ce moment. L'icône de
   l'écran d'accueil fige l'adresse choisie le jour où on l'a posée, alors que
   le réseau, lui, change : le nom Bonjour ne résout pas en partage de
   connexion, et l'adresse IP d'hier n'est plus celle d'aujourd'hui. La
   télécommande les retient tant qu'elle nous joint, pour savoir où chercher
   quand la sienne devient muette. */
function localAddresses() {
  const vues = new Set();
  const liste = [];
  const ajouter = hote => { if (hote && !vues.has(hote)) { vues.add(hote); liste.push(hote); } };

  /* os.hostname() rend le nom tel que le réseau courant le suffixe — « .home »
     derrière une box, « .local » ailleurs. On publie les deux : le nom Bonjour
     est celui du QR code, et c'est le plus robuste à la maison. */
  const brut = os.hostname();
  ajouter(brut);
  ajouter(brut.split(".")[0] + ".local");

  const cartes = os.networkInterfaces();
  for (const nom of Object.keys(cartes)) {
    for (const carte of cartes[nom] || []) {
      /* Node a hésité entre « IPv4 » et 4 selon les versions. */
      const v4 = carte.family === "IPv4" || carte.family === 4;
      /* 169.254.x est une auto-configuration : la carte est branchée mais
         personne ne lui a donné d'adresse. Elle ne mène nulle part. */
      if (v4 && !carte.internal && !carte.address.startsWith("169.254.")) {
        ajouter(carte.address);
      }
    }
  }
  return liste;
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

  const result = state.compose(await audio.setVolume(value));
  state.publish(result);
  return sendJson(res, 200, result);
}

async function handleBrightness(req, res) {
  if (!brightness.state.controllable) {
    return sendJson(res, 409, { error: "cet écran ne laisse pas régler sa luminosité" });
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
    /* Comme pour le volume, le delta s'applique à l'état réel du moment et
       non à ce que croit le client. */
    value = Math.min(100, Math.max(0, brightness.state.value + body.delta));
  } else {
    throw new BadRequest("corps attendu : { value } ou { delta }");
  }

  await brightness.setValue(value);
  const result = state.compose();
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

  const result = state.compose(await audio.setMuted(muted));
  state.publish(result);
  return sendJson(res, 200, result);
}

async function handleMedia(req, res) {
  const body = await readBody(req);

  /* Déplacement à une position absolue, en secondes. */
  if (body.action === "seek") {
    if (!Number.isFinite(body.position) || body.position < 0 || body.position > 86400) {
      throw new BadRequest("position doit être un nombre de secondes de 0 à 86400");
    }

    /* La page sait sauter exactement, là où MediaRemote dépend des commandes
       que le site déclare — Netflix n'en déclare presque aucune. Elle a donc
       la main dès qu'elle répond. */
    if (webplayer.isAvailable()) {
      try {
        await webplayer.seek(fullscreen.snapshot().app, body.position);
      } catch (err) {
        /* Page qui ne supporte pas qu'on lui impose une position : refus net,
           plutôt qu'une lecture interrompue. */
        if (err.blocked) return sendJson(res, 409, { error: err.message });
        throw err;
      }
    } else if (media.isAvailable()) {
      await media.seek(body.position);
    } else {
      return sendJson(res, 503, { error: "aucun backend média disponible" });
    }

    const apres = state.compose();
    state.publish(apres);
    return sendJson(res, 200, apres);
  }

  if (!media.isAvailable()) {
    return sendJson(res, 503, { error: "aucun backend média disponible" });
  }

  if (MEDIA_ACTIONS.indexOf(body.action) === -1) {
    throw new BadRequest("action attendue : playpause, next, previous ou seek");
  }

  await media.control(body.action);
  const result = state.compose();
  state.publish(result);
  return sendJson(res, 200, result);
}

async function handleFullscreen(req, res) {
  const body = await readBody(req);
  let wanted;

  if (body.toggle === true) {
    wanted = null;
  } else if (typeof body.active === "boolean") {
    wanted = body.active;
  } else {
    throw new BadRequest("corps attendu : { toggle: true } ou { active }");
  }

  /* L'application au premier plan a pu changer depuis le dernier sondage :
     on relit avant d'agir, plutôt que de piloter celle d'il y a deux
     secondes. */
  await fullscreen.refresh();
  if (!fullscreen.isAvailable()) {
    return sendJson(res, 503, { error: "aucune application pilotable au premier plan" });
  }

  try {
    await fullscreen.control(wanted);
  } catch (err) {
    /* Frappe retenue parce que le curseur est dans un champ de saisie : la
       commande n'a pas abouti, mais rien n'est en panne et rien n'a été
       écrit dans la page. */
    if (err.blocked) return sendJson(res, 409, { error: err.message });
    throw err;
  }

  const result = state.compose();
  state.publish(result);
  return sendJson(res, 200, result);
}

async function handleDisplay(req, res) {
  const body = await readBody(req);
  if (display.ACTIONS.indexOf(body.action) === -1) {
    throw new BadRequest("action attendue : sleep ou wake");
  }

  await display.run(body.action);
  return sendJson(res, 200, state.compose());
}

async function handleApi(req, res, url) {
  if (!checkToken(req, url)) {
    return sendJson(res, 401, { error: "token absent ou invalide" });
  }

  try {
    /* Recalculée au besoin : l'empreinte doit refléter le fichier tel
       qu'il est maintenant, pas tel qu'il était au démarrage. */
    state.setVersion(pageVersionnee().valeur);

    if (req.method === "GET" && url.pathname === "/api/state") {
      const base = await audio.read();
      /* Le média et le plein écran sont rafraîchis sans être attendus : une
         lecture qui traîne ne doit jamais retarder l'état du volume, qui est
         l'essentiel. Les caches sont reposés par le sondage deux secondes
         plus tard. */
      media.refresh();
      fullscreen.refresh();
      /* Les adresses n'accompagnent que cette route : les diffuser dans
         chaque trame SSE alourdirait le flux pour une liste qui ne bouge
         qu'au changement de réseau. */
      return sendJson(res, 200, Object.assign({}, state.compose(base), {
        addresses: localAddresses()
      }));
    }
    if (req.method === "GET" && url.pathname === "/api/events") {
      /* État courant sans relecture : le client fait de toute façon un
         GET /api/state à l'affichage, inutile de forker deux fois. */
      return sse.attach(req, res, state.compose());
    }
    if (req.method === "POST" && url.pathname === "/api/volume") {
      return await handleVolume(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/brightness") {
      return await handleBrightness(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/mute") {
      return await handleMute(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/media") {
      return await handleMedia(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/fullscreen") {
      return await handleFullscreen(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/display") {
      return await handleDisplay(req, res);
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

  /* Une semaine de cache : c'est ce qui permet à la télécommande de
     s'ouvrir sans réseau, et donc à l'écran hors connexion de s'afficher au
     lieu d'une page blanche. Les mises à jour ne s'en trouvent pas retardées
     pour autant, le client se rechargeant dès qu'il constate être périmé. */
  const cache = "public, max-age=" + CACHE_STATIQUE;

  /* La page porte son empreinte, substituée à la volée : servie telle
     quelle, elle ne saurait pas se comparer à ce qu'annonce l'API. */
  if (file === PAGE) {
    const page = pageVersionnee();
    if (page.contenu === null) return sendText(res, 404, "introuvable");
    const corps = Buffer.from(page.contenu, "utf8");
    res.writeHead(200, {
      "Content-Type": TYPES[".html"],
      "Content-Length": corps.length,
      "Cache-Control": cache
    });
    return res.end(req.method === "HEAD" ? undefined : corps);
  }

  fs.readFile(file, (err, data) => {
    if (err) return sendText(res, 404, "introuvable");
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file)] || "application/octet-stream",
      "Content-Length": data.length,
      "Cache-Control": cache
    });
    res.end(req.method === "HEAD" ? undefined : data);
  });
}

/* ---------- serveur ---------- */

const server = http.createServer((req, res) => {
  if (!isLocalAddress(req.socket.remoteAddress)) {
    return sendText(res, 403, "hors du réseau local");
  }

  /* Un chemin malformé suffisait à faire tomber le serveur : « // » est lu
     comme le début d'une autorité sans hôte, et new URL lève. */
  let url;
  try {
    url = new URL(req.url, "http://localhost");
  } catch (e) {
    return sendText(res, 400, "requête invalide");
  }

  if (url.pathname === "/api" || url.pathname.startsWith("/api/")) {
    return handleApi(req, res, url);
  }
  return serveStatic(req, res, url);
});

Promise.all([audio.init(), brightness.init(), media.refresh()]).then(() => {
  /* Le plein écran n'est pas lu au démarrage : il dépend de l'application au
     premier plan, que le sondage relèvera dès qu'un client se connectera.
     Le lire ici ne ferait que forker pour une valeur déjà périmée. */
  /* 0.0.0.0 est indispensable pour que l'iPhone joigne le Mac. Le pare-feu
     macOS demandera l'autorisation au premier lancement. */
  server.listen(PORT, "0.0.0.0", () => {
    const host = os.hostname();
    console.log("remote — audio, luminosité, média et écran");
    console.log("  média   " + (media.isAvailable() ? "disponible" : "aucun backend"));
    console.log("  lumière " + (brightness.state.controllable ? "pilotable" : "non pilotable"));
    console.log("  local   http://localhost:" + PORT + "/?t=" + TOKEN);
    console.log("  réseau  http://" + host + ":" + PORT + "/?t=" + TOKEN);
    console.log("  token   " + CONFIG_FILE);
  });
}).catch(err => {
  console.error("impossible de lire l'état audio au démarrage :", err.message);
  process.exit(1);
});
