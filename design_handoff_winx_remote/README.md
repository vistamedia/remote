# Handoff : Winx Remote — icône PWA + interface télécommande

## Overview
Winx Remote est une PWA installée sur l'iPhone qui sert de télécommande pour la lecture Netflix / Prime Video jouée sur un Mac. Ce dossier contient (1) l'icône d'application retenue et ses déclinaisons, (2) la refonte visuelle de l'écran unique de la télécommande, avec toutes ses commandes.

## About the Design Files
Les fichiers `.dc.html` de ce dossier sont des **références de design en HTML** : des prototypes qui montrent l'apparence et le comportement attendus. Ce n'est pas du code de production à copier tel quel. La tâche est de **recréer ces designs dans l'environnement existant de l'app** (React, Vue, Svelte, SwiftUI…) en suivant ses conventions ; si l'app n'a pas encore de socle, choisir le framework adapté (une PWA React/Vite ou du HTML/CSS/JS natif suffit largement ici) et y implémenter les designs.

Les fichiers s'ouvrent directement dans un navigateur. Ils dépendent d'un runtime de prototypage (`support.js`, non fourni) : lisez-les comme de la **documentation source** — le balisage, les valeurs de style et la classe de logique en bas de fichier décrivent exactement l'UI et le comportement.

## Fidelity
**Haute fidélité (hifi).** Couleurs, typographie, espacements et interactions sont définitifs. À recréer au pixel avec les libs du projet.

## Screens / Views

### 1. Écran unique « Télécommande » (`Winx Remote App.dc.html`)
- **Purpose** : régler le volume du Mac, contrôler la lecture, changer de source, éteindre l'écran du Mac.
- **Canvas** : 390 × 844 (iPhone). Colonne flex verticale, fond `#0E0620`. Le cadre arrondi 52 px et l'ombre du prototype ne servent qu'à la présentation : dans l'app, le contenu est plein écran.
- **Layout de haut en bas** :
  1. **Barre d'état** — hauteur 54 px, `padding: 0 30px`, `space-between`. Gauche : heure, 12 px, `#C9B6DE`. Droite : pastille 7 px + libellé 11 px, `letter-spacing .1em`, majuscules. Connecté → `#5CE6B5` ; écran du Mac éteint → `#FFCF5C`.
  2. **En-tête** — `padding: 6px 24px 14px`, flex, `gap: 12px`. Icône ailes 34 px ; titre « Winx Remote » 14 px/600 `#FFF4FA` ; sous-titre 10 px `#9C86B8` (nom du Mac apparié, tronqué en ellipse). À droite, sélecteur segmenté : conteneur `#1B0E30`, `border-radius: 999px`, `padding: 4px`, `gap: 6px` ; chips 11 px/600, `padding: 8px 14px`, `border-radius: 999px`. Actif : fond `#FF2D95`, texte `#150826`. Inactif : fond transparent, texte `#C9B6DE`.
  3. **Zone volume** — `flex: 1`, `position: relative`, `overflow: hidden`, `cursor: ns-resize`, `touch-action: none`. Remplissage ancré en bas, hauteur = `volume %`, `background: linear-gradient(#FF2D95, #8B36E8)`, `transition: height .12s ease-out`. Par-dessus, colonne `space-between`, `padding: 18px 0 22px` :
     - bouton `+` : 56 × 56, rond, 26 px/300, `#D6C9E6`, actif `rgba(255,255,255,.12)` ;
     - nombre de volume : 104 px/800, `line-height .92`, `letter-spacing -.04em`, `#FFF4FA` (sourdine → `#6E5A8A`, valeur affichée 0) ; sous-titre 11 px, `letter-spacing .34em`, majuscules, `#C9B6DE` : « volume » ou « sourdine ». `pointer-events: none` pour ne pas gêner le glissement ;
     - bouton `−` : 56 × 56, rond, 26 px/300, `#F4E9FA`, actif `rgba(0,0,0,.16)`.
  4. **Bloc lecture** — `padding: 20px 26px 26px`, fond `#0B0518`, `gap: 16px` :
     - **progression** : piste 5 px, radius 3, `#2C1A46` ; remplissage `#FF2D95` ; poignée 13 px `#FFF4FA` centrée (`margin-left: -6px`) ; cible tactile 24 px de haut ;
     - **temps** : 10 px `#9C86B8`, écoulé à gauche, restant à droite préfixé `-` ;
     - **titre** 14 px/600 `#FFF4FA` + **sous-titre** 10 px `#9C86B8` (`Source · Saison X, épisode Y`) ;
     - **transport** : rangée `space-between` — précédent, −10, lecture/pause, +10, suivant. Boutons secondaires 52 × 52 ronds `#1B0E30`, actif `#2C1A46`, glyphes `#EDE4F7` / libellés 11 px `#D6C9E6`. Bouton central 76 × 76 rond `#FF2D95`, actif `#D8177A`, glyphe `#150826` 26 px ;
     - **rangée basse** : sourdine 52 × 52 rond (repos `#1B0E30`/`#EDE4F7`, actif `#FFCF5C`/`#150826`) + bouton pleine largeur 52 px, `border-radius: 26px`, bordure 1 px `#3A2350`, texte 11 px `letter-spacing .16em` majuscules `#9C86B8` : « éteindre l'écran du mac ». Écran éteint → bordure et texte `#FFCF5C`, libellé « rallumer l'écran du mac ».
  5. **Voile « écran éteint »** — superposition plein écran `rgba(6,3,14,.94)`, centrée, `gap: 14px` : sur-titre 11 px `letter-spacing .3em` majuscules `#8B6FA8`, titre 22 px/600 `#FFF4FA` « Toucher pour rallumer », note 12 px `#8B6FA8` « La lecture continue ». Tap n'importe où = rallumer.

