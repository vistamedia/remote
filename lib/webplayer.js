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

/* Titre de ce qui joue, quand la page le publie.
 *
 * Netflix ne publie rien d'utile ailleurs : ni au système, ni dans le titre
 * de l'onglet — qui vaut « Netflix », sans plus — ni dans une métadonnée, un
 * objet global ou le stockage local. Tout cela a été vérifié sur la page de
 * lecture. Le seul endroit où le nom apparaît est l'incrustation des
 * contrôles : un h2 ou h4 pour l'œuvre, un h3 pour l'épisode.
 *
 * Cette incrustation est retirée du DOM dès que les contrôles se masquent,
 * ce qui arrive au bout de quelques secondes d'inactivité. Le titre n'est
 * donc lisible que par intermittence — d'où le cache par adresse, plus bas.
 *
 * On s'appuie sur le nom du conteneur, « watch-video--evidence-overlay »,
 * et non sur les classes voisines : celles-ci sont générées et changent à
 * chaque déploiement.
 *
 * Les autres sites publient leur titre dans l'onglet. On y coupe le nom du
 * service, que le badge affiche déjà. */
const TITRE_JS =
  "var titre='',episode='';"
  /* Netflix : l'incrustation des contrôles, un h2 ou h4 pour l'œuvre, un h3
     pour l'épisode. */
  + "var zn=document.querySelector('[class*=evidence-overlay]');"
  + "if(zn){"
  + "var oeuvre=zn.querySelector('h2,h4'),ep=zn.querySelector('h3');"
  + "if(oeuvre&&oeuvre.textContent.trim())titre=oeuvre.textContent.trim();"
  + "if(ep&&ep.textContent.trim())episode=ep.textContent.trim();}"
  /* Prime Video : le SDK de son lecteur nomme ses éléments, ce qui vaut
     mieux que les classes voisines, générées. Les deux sont cherchés
     séparément : l'épisode reste souvent en place quand le titre a déjà
     disparu, et les lier faisait perdre les deux. */
  + "var pt=document.querySelector('.atvwebplayersdk-title-text');"
  + "if(!titre&&pt&&pt.textContent.trim())titre=pt.textContent.trim();"
  + "var pe=document.querySelector('.atvwebplayersdk-episode-info');"
  + "if(!episode&&pe&&pe.textContent.trim())episode=pe.textContent.trim();"
  /* Ailleurs, le titre de l'onglet, dont on retire le nom du service. */
  + "if(!titre){"
  + "var onglet=(document.title||'').trim();"
  + "if(onglet&&onglet.toLowerCase()!=='netflix'){"
  + "[' - ',' | ',' · '].forEach(function(sep){"
  + "var i=onglet.lastIndexOf(sep);"
  + "if(i>0)onglet=onglet.slice(0,i);});"
  + "titre=onglet.trim();}}";

/* Sites où écrire « currentTime » casse la lecture.
 *
 * Netflix diffuse par Media Source Extensions : il alimente lui-même un
 * tampon de segments chiffrés et gère sa session DRM. Une position imposée
 * de l'extérieur sort de ce qu'il a préparé, et le lecteur abandonne sur
 * l'erreur M7375 — constaté, la page devant être rechargée pour repartir.
 *
 * Son propre lecteur saurait sauter proprement, mais il n'est pas
 * joignable : « execute javascript » s'exécute dans un monde isolé, qui voit
 * le DOM sans voir les variables de la page. L'objet « netflix » y est donc
 * introuvable.
 *
 * La liste ne nomme que ce qui a été constaté. Ailleurs, l'écriture est
 * permise sans avoir été vérifiée site par site. */
const SEEK_INTERDIT = ["netflix.com"];

function seekPossible(hote) {
  return !SEEK_INTERDIT.some(interdit => hote === interdit || hote.endsWith("." + interdit));
}

