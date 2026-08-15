/* Winx Remote — Copyright (C) 2026 Emmanuel Danan <emmanuel.danan@gmail.com>
 * Distribué sous licence GNU GPL v3 ou ultérieure. Voir LICENSE.
 */

"use strict";

/* Plein écran de l'application au premier plan.
 *
 * Deux voies, et c'est la machine qui choisit :
 *
 *   1. VLC et QuickTime exposent le plein écran dans leur dictionnaire
 *      AppleScript. On le lit et on l'écrit directement : le bouton connaît
 *      l'état réel, et rien n'est à autoriser au-delà des Apple Events que le
 *      repli média demande déjà.
 *
 *   2. Les navigateurs n'exposent rien. Seule la frappe d'un raccourci par
 *      System Events les atteint, ce qui exige l'autorisation Accessibilité.
 *      Elle n'est pas demandée : on constate si elle est là, et sinon la
 *      commande est simplement annoncée indisponible. Sur le Mac où
 *      l'autorisation a été accordée, Netflix et YouTube fonctionnent ; sur
 *      celui où personne n'a rien réglé, le bouton n'apparaît pas plutôt que
 *      de rester mort.
 *
 * L'application au premier plan est lue par NSWorkspace, qui ne réclame
 * aucune autorisation — contrairement à System Events, dont l'interrogation
 * déclencherait une demande d'accès dès le démarrage. C'est la même
 * précaution que celle prise dans media.js.
 *
 * Tout tient dans un seul osascript : identité de l'application frontale,
 * état de l'autorisation, et état du plein écran quand il est lisible.
 */

const { execFile } = require("node:child_process");

/* Applications pilotables, par identifiant de bundle. « scriptable » désigne
   celles dont le plein écran se lit et s'écrit ; les autres ne se pilotent
   qu'à l'aveugle, par frappe de raccourci. */
const APPS = {
  "org.videolan.vlc":          { name: "VLC", scriptable: true },
  "com.apple.QuickTimePlayerX": { name: "QuickTime Player", scriptable: true },
  "com.google.Chrome":         { name: "Google Chrome", scriptable: false },
  "com.apple.Safari":          { name: "Safari", scriptable: false },
  "org.mozilla.firefox":       { name: "Firefox", scriptable: false }
};

/* Scripts entièrement constants : ni le nom de l'application ni la commande
   ne sont assemblés à partir d'une valeur venant du client. */
const PRELUDE = `ObjC.import("AppKit");
$.NSBundle.bundleWithPath("/System/Library/Frameworks/ApplicationServices.framework").load;
ObjC.bindFunction("AXIsProcessTrusted", ["bool", []]);
function frontmost() {
  var app = $.NSWorkspace.sharedWorkspace.frontmostApplication;
  return app && !app.isNil() ? ObjC.unwrap(app.bundleIdentifier) : "";
}
`;

/* Renvoie « identifiant autorisation état ». L'état vaut 1 ou 0 quand il est
   lisible, « ? » quand l'application ne l'expose pas, « ! » quand elle
   l'expose mais n'a rien à montrer.
 *
 * Ce dernier cas n'est pas théorique : sans média chargé, VLC accepte qu'on
 * écrive son plein écran et ne l'applique pas — mesuré. Le bouton se serait
 * allumé puis serait retombé tout seul au sondage suivant. On exige donc un
 * média présent, en pause y compris, comme QuickTime exige un document. */
const READ = PRELUDE + `function run() {
  var id = frontmost();
  var trusted = $.AXIsProcessTrusted() ? "1" : "0";
  var active = "?";
  try {
    if (id === "org.videolan.vlc") {
      var vlc = Application("VLC");
      var item = vlc.pathOfCurrentItem();
      active = (item === undefined || item === null || String(item) === "")
        ? "!" : (vlc.fullscreenMode() ? "1" : "0");
    } else if (id === "com.apple.QuickTimePlayerX") {
      active = Application("QuickTime Player").documents[0].presenting() ? "1" : "0";
    }
  } catch (e) {
    active = "!";
  }
  return id + " " + trusted + " " + active;
}`;

/* Écrit le plein écran de l'application scriptable au premier plan. La
   valeur attendue est « true » ou « false », en argument séparé. */
const WRITE = PRELUDE + `function run(argv) {
  var wanted = argv[0] === "true";
  var id = frontmost();
  if (id === "org.videolan.vlc") {
    Application("VLC").fullscreenMode = wanted;
    return "0";
  }
  if (id === "com.apple.QuickTimePlayerX") {
    Application("QuickTime Player").documents[0].presenting = wanted;
    return "0";
  }
  return "1";
}`;

