/* Winx Remote — Copyright (C) 2026 Emmanuel Danan <emmanuel.danan@gmail.com>
 * Distribué sous licence GNU GPL v3 ou ultérieure. Voir LICENSE.
 */

"use strict";

/* Position et durée lues dans la balise vidéo de la page.
 *
 * Pourquoi cette voie existe : Netflix ne publie à macOS ni durée, ni
 * position, ni horodatage — vérifié à la source, son dictionnaire
 * MediaRemote ne contient que le titre et le taux de lecture. Prime Video
 * publie la durée seule. Sans position, aucune barre de progression ne peut
 * être juste et aucun saut relatif n'a d'origine.
 *
 * L'élément <video> de la page, lui, sait tout : currentTime, duration, et
 * il accepte qu'on lui écrive sa position. Le saut devient exact et
 * immédiat, là où MediaRemote dépend des commandes que le site déclare —
 * Netflix n'en déclare presque aucune.
 *
 * C'est un complément, jamais un remplacement : quand la page ne répond pas,
 * l'état retombe sur ce que publie le système. Rien n'est à configurer pour
 * que le reste fonctionne.
 *
 * Prérequis, propre à chaque navigateur et à chaque Mac : « Autoriser
 * JavaScript depuis les Apple Events », dans le menu Développement. Il n'est
 * jamais demandé, seulement constaté — un refus vaut « page muette ».
 */

const { execFile } = require("node:child_process");

/* Choix de l'élément : celui qui joue, sinon le plus long de ceux qui ont
   des données. Une page porte souvent plusieurs vidéos — bandes-annonces,
   aperçus au survol, publicités — et la plus longue est la bonne. */
const PICK = "var vs=[].slice.call(document.querySelectorAll('video'));"
  + "var v=vs.filter(function(x){return !x.paused&&x.readyState>0})[0]"
  + "||vs.filter(function(x){return x.readyState>0})"
  + ".sort(function(a,b){return (b.duration||0)-(a.duration||0)})[0];";

/* « position durée lecture », ou « none » si la page n'a pas de vidéo. */
const READ_JS = "(function(){" + PICK
  + "if(!v)return 'none';"
  + "var d=isFinite(v.duration)?Math.round(v.duration):0;"
  + "return [Math.round(v.currentTime),d,v.paused?0:1].join(' ');})()";

/* webkitEnterFullScreen est l'API vidéo native, distincte de l'API
   Fullscreen du document : elle ne réclame pas de geste utilisateur, ce qui
   la rend utilisable depuis une télécommande. */
const FULLSCREEN_JS = "(function(){" + PICK
  + "if(!v)return 'none';"
  + "if(!v.webkitSupportsFullscreen)return 'unsupported';"
  + "if(v.webkitDisplayingFullscreen){v.webkitExitFullScreen();return 'off';}"
  + "v.webkitEnterFullScreen();return 'on';})()";

/* Les deux navigateurs pilotables. Le script est constant ; seule la
   position d'un saut vient de l'extérieur, et elle passe par argv puis par
   une conversion « as number » qui échoue sur tout ce qui n'est pas
   numérique. Aucune valeur du client n'atteint la page sans ce filtre. */
const BROWSERS = {
  "Safari": {
    run: js => `tell application "Safari"
  if (count of documents) is 0 then return "none"
  return (do JavaScript "${js}" in front document) as text
end tell`,
    seek: `on run argv
  set target to (item 1 of argv) as number
  tell application "Safari"
    if (count of documents) is 0 then return "none"
    return (do JavaScript "(function(){${PICK}if(!v)return 'none';v.currentTime=" & target & ";return 'ok';})()" in front document) as text
  end tell
end run`
  },
  "Google Chrome": {
    run: js => `tell application "Google Chrome"
  if (count of windows) is 0 then return "none"
  return (execute front window's active tab javascript "${js}") as text
end tell`,
    seek: `on run argv
  set target to (item 1 of argv) as number
  tell application "Google Chrome"
    if (count of windows) is 0 then return "none"
    return (execute front window's active tab javascript "(function(){${PICK}if(!v)return 'none';v.currentTime=" & target & ";return 'ok';})()") as text
  end tell
end run`
  }
};

/* Dernier état connu. « available » ne vaut vrai que si la page a répondu
   avec une vidéo : c'est lui qui autorise la barre et les sauts. */
let current = { available: false, position: null, duration: null, playing: null };
let refreshing = null;

function applescript(script, args) {
  return new Promise((resolve, reject) => {
    execFile("osascript", ["-e", script].concat(args || []), { timeout: 5000 },
      (err, stdout, stderr) => {
        if (err) return reject(new Error(String(stderr || err.message).trim()));
        resolve(String(stdout).trim());
      });
  });
}

function forget() {
  current = { available: false, position: null, duration: null, playing: null };
  return current;
}

/* « app » est le nom rapporté par fullscreen.js, qui lit l'application au
   premier plan sans réclamer d'autorisation. Interroger un navigateur qui
   n'est pas devant n'aurait aucun sens : l'utilisateur regarde ce qui est
   à l'écran. */
async function readNow(app) {
  const browser = BROWSERS[app];
  if (!browser) return forget();

  let raw;
  try {
    raw = await applescript(browser.run(READ_JS));
  } catch (e) {
    /* Réglage « Autoriser JavaScript depuis les Apple Events » désactivé,
       autorisation refusée, ou navigateur sans fenêtre : la page est muette
       et l'état retombe sur celui du système. */
    return forget();
  }

  const parts = raw.split(/\s+/);
  const position = Number(parts[0]);
  const duration = Number(parts[1]);

  if (raw === "none" || !Number.isFinite(position)) return forget();

  current = {
    available: true,
    position: Math.max(0, Math.round(position)),
    /* Une durée nulle est celle d'un flux en direct : la position reste
       utile, la barre n'a rien à remplir. */
    duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
    playing: parts[2] === "1"
  };
  return current;
}

function refresh(app) {
  if (!refreshing) {
    refreshing = readNow(app).finally(() => { refreshing = null; });
  }
  return refreshing;
}

function snapshot() {
  return current;
}

function isAvailable() {
  return current.available;
}

/* Saut à une position absolue, en secondes. La valeur doit avoir été
   validée et bornée par l'appelant ; la conversion « as number » du script
   la refuse une seconde fois si elle n'est pas numérique. */
async function seek(app, seconds) {
  const browser = BROWSERS[app];
  if (!browser) throw new Error("aucun navigateur pilotable au premier plan");

  const issue = await applescript(browser.seek, [String(Math.round(seconds))]);
  if (issue !== "ok") throw new Error("la page n'a pas accepté le déplacement");

  current = Object.assign({}, current, { position: Math.round(seconds) });
  return current;
}

/* Plein écran de la vidéo elle-même. Renvoie true si la page l'a pris en
   charge, false si l'élément ne le gère pas — à charge pour l'appelant de
   retomber sur la frappe de touche. */
async function toggleFullscreen(app) {
  const browser = BROWSERS[app];
  if (!browser) return false;

  let issue;
  try {
    issue = await applescript(browser.run(FULLSCREEN_JS));
  } catch (e) {
    return false;
  }
  return issue === "on" || issue === "off";
}

module.exports = { refresh, snapshot, isAvailable, seek, toggleFullscreen, BROWSERS };
