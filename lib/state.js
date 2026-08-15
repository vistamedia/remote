/* Soft Remote — Copyright (C) 2026 Emmanuel Danan <emmanuel.danan@gmail.com>
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
const media = require("./media.js");
const sse = require("./sse.js");

const POLL_INTERVAL = 2000;
const PING_INTERVAL = 25000;

let pollTimer = null;
let pingTimer = null;
let last = null;

/* Assemble la partie audio et la partie média. Les deux caches sont lus sans
   appel système : seul le sondage paie le coût des forks. */
function compose(base) {
  const state = base || audio.snapshot();
  state.media = media.snapshot();
  return state;
}

function differs(a, b) {
  if (!a || !b) return true;
  if (a.volume !== b.volume
    || a.muted !== b.muted
    || a.outputDevice !== b.outputDevice
    || a.volumeControllable !== b.volumeControllable) return true;

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
