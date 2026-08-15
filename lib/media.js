/* Soft Remote — Copyright (C) 2026 Emmanuel Danan <emmanuel.danan@gmail.com>
 * Distribué sous licence GNU GPL v3 ou ultérieure. Voir LICENSE.
 */

"use strict";

/* Contrôle de la lecture en cours.
 *
 * Voie principale : nowplaying-cli, qui couvre toute application enregistrée
 * auprès du système, y compris la lecture vidéo dans un navigateur — donc
 * YouTube et Netflix.
 *
 * Repli : AppleScript sur les applications natives, quand nowplaying-cli
 * n'est pas installé. Il ne couvre pas les navigateurs. L'état annonce alors
 * des capacités réduites, à charge pour l'interface de masquer ce qu'elle ne
 * sait pas faire plutôt que d'offrir des boutons morts.
 */

const { execFile } = require("node:child_process");
const fs = require("node:fs");

/* On ne se fie pas au PATH : lancé par un LaunchAgent, le serveur hérite
   d'un environnement minimal où /opt/homebrew/bin est absent. */
const BINARIES = [
  "/opt/homebrew/bin/nowplaying-cli",
  "/usr/local/bin/nowplaying-cli"
];

/* Scripts du repli, entièrement constants : ni le nom de l'application ni la
   commande ne sont assemblés à l'exécution. Les applications sont détectées
   par pgrep, qui ne réclame aucune autorisation — contrairement à System
   Events, qui déclencherait une demande d'accès à chaque démarrage. */
const FALLBACK = {
  Music: {
    playpause: 'tell application "Music" to playpause',
    next: 'tell application "Music" to next track',
    previous: 'tell application "Music" to previous track'
  },
  Spotify: {
    playpause: 'tell application "Spotify" to playpause',
    next: 'tell application "Spotify" to next track',
    previous: 'tell application "Spotify" to previous track'
  },
  VLC: {
    playpause: 'tell application "VLC" to play',
    next: 'tell application "VLC" to next',
    previous: 'tell application "VLC" to previous'
  }
};

const ACTIONS = { playpause: "togglePlayPause", next: "next", previous: "previous" };

/* nowplaying-cli met près d'une seconde à refléter une commande qu'il vient
   lui-même de provoquer — mesuré. Sans cette fenêtre, le sondage
   republierait l'état d'avant et le bouton lecture clignoterait. */
const SETTLE = 1200;

/* Quand aucune application n'est enregistrée auprès du système, le binaire
   attend près de trois secondes avant de rendre un dictionnaire vide —
   mesuré sur macOS 26. On coupe court : une lecture qui traîne signifie
   qu'il n'y a rien à lire. Avec une session active, la réponse arrive en
   une centaine de millisecondes, la marge est donc large. */
const READ_TIMEOUT = 1200;

let binaryPath;
let binaryResolved = false;

let current = { available: false };
let refreshing = null;
let optimisticUntil = 0;
let optimisticPlaying = null;

function binary() {
  if (binaryResolved) return binaryPath;
  binaryResolved = true;
  binaryPath = null;
  for (const candidate of BINARIES) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      binaryPath = candidate;
      break;
    } catch (e) {
      /* Candidat suivant. */
    }
  }
  return binaryPath;
}

function run(file, args, timeout) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: timeout || 5000 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(String(stderr || err.message).trim()));
      resolve(String(stdout).trim());
    });
  });
}

/* Première application pilotable effectivement lancée, ou null. */
function fallbackApp() {
  for (const name of Object.keys(FALLBACK)) {
    try {
      require("node:child_process").execFileSync("pgrep", ["-x", name], { stdio: "ignore" });
      return name;
    } catch (e) {
      /* Application suivante. */
    }
  }
  return null;
}

/* « null » et la chaîne vide signifient tous deux « pas de métadonnée ». */
function clean(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed !== "null" ? trimmed : null;
}

function number(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/* Le titre publié suffit à reconnaître la plateforme : Netflix ne publie que
   son propre nom, Prime Video publie le sien devant le titre réel. On ne
   choisit pas la source — macOS n'expose qu'une session à la fois — on se
   contente de nommer celle qui joue. */
function sourceFrom(data) {
  const haystack = [data.title, data.artist, data.album]
    .filter(v => typeof v === "string").join(" ").toLowerCase();
  if (haystack.indexOf("netflix") !== -1) return "netflix";
  if (haystack.indexOf("prime video") !== -1 || haystack.indexOf("amazon") !== -1) return "prime";
  return null;
}

async function readNow() {
  const bin = binary();

  if (bin) {
    try {
      const raw = await run(bin, ["get", "--json", "title", "artist", "playbackRate", "duration", "elapsedTime"], READ_TIMEOUT);
      const data = JSON.parse(raw);
      const playing = Number(data.playbackRate) > 0;
      current = {
        available: true,
        playing: Date.now() < optimisticUntil ? optimisticPlaying : playing,
        title: clean(data.title),
        artist: clean(data.artist),
        /* La position n'est republiée qu'aux changements d'état : entre deux
           transitions elle est périmée, et c'est au client de la faire
           avancer. La durée, elle, est stable. */
        duration: number(data.duration),
        elapsed: number(data.elapsedTime),
        source: sourceFrom(data)
      };
    } catch (e) {
      /* Délai dépassé ou sortie illisible : le backend reste disponible,
         mais rien ne joue. C'est le cas nominal quand aucune application
         n'est enregistrée auprès du système. */
      current = { available: true, playing: false, title: null, artist: null };
    }
    return current;
  }

  const app = fallbackApp();
  current = app
    ? { available: true, playing: null, title: null, artist: null, backend: app }
    : { available: false };
  return current;
}

/* Un seul rafraîchissement en vol à la fois : les appelants concurrents
   partagent le même, plutôt que d'empiler des lectures qui peuvent coûter
   plus d'une seconde chacune. */
function refresh() {
  if (!refreshing) {
    refreshing = readNow().finally(() => { refreshing = null; });
  }
  return refreshing;
}

function snapshot() {
  return current;
}

/* Vrai si une commande peut aboutir, indépendamment de ce qui joue. */
function isAvailable() {
  return Boolean(binary()) || Boolean(fallbackApp());
}

/* Déplacement à une position absolue, en secondes. Seul nowplaying-cli sait
   le faire : le repli AppleScript ne couvre pas cette commande. Rien ne
   garantit que l'application qui joue l'honore — Netflix, par exemple,
   n'expose pas toutes les commandes au système. */
async function seek(seconds) {
  const bin = binary();
  if (!bin) throw new Error("le déplacement exige nowplaying-cli");
  await run(bin, ["seek", String(Math.round(seconds))]);
  if (current.duration) {
    current = Object.assign({}, current, { elapsed: Math.round(seconds) });
  }
  return current;
}

async function control(action) {
  if (!Object.prototype.hasOwnProperty.call(ACTIONS, action)) {
    throw new Error("action média inconnue");
  }

  const bin = binary();
  if (bin) {
    await run(bin, [ACTIONS[action]]);
  } else {
    const app = fallbackApp();
    if (!app) throw new Error("aucun backend média disponible");
    await run("osascript", ["-e", FALLBACK[app][action]]);
  }

  /* Bascule optimiste : l'état réel mettra environ une seconde à suivre. */
  if (action === "playpause" && current.playing !== null) {
    optimisticPlaying = !current.playing;
    current = Object.assign({}, current, { playing: optimisticPlaying });
    optimisticUntil = Date.now() + SETTLE;
  }

  return current;
}

module.exports = { refresh, snapshot, control, seek, isAvailable };
