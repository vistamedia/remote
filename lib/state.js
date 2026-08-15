/* Winx Remote — Copyright (C) 2026 Emmanuel Danan <emmanuel.danan@gmail.com>
 * Distribué sous licence GNU GPL v3 ou ultérieure. Voir LICENSE.
 */

"use strict";

/* Composition de l'état complet, relecture périodique et diffusion des
 * changements.
 *
 * Le Mac est la source de vérité : le volume peut bouger depuis son clavier
 * ou depuis une autre application, et les clients doivent suivre.
 *
 * La boucle ne tourne que s'il existe au moins un client connecté. Sans
 * personne pour écouter, aucun process n'est forké : le serveur ne coûte
 * rien quand personne ne regarde.
 */

const audio = require("./audio.js");
const brightness = require("./brightness.js");
const fullscreen = require("./fullscreen.js");
const media = require("./media.js");
const sse = require("./sse.js");

const POLL_INTERVAL = 2000;
const PING_INTERVAL = 25000;

let pollTimer = null;
let pingTimer = null;
let last = null;

/* Assemble les parties audio, luminosité et média. Les trois caches sont lus
   sans appel système : seul le sondage paie le coût des forks. */
function compose(base) {
  const state = base || audio.snapshot();
  Object.assign(state, brightness.snapshot());
  state.media = media.snapshot();
  state.fullscreen = fullscreen.snapshot();
  return state;
}

function differs(a, b) {
  if (!a || !b) return true;
  if (a.volume !== b.volume
    || a.muted !== b.muted
    || a.outputDevice !== b.outputDevice
    || a.volumeControllable !== b.volumeControllable
    || a.brightness !== b.brightness
    || a.brightnessControllable !== b.brightnessControllable) return true;

  const f = a.fullscreen || {};
  const g = b.fullscreen || {};
  if (f.available !== g.available || f.active !== g.active || f.app !== g.app) return true;

  const m = a.media || {};
  const n = b.media || {};
  return m.available !== n.available
    || m.playing !== n.playing
    || m.title !== n.title
    || m.artist !== n.artist
    || m.duration !== n.duration
    || m.elapsed !== n.elapsed
    || m.source !== n.source;
}

/* Diffuse si l'état a bougé. Appelée par le sondage, et après chaque
   commande pour que les autres clients voient le changement sans attendre
   le tour suivant. */
function publish(state) {
  if (!differs(state, last)) return;
  last = state;
  sse.broadcast("state", state);
}

async function poll() {
  /* Une écriture est en vol : relire maintenant renverrait une valeur
     intermédiaire et ferait sautiller l'affichage. On saute le tour. */
  if (audio.isBusy()) return;
  try {
    const base = await audio.read();

    /* La luminosité peut changer depuis les touches du clavier du Mac ou le
       capteur de lumière ambiante : on la relit comme le volume. Son échec
       est isolé, faute de quoi un framework privé disparu emporterait aussi
       la publication de l'audio, qui reste l'essentiel. */
    if (!brightness.isBusy()) {
      try {
        await brightness.read();
      } catch (e) {
        /* Le champ brightnessControllable dira à l'interface de masquer. */
      }
    }

    /* L'application au premier plan change sans prévenir : le bouton de
       plein écran doit apparaître et disparaître avec elle. */
    await fullscreen.refresh();

    await media.refresh();
    publish(compose(base));
  } catch (e) {
    /* Une lecture ratée n'a pas à interrompre la boucle. */
  }
}

function start() {
  if (pollTimer) return;
  pollTimer = setInterval(poll, POLL_INTERVAL);
  pingTimer = setInterval(sse.ping, PING_INTERVAL);
}

function stop() {
  clearInterval(pollTimer);
  clearInterval(pingTimer);
  pollTimer = null;
  pingTimer = null;
}

function isPolling() {
  return pollTimer !== null;
}

module.exports = { compose, publish, start, stop, isPolling };
