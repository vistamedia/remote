/* Winx Remote — Copyright (C) 2026 Emmanuel Danan <emmanuel.danan@gmail.com>
 * Distribué sous licence GNU GPL v3 ou ultérieure. Voir LICENSE.
 */

"use strict";

/* Luminosité de l'écran du Mac.
 *
 * macOS n'offre aucune commande shell pour la luminosité : ni osascript, ni
 * pmset, ni AppleScript. La seule voie sans binaire tiers passe par
 * DisplayServices, un framework privé d'Apple, appelé depuis JavaScript for
 * Automation : le pont ObjC de JXA sait charger un framework et lier une
 * fonction C. Le projet reste donc sans dépendance et sans étape de build,
 * et osascript demeure le seul appel système, comme pour le volume.
 *
 * Framework privé veut dire fragile : une mise à jour majeure de macOS peut
 * le retirer, exactement comme pour nowplaying-cli. L'échec est traité comme
 * le cas V1 de l'audio — on annonce la luminosité non pilotable et
 * l'interface masque la commande, plutôt que de planter ou d'afficher un
 * curseur mort.
 *
 * Mêmes deux règles que audio.js : une seule commande en vol à la fois, et
 * les demandes qui arrivent pendant l'exécution écrasent la valeur en
 * attente. On remplace, on n'empile jamais.
 *
 * Aucune valeur venant du client n'est interpolée dans le script : elle
 * passe par « function run(argv) », donc en argument séparé d'execFile.
 */

const { execFile } = require("node:child_process");

/* Écart toléré entre la valeur écrite et la valeur relue. Bien plus serré
   que les ±3 de l'audio : la relecture est exacte ici — 42 écrit, 42 relu,
   mesuré sur toute la plage — là où macOS quantifie le volume. Une tolérance
   large masquerait les changements venus des touches du clavier, qui
   avancent par crans de 1/16, soit environ 6 points. */
const TOLERANCE = 1;

/* Nombre d'écarts consécutifs avant de déclarer l'écran non pilotable. */
const MISMATCH_LIMIT = 2;

/* Chargement du framework et liaison des fonctions C. CGMainDisplayID et
   CGDisplayIsAsleep sont publiques, les deux autres ne le sont pas. */
const PRELUDE = `ObjC.import("Foundation");
$.NSBundle.bundleWithPath("/System/Library/PrivateFrameworks/DisplayServices.framework").load;
ObjC.bindFunction("CGMainDisplayID", ["unsigned int", []]);
ObjC.bindFunction("CGDisplayIsAsleep", ["int", ["unsigned int"]]);
ObjC.bindFunction("DisplayServicesGetBrightness", ["int", ["unsigned int", "float*"]]);
ObjC.bindFunction("DisplayServicesSetBrightness", ["int", ["unsigned int", "float"]]);
`;

/* Renvoie « code niveau sommeil », par exemple « 0 0.42 0 ». */
const READ = PRELUDE + `function run() {
  var id = $.CGMainDisplayID();
  var out = Ref();
  var rc = $.DisplayServicesGetBrightness(id, out);
  return rc + " " + out[0] + " " + $.CGDisplayIsAsleep(id);
}`;

const WRITE = PRELUDE + `function run(argv) {
  var value = parseFloat(argv[0]);
  if (!(value >= 0 && value <= 1)) return "1";
  return String($.DisplayServicesSetBrightness($.CGMainDisplayID(), value));
}`;

/* Dernier état connu, en pourcentage entier comme le volume. L'écran ne
   pilote que l'affichage principal : le Mac du salon n'a qu'un écran, et
   DisplayServices échoue de toute façon sur la plupart des écrans externes,
   ce que « controllable » signale. */
const state = { value: 0, controllable: true, asleep: false };

let mismatches = 0;

/* Valeur en attente. Écrasée à chaque nouvelle demande, jamais empilée. */
let pendingValue = null;

/* Requêtes qui attendent la passe en cours. */
let waiters = [];

