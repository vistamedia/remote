#!/usr/bin/env node
/* Images d'écran de lancement pour iOS.
 *
 * Sans « apple-touch-startup-image », iOS affiche un écran blanc le temps que
 * la page se charge — le « background_color » du manifeste ne s'y applique
 * pas. Ce blanc n'annonce aucune panne, mais il ressemble à s'y méprendre à la
 * page blanche d'un cache purgé, et il donne l'impression que rien ne réagit.
 *
 * L'image est donc un aplat de la couleur du splash : elle enchaîne sans
 * marche visible, et un aplat tolère n'importe quelle définition sans qu'on
 * ait à dessiner quoi que ce soit. iOS, lui, exige une correspondance exacte —
 * d'où une image par appareil, et une ligne à ajouter ici pour chaque nouveau
 * venu dans la maison.
 *
 * Zéro dépendance : zlib est intégré, l'encodeur PNG tient dans ce fichier.
 *
 *   node tools/launch-images.js
 */

const zlib = require("zlib");
const fs = require("fs");
const path = require("path");

/* Points logiques × 3 = pixels. Ajouter un appareil ici, puis la balise
   <link> correspondante dans public/index.html. */
const APPAREILS = [
  { nom: "iPhone 15 Pro",     points: [393, 852] },
  { nom: "iPhone 14 Plus",    points: [428, 926] },
  { nom: "iPhone 14 Pro Max", points: [430, 932] }
];

const FOND = [0x15, 0x08, 0x26];   // --indigo-800 #150826, fond du splash
const SORTIE = path.join(__dirname, "..", "public", "icons");

/* ---------- encodeur PNG ---------- */

const TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

function chunk(type, data) {
  const taille = Buffer.alloc(4);
  taille.writeUInt32BE(data.length);
  const corps = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const somme = Buffer.alloc(4);
  somme.writeUInt32BE(crc32(corps));
  return Buffer.concat([taille, corps, somme]);
}

function aplat(largeur, hauteur, [r, v, b]) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(largeur, 0);
  ihdr.writeUInt32BE(hauteur, 4);
  ihdr[8] = 8;    // 8 bits par canal
  ihdr[9] = 2;    // couleurs vraies, sans canal alpha

  /* Une ligne PNG commence par son octet de filtre, ici « aucun ». */
  const ligne = Buffer.alloc(1 + largeur * 3);
  for (let x = 0; x < largeur; x++) {
    ligne[1 + x * 3] = r;
    ligne[2 + x * 3] = v;
    ligne[3 + x * 3] = b;
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(Array(hauteur).fill(ligne)), { level: 9 })),
    chunk("IEND", Buffer.alloc(0))
  ]);
}

/* ---------- écriture ---------- */

for (const { nom, points } of APPAREILS) {
  const largeur = points[0] * 3, hauteur = points[1] * 3;
  const fichier = `launch-${largeur}x${hauteur}.png`;
  fs.writeFileSync(path.join(SORTIE, fichier), aplat(largeur, hauteur, FOND));
  const poids = fs.statSync(path.join(SORTIE, fichier)).size;
  console.log(`${fichier.padEnd(24)} ${String(poids).padStart(6)} octets   ${nom}`);
}
