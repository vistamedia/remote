/* Soft Remote — Copyright (C) 2026 Emmanuel Danan <emmanuel.danan@gmail.com>
 * Distribué sous licence GNU GPL v3 ou ultérieure. Voir LICENSE.
 */

"use strict";

/* Flux d'état vers les clients, en Server-Sent Events.
 *
 * C'est ce choix qui permet le zéro-dépendance : le sens serveur → client
 * passe par SSE, natif dans Safari iOS, et le sens client → serveur par de
 * simples POST. Aucun WebSocket, donc aucun paquet à installer.
 */

const clients = new Set();

/* Appelés quand le premier client arrive et quand le dernier s'en va. C'est
   ce qui permet au sondage de ne jamais tourner sans personne pour écouter. */
let onFirst = function () {};
let onLast = function () {};

function configure(handlers) {
  onFirst = handlers.onFirst;
  onLast = handlers.onLast;
}

function write(res, event, data) {
  res.write("event: " + event + "\n");
  res.write("data: " + JSON.stringify(data) + "\n\n");
}

function attach(req, res, initial) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive"
  });

  /* Pas de temporisation de Nagle : un changement de volume doit partir
     immédiatement, pas attendre d'avoir de quoi remplir un paquet. */
  req.socket.setNoDelay(true);

  res.write(": connecté\n\n");
  write(res, "state", initial);

  clients.add(res);
  if (clients.size === 1) onFirst();

  const detach = function () {
    if (!clients.delete(res)) return;
    if (clients.size === 0) onLast();
  };
  req.on("close", detach);
  req.on("error", detach);
}

function broadcast(event, data) {
  for (const res of Array.from(clients)) {
    try {
      write(res, event, data);
    } catch (e) {
      clients.delete(res);
    }
  }
}

/* Safari iOS ferme les connexions qu'il croit inertes. Un commentaire
   périodique suffit à les maintenir ouvertes, et ne coûte aucun process. */
function ping() {
  for (const res of Array.from(clients)) {
    try {
      res.write(": ping\n\n");
    } catch (e) {
      clients.delete(res);
    }
  }
}

function count() {
  return clients.size;
}

module.exports = { configure, attach, broadcast, ping, count };