/* Drain en cours, ou null. */
let running = null;

function jxa(script, args) {
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-l", "JavaScript", "-e", script].concat(args || []),
      { timeout: 5000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error("osascript a échoué : " + String(stderr || err.message).trim()));
        resolve(String(stdout).trim());
      });
  });
}

/* Partie luminosité de l'état, sans aucun appel système. */
function snapshot() {
  return {
    brightness: state.value,
    brightnessControllable: state.controllable
  };
}

/* Lecture réelle. Un seul appel donne le niveau et l'état de sommeil. */
async function read() {
  const parts = (await jxa(READ)).split(/\s+/);
  const rc = Number(parts[0]);
  const level = Number(parts[1]);

  /* Framework absent, ou écran qui refuse de rendre sa luminosité. */
  if (rc !== 0 || !Number.isFinite(level)) {
    state.controllable = false;
    return snapshot();
  }

  state.controllable = true;
  state.asleep = parts[2] === "1";

  /* Écran endormi : le niveau rendu ne reflète plus le réglage de
     l'utilisateur, il reflète l'extinction. Le publier ferait tomber le
     curseur à zéro tout seul pendant que l'écran dort, et écraserait la
     valeur à laquelle il faudra revenir au réveil. On garde la dernière
     valeur connue. */
  if (!state.asleep) state.value = Math.round(level * 100);

  return snapshot();
}

/* Même détection paresseuse que pour l'audio : si la valeur écrite ne se
   retrouve pas à la relecture plusieurs fois de suite, l'écran ne se laisse
   pas piloter. Le champ repasse à true dès qu'une écriture aboutit. */
function reconcile(written, actual) {
  if (Math.abs(actual - written) > TOLERANCE) {
    mismatches += 1;
    if (mismatches >= MISMATCH_LIMIT) state.controllable = false;
  } else {
    mismatches = 0;
  }
}

async function drain() {
  /* Boucle extérieure identique à celle de audio.js : la relecture de
     réconciliation laisse le temps à une nouvelle demande d'arriver, et sans
     ce tour de plus sa requête HTTP resterait sans réponse. */
  for (;;) {
    let lastWritten = null;

    while (pendingValue !== null) {
      const value = pendingValue;
      pendingValue = null;

      const served = waiters;
      waiters = [];

      try {
        const rc = Number(await jxa(WRITE, [(value / 100).toFixed(4)]));
        if (rc !== 0) throw new Error("DisplayServices a refusé l'écriture");
        state.value = value;
        lastWritten = value;
        const result = snapshot();
        served.forEach(w => w.resolve(result));
      } catch (err) {
        /* Une écriture refusée signale un écran non pilotable aussi
           sûrement qu'une relecture qui ne concorde pas. */
        mismatches += 1;
        if (mismatches >= MISMATCH_LIMIT) state.controllable = false;
        served.forEach(w => w.reject(err));
      }
    }

    if (lastWritten !== null) {
      try {
        await read();
        reconcile(lastWritten, state.value);
      } catch (e) {
        /* La relecture est un confort : son échec n'invalide pas
           l'écriture. */
      }
    }

    if (pendingValue === null) return;
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

/* Luminosité absolue, de 0 à 100. La valeur doit avoir été validée et bornée
   par l'appelant. Zéro est atteignable : l'écran devient noir sans
   s'éteindre, et se remonte depuis l'iPhone — c'est précisément ce à quoi
   sert la télécommande. */
function setValue(value) {
  pendingValue = value;
  return schedule();
}

function isBusy() {
  return running !== null;
}

/* Premier état, au démarrage du serveur. Contrairement à l'audio, un échec
   n'est pas fatal : la télécommande garde tout son sens sans la luminosité,
   et le champ « controllable » suffit à le dire à l'interface. */
async function init() {
  try {
    await read();
  } catch (e) {
    state.controllable = false;
  }
}

module.exports = { init, read, snapshot, setValue, isBusy, state };
