/* Winx Remote — Copyright (C) 2026 Emmanuel Danan <emmanuel.danan@gmail.com>
 * Distribué sous licence GNU GPL v3 ou ultérieure. Voir LICENSE.
 */

"use strict";

/* Pilotage de l'audio de sortie macOS.
 *
 * Deux règles gouvernent ce fichier :
 *
 *   1. Une seule commande osascript en vol à la fois. Un fork coûte environ
 *      190 ms sur cette machine, et deux écritures concurrentes se
 *      marcheraient dessus.
 *   2. Les demandes qui arrivent pendant l'exécution écrasent une valeur en
 *      attente. On remplace, on n'empile jamais : un glissement de doigt
 *      produit des dizaines de valeurs par seconde et seule la dernière
 *      compte.
 *
 * Aucune valeur venant du client n'est interpolée dans du code AppleScript :
 * elle passe par « on run argv », donc en argument séparé d'execFile.
 */

const { execFile } = require("node:child_process");

/* Écart toléré entre la valeur écrite et la valeur relue. macOS peut
   arrondir en interne ; mesuré à zéro sur cette machine, mais la règle
   protège des sorties audio qui quantifient. */
const TOLERANCE = 3;

/* Nombre d'écarts consécutifs avant de déclarer la sortie non pilotable
   (cas V1 des specs : HDMI, sortie optique, certains DAC). */
const MISMATCH_LIMIT = 2;

/* Le nom du périphérique coûte environ 300 ms à lire : on le met en cache. */
const DEVICE_TTL = 10000;

const READ_SETTINGS = "get volume settings";

const WRITE_VOLUME = `on run argv
set volume output volume (item 1 of argv as integer)
end run`;

const WRITE_MUTED = `on run argv
set volume output muted (item 1 of argv is "true")
end run`;

/* Dernier état connu. Sert de réponse optimiste, et de base à la bascule
   « toggle » du mode muet. */
const state = { volume: 0, muted: false, controllable: true };

let mismatches = 0;

/* Valeurs en attente. Écrasées à chaque nouvelle demande, jamais empilées. */
let pendingVolume = null;
let pendingMuted = null;

/* Requêtes qui attendent la passe en cours. */
let waiters = [];

/* Drain en cours, ou null. */
let running = null;

let deviceName = null;
let deviceReadAt = 0;

function osascript(script, args) {
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script].concat(args || []), { timeout: 5000 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error("osascript a échoué : " + String(stderr || err.message).trim()));
        resolve(String(stdout).trim());
      });
  });
}

/* « output volume:42, input volume:31, alert volume:100, output muted:false »
   Certaines sorties renvoient « missing value » pour output muted : on le lit
   comme « non muet » plutôt que de planter. */
function parseSettings(raw) {
  const volume = /output volume:\s*(\d+)/.exec(raw);
  if (!volume) throw new Error("réponse osascript illisible : " + raw);
  const muted = /output muted:\s*([a-z ]+?)\s*(?:,|$)/i.exec(raw);
  return {
    volume: Number(volume[1]),
    muted: muted ? muted[1].trim().toLowerCase() === "true" : false
  };
}

/* Nom du périphérique de sortie. Lecture lente, donc rafraîchie en arrière-plan
   et jamais dans le chemin d'une commande : une réponse peut sortir avec un
   nom légèrement périmé, elle ne doit pas attendre 300 ms pour lui. */
function refreshDevice() {
  if (Date.now() - deviceReadAt < DEVICE_TTL) return;
  deviceReadAt = Date.now();
  execFile("system_profiler", ["SPAudioDataType", "-json"], { timeout: 10000 }, (err, stdout) => {
    if (err) return;
    try {
      const data = JSON.parse(stdout);
      const items = (data.SPAudioDataType && data.SPAudioDataType[0] && data.SPAudioDataType[0]._items) || [];
      const found = items.find(i => i.coreaudio_default_audio_output_device === "spaudio_yes");
      if (found) deviceName = found._name;
    } catch (e) {
      /* Structure inattendue : on garde la valeur précédente. */
    }
  });
}