/* Renvoie un objet JSON, ou « none » si la page n'a pas de vidéo. */
const READ_JS = "(function(){" + PICK
  + "if(!v)return 'none';"
  + TITRE_JS
  + "var d=isFinite(v.duration)?Math.round(v.duration):0;"
  + "return JSON.stringify({p:Math.round(v.currentTime),d:d,j:v.paused?0:1,"
  + "c:location.pathname,h:location.hostname,t:titre,e:episode});})()";

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
let current = { available: false, position: null, duration: null, playing: null, title: null };
let refreshing = null;

/* Le titre n'est lisible que pendant les quelques secondes où les contrôles
   sont affichés. On le retient donc, associé à l'adresse de la page : Netflix
   change de chemin à chaque épisode, ce qui suffit à savoir quand oublier.
   Sans cela, le nom apparaîtrait puis disparaîtrait au gré des mouvements de
   souris devant le Mac.
 *
 * Plusieurs chemins sont gardés, et non un seul : en passant d'une
 * plateforme à l'autre puis en revenant, une mémoire à une entrée était
 * écrasée entre-temps, et le nom ne revenait qu'à la prochaine apparition
 * des contrôles — donc, en pratique, qu'à la mise en pause. */
const TITRES = new Map();
const TITRES_MAX = 8;

/* Chaque champ se complète séparément : titre et épisode n'apparaissent pas
   toujours en même temps, et ce qu'on sait déjà ne doit pas être effacé par
   une lecture où l'autre manquait. */
function retenirTitre(chemin, titre, episode) {
  if (!chemin || (!titre && !episode)) return;
  const ancien = TITRES.get(chemin) || {};
  /* Réinsertion pour que la Map garde l'ordre d'usage : la plus ancienne
     entrée sort en premier. */
  TITRES.delete(chemin);
  TITRES.set(chemin, {
    titre: titre || ancien.titre || null,
    episode: episode || ancien.episode || null
  });
  if (TITRES.size > TITRES_MAX) TITRES.delete(TITRES.keys().next().value);
}

/* Plateformes reconnues à l'adresse de la page. Plus sûr que la session du
   système, qui rapporte ce qui joue et non ce qui est affiché : les deux
   diffèrent dès qu'un second onglet garde une lecture en pause. */
const HOTES = [
  { hote: "netflix.com", nom: "Netflix" },
  { hote: "primevideo.com", nom: "Prime Video" },
  { hote: "youtube.com", nom: "YouTube" }
];

function sourceDe(hote) {
  const trouve = HOTES.find(h => hote === h.hote || hote.endsWith("." + h.hote));
  return trouve ? trouve.nom : null;
}

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
  current = { available: false, position: null, duration: null, playing: null, title: null, episode: null, source: null, seekable: false };
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

  if (raw === "none") return forget();

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return forget();
  }

  if (!Number.isFinite(Number(data.p))) return forget();

  /* Le titre lu est retenu pour cette page ; à défaut, on ressort celui
     qu'on connaît d'elle. La mémoire étant indexée par chemin, le nom d'un
     épisode ne peut pas déborder sur le suivant. */
  const chemin = String(data.c || "");
  const hote = String(data.h || "");
  const lu = String(data.t || "").trim();
  const epLu = String(data.e || "").trim();

  retenirTitre(chemin, lu, epLu);
  const retenu = TITRES.get(chemin) || {};

  const duration = Number(data.d);

  current = {
    available: true,
    position: Math.max(0, Math.round(Number(data.p))),
    /* Une durée nulle est celle d'un flux en direct : la position reste
       utile, la barre n'a rien à remplir. */
    duration: Number.isFinite(duration) && duration > 0 ? Math.round(duration) : null,
    playing: data.j === 1,
    title: lu || retenu.titre || null,
    /* Numéro et nom de l'épisode, publiés à part : le badge nomme la
       plateforme, le titre nomme l'œuvre, et l'épisode va au sous-titre. */
    episode: epLu || retenu.episode || null,
    source: sourceDe(hote),
    seekable: seekPossible(hote)
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

  /* Dernier garde-fou : mieux vaut une commande refusée qu'une lecture
     interrompue et une page à recharger. */
  if (!current.seekable) {
    const refus = new Error("cette page ne laisse pas déplacer sa lecture");
    refus.blocked = true;
    throw refus;
  }

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
