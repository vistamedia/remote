"use strict";

/* Écran du Mac.
 *
 * Éteindre l'écran n'endort pas la machine et n'interrompt pas la lecture :
 * c'est tout l'intérêt du projet, et c'est ce que vérifie V3 du §2.
 */

const { execFile } = require("node:child_process");

const COMMANDS = {
  sleep: { file: "pmset", args: ["displaysleepnow"], wait: true },
  /* caffeinate -u simule une activité utilisateur, ce qui rallume l'écran.
     -t 1 borne l'effet à une seconde, faute de quoi on empêcherait la veille
     bien au-delà de ce qui est demandé. Le processus vit donc une seconde :
     on ne l'attend pas, sinon la requête traînerait autant. */
  wake: { file: "caffeinate", args: ["-u", "-t", "1"], wait: false }
};

function run(action) {
  const command = COMMANDS[action];
  if (!command) return Promise.reject(new Error("action écran inconnue"));

  return new Promise((resolve, reject) => {
    const child = execFile(command.file, command.args, { timeout: 5000 },
      (err, stdout, stderr) => {
        if (!command.wait) return;
        if (err) return reject(new Error(String(stderr || err.message).trim()));
        resolve();
      });

    if (!command.wait) {
      /* On rend la main tout de suite ; un échec de lancement reste signalé. */
      child.on("error", err => reject(err));
      resolve();
    }
  });
}

module.exports = { run, ACTIONS: Object.keys(COMMANDS) };