/* Partie audio de l'état, sans aucun appel système. Le média est ajouté par
   state.js, qui compose la réponse complète. */
function snapshot() {
  refreshDevice();
  return {
    volume: state.volume,
    muted: state.muted,
    outputDevice: deviceName,
    volumeControllable: state.controllable
  };
}

/* Lecture réelle. Un seul osascript pour le volume et l'état muet. */
async function read() {
  const settings = parseSettings(await osascript(READ_SETTINGS));
  state.volume = settings.volume;
  state.muted = settings.muted;
  return snapshot();
}

/* Détection paresseuse du cas V1 : si la valeur écrite ne se retrouve pas à
   la relecture, plusieurs fois de suite, c'est que la sortie verrouille son
   volume. Le champ repasse à true dès qu'une écriture aboutit — un DAC
   débranché en cours de soirée ne condamne pas le serveur. */
function reconcile(written, actual) {
  if (Math.abs(actual - written) > TOLERANCE) {
    mismatches += 1;
    if (mismatches >= MISMATCH_LIMIT) state.controllable = false;
  } else {
    mismatches = 0;
    state.controllable = true;
  }
}

async function drain() {
  /* Boucle extérieure : la relecture de réconciliation dure environ 190 ms,
     pendant lesquelles une nouvelle demande peut arriver. Sans ce tour de
     plus, elle resterait en attente jusqu'à la commande suivante — et la
     requête HTTP correspondante ne recevrait jamais de réponse. */
  for (;;) {
    let lastWritten = null;

    while (pendingVolume !== null || pendingMuted !== null) {
      const volume = pendingVolume;
      const muted = pendingMuted;
      pendingVolume = null;
      pendingMuted = null;

      /* Les requêtes accumulées jusqu'ici seront servies par cette passe. */
      const served = waiters;
      waiters = [];

      try {
        if (muted !== null) {
          await osascript(WRITE_MUTED, [muted ? "true" : "false"]);
          state.muted = muted;
        }
        if (volume !== null) {
          await osascript(WRITE_VOLUME, [String(volume)]);
          state.volume = volume;
          lastWritten = volume;
          /* macOS lève le mode muet dès qu'on écrit le volume, même à la
             baisse. Constaté à la mesure, absent des specs. */
          state.muted = false;
        }
        const result = snapshot();
        served.forEach(w => w.resolve(result));
      } catch (err) {
        served.forEach(w => w.reject(err));
      }
    }

    /* Plus personne n'attend : on relit une fois pour réconcilier. Relire à
       chaque passe doublerait le coût et diviserait par deux la fluidité du
       glissement. */
    if (lastWritten !== null) {
      try {
        const settings = await read();
        reconcile(lastWritten, settings.volume);
      } catch (e) {
        /* La relecture est un confort : son échec n'invalide pas l'écriture. */
      }
    }

    if (pendingVolume === null && pendingMuted === null) return;
  }
}

function schedule() {
  const waiter = {};
  const promise = new Promise((resolve, reject) => {
    waiter.resolve = resolve;
    waiter.reject = reject;
  });
  waiters.push(waiter);
  if (!running) running = drain().finally(() => { running = null; });
  return promise;
}

/* Volume absolu. La valeur doit avoir été validée et bornée par l'appelant. */
function setVolume(value) {
  pendingVolume = value;
  return schedule();
}

function setMuted(muted) {
  pendingMuted = muted;
  return schedule();
}

/* Vrai tant qu'une commande est en vol. Le sondage s'en sert pour ne pas
   relire au milieu d'une écriture, ce qui renverrait une valeur
   intermédiaire. */
function isBusy() {
  return running !== null;
}

/* Premier état, au démarrage du serveur. */
async function init() {
  await read();
  refreshDevice();
}

module.exports = { init, read, snapshot, setVolume, setMuted, isBusy, state };