### 2. Planche d'icônes (`Winx Remote Icons.dc.html`)
Six pistes (1A→1F) plus les mises en situation. **La piste retenue est 1A**. Les autres pistes sont conservées comme archive, à ne pas implémenter.

**Icône 1A — « Envol »** : carré 512, fond `#180B2E`, rayon 114 (squircle iOS). Deux ailes anguleuses miroir (lobe supérieur `#FFB3D9`, éclat intérieur `#FF2D95`, lobe inférieur `#8B36E8`), séparées par un contour de 20 px de la couleur du fond, et un triangle « play » `#FFF4FA` au centre. Géométrie exacte dans `assets/icon-1a.svg` (coordonnées définitives, à ne pas redessiner).

Aucun élément n'est emprunté à la marque Winx Club : formes abstraites originales.

## Interactions & Behavior
- **Volume par glissement** : `pointerdown` sur la zone → `setPointerCapture`, mémoriser `startY`. Sur `pointermove`, si `|clientY − startY| > 3`, `volume = clamp(0..100, round((1 − (clientY − top) / height) × 100))`. `pointerup` termine. Tout réglage de volume lève la sourdine.
- **+ / −** : pas de 4 points, bornes 0–100.
- **Sourdine** : bascule ; conserve la valeur de volume, affiche 0 et le libellé « sourdine ».
- **Lecture / pause** : bascule ; en lecture, le temps écoulé avance de 1 s par seconde, plafonné à la durée.
- **±10 s** : décale l'écoulé, borné à `[0, durée]`.
- **Précédent** : si écoulé > 8 s, retour à 0 ; sinon épisode précédent (file circulaire) à 0. **Suivant** : épisode suivant (circulaire) à 0.
- **Seek** : `pointerdown` sur la barre → `elapsed = clamp01((clientX − left) / width) × durée`.
- **Source** : Netflix / Prime Video ; chaque source a sa propre file, on repart sur son premier titre à 0 s.
- **Écran du Mac** : bascule + voile ; la lecture n'est pas interrompue.
- **Transitions** : uniquement `height .12s ease-out` sur le remplissage de volume. États pressés instantanés (`:active`).
- **Cibles tactiles** : jamais sous 52 px (56 px pour + / −).