/* Bascule à l'aveugle, pour les applications qui n'exposent rien.
 *
 * C'est « f » qui est envoyé, et non Cmd-Ctrl-F : le raccourci système met
 * la fenêtre du navigateur en plein écran, avec l'interface du site tout
 * autour, là où « f » commande le lecteur vidéo lui-même — Netflix, YouTube
 * et Prime Video le reconnaissent tous les trois.
 *
 * Le danger de « f » est qu'il s'écrit dans la page si le curseur se trouve
 * dans un champ de saisie. On interroge donc d'abord l'élément qui a le
 * focus : si c'est un champ de texte, la frappe n'est pas envoyée. Cela
 * n'exige rien de plus que ce que la frappe elle-même réclame déjà, puisque
 * les deux passent par System Events.
 *
 * Renvoie « focus » quand la commande a été retenue, « 0 » sinon. */
const TEXT_ROLES = '["AXTextField","AXTextArea","AXComboBox","AXSearchField"]';

const KEYSTROKE = `function run() {
  var se = Application("System Events");
  var role = "";
  try {
    role = se.applicationProcesses.whose({ frontmost: true })[0].focusedUIElement().role();
  } catch (e) {
    /* Aucun élément focalisé, ou rôle illisible : rien ne peut recevoir de
       texte, la frappe est sans risque. */
    role = "";
  }
  if (${TEXT_ROLES}.indexOf(role) !== -1) return "focus";
  se.keystroke("f");
  return "0";
}`;

let current = { available: false, active: null, app: null };
let refreshing = null;

function jxa(script, args) {
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-l", "JavaScript", "-e", script].concat(args || []),
      { timeout: 5000 }, (err, stdout, stderr) => {
        if (err) return reject(new Error(String(stderr || err.message).trim()));
        resolve(String(stdout).trim());
      });
  });
}

async function readNow() {
  let parts;
  try {
    parts = (await jxa(READ)).split(/\s+/);
  } catch (e) {
    /* Lecture impossible : on n'annonce rien plutôt que d'annoncer à tort. */
    current = { available: false, active: null, app: null };
    return current;
  }

  const app = APPS[parts[0]];
  const trusted = parts[1] === "1";
  const active = parts[2];

  if (!app) {
    current = { available: false, active: null, app: null };
    return current;
  }

  if (app.scriptable) {
    /* « ! » signale une application sans rien à montrer : QuickTime ouvert
       mais sans document. Il n'y a alors pas de plein écran à basculer. */
    current = active === "0" || active === "1"
      ? { available: true, active: active === "1", app: app.name }
      : { available: false, active: null, app: app.name };
    return current;
  }

  /* Navigateur : pilotable seulement si l'Accessibilité a été accordée, et
     l'état reste inconnu — le plein écran d'une vidéo web n'est pas celui de
     la fenêtre, et rien ne l'expose. */
  current = { available: trusted, active: null, app: app.name };
  return current;
}

/* Un seul rafraîchissement en vol à la fois, comme pour le média. */
function refresh() {
  if (!refreshing) {
    refreshing = readNow().finally(() => { refreshing = null; });
  }
  return refreshing;
}

function snapshot() {
  return current;
}

function isAvailable() {
  return current.available;
}

/* Bascule, ou pose une valeur absolue quand l'application la laisse lire.
   « wanted » vaut true, false, ou null pour une simple bascule.
   L'appelant doit avoir rafraîchi juste avant : l'application au premier
   plan a pu changer, et un second fork ici doublerait le coût pour rien. */
async function control(wanted) {
  if (!current.available) throw new Error("aucune application pilotable au premier plan");

  /* Application aveugle : seule la bascule a un sens, faute d'état à
     comparer. */
  if (current.active === null) {
    if (wanted !== null) {
      throw new Error("cette application ne publie pas son état de plein écran");
    }
    if (await jxa(KEYSTROKE) === "focus") {
      const refus = new Error("le curseur est dans un champ de saisie");
      refus.blocked = true;
      throw refus;
    }
    return current;
  }

  const target = wanted === null ? !current.active : wanted;
  const rc = await jxa(WRITE, [target ? "true" : "false"]);
  if (rc !== "0") throw new Error("l'application n'a pas accepté le plein écran");

  /* On relit plutôt que de croire l'écriture. VLC accepte la commande sans
     l'appliquer dès que la lecture en cours n'a pas d'image — un fichier
     audio, ou une playlist vide : le bouton afficherait alors le contraire
     de ce que montre l'écran du Mac. Le refus est immédiat, mesuré, donc une
     seule relecture suffit et le bouton ne clignote pas. */
  await readNow();
  return current;
}

module.exports = { refresh, snapshot, control, isAvailable };