## State Management
```
volume: number 0–100          // valeur courante, persistée
muted: boolean                // persistée
playing: boolean              // persistée
elapsed: number (secondes)    // persistée
source: 'netflix' | 'prime'   // persistée
index: number                 // position dans la file de la source, persistée
screenOff: boolean            // état de l'écran du Mac (non persisté côté client)
```
- Persistance : un seul objet JSON en `localStorage`, clé `winx-remote-state`, réécrit à chaque mutation, restauré au montage.
- Timer : intervalle de 1 s qui incrémente `elapsed` quand `playing`, nettoyé au démontage. **Dans l'app réelle, `elapsed`, `playing` et `volume` doivent venir du Mac** (état poussé par l'agent hôte) — le timer local n'est qu'une simulation du prototype ; garder un compteur local uniquement pour lisser entre deux mises à jour.
- Côté transport réel : chaque action envoie une commande au Mac (AppleScript / raccourcis clavier du lecteur, `osascript` pour le volume système, extinction d'écran via `pmset displaysleepnow`) et attend l'état renvoyé, avec correction optimiste immédiate à l'écran.
- Formatage du temps : `m:ss`, et `h:mm:ss` au-delà d'une heure.

## Design Tokens
Couleurs
```
--indigo-900  #0B0518   fond du bloc lecture
--indigo-850  #0E0620   fond de l'app
--indigo-800  #150826   fond du splash
--indigo-750  #180B2E   fond de l'icône
--indigo-700  #1B0E30   surface des boutons
--indigo-600  #2C1A46   surface pressée / piste
--indigo-500  #3A2350   bordures
--fuchsia     #FF2D95   accent principal
--fuchsia-dk  #D8177A   accent pressé
--pink-300    #FFB3D9   aile claire
--violet      #8B36E8   aile basse / bas du dégradé
--violet-300  #C08CFF   accents secondaires
--gold        #FFCF5C   sourdine active, alertes
--mint        #5CE6B5   état connecté
--white       #FFF4FA   texte principal
--lilac-300   #D6C9E6   texte de commande
--lilac-400   #C9B6DE   texte secondaire
--mauve-500   #9C86B8   texte tertiaire
--mauve-700   #6E5A8A   texte désactivé
```
Typographie — **Outfit** (Google Fonts), poids 300 / 400 / 600 / 800.
```
volume        104px / 800 / lh .92 / ls -.04em
titre écran    26px / 800 / ls -.02em
titre média    14px / 600
libellé nav    14px / 600
corps          13–14px / 400 / lh 1.65
méta           10–11px / 400
sur-titre      11px / 600 / majuscules / ls .16–.34em
```
Espacement : 4 / 6 / 8 / 12 / 14 / 16 / 20 / 22 / 24 / 26 / 30 px.
Rayons : 3 (piste) · 26 (bouton large) · 52 (cadre) · 114 (icône 512) · 999 (chips) · 50 % (ronds).
Ombres : aucune dans l'UI ; seul le cadre de présentation en porte une.

## Assets
- `assets/icon-1a.svg` — icône 512 définitive (squircle, rayon 114). Exporter en PNG 192 et 512.
- `assets/icon-1a-maskable.svg` — variante maskable : fond plein bord à bord, symbole à 80 % (zone sûre Android).
- `assets/icon-1a-mono.svg` — variante monochrome fond clair (favicon, impression).
- `assets/manifest.json` — manifeste PWA prêt à l'emploi (couleurs, `display: standalone`, `orientation: portrait`, jeu d'icônes). Ajouter aussi `<link rel="apple-touch-icon" href="/icons/icon-180.png">` (PNG 180 sans transparence).
- Splash screen : fond `#150826`, deux disques concentriques `#2A0F4A` (420 px) et `#3A1560` (260 px), icône 150 px, « Winx Remote » 26 px/800 `#FFF4FA`, sur-titre « LA TÉLÉCOMMANDE MAGIQUE » 11 px `letter-spacing .24em` `#C08CFF`. Voir la section splash de `Winx Remote Icons.dc.html`.
- Police Outfit : `https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;800&display=swap`.

## Files
- `Winx Remote App.dc.html` — écran télécommande, référence complète (balisage + logique en fin de fichier).
- `Winx Remote Icons.dc.html` — planche des 6 pistes, favicon/monochrome, splash, mises en situation.
- `assets/` — icônes SVG et manifeste.
