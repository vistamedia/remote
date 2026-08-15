# Winx Remote

Télécommande web pour piloter le volume, la lecture et l'écran d'un Mac depuis un iPhone, sur le réseau local.

Le dépôt s'appelle `remote`, l'application s'appelle **Winx Remote** : c'est ce
nom qui apparaît sous l'icône de l'iPhone, dans la barre de menus du Mac et
dans l'installeur.

**Les specs complètes sont dans `docs/SPECS.md`. Les lire avant toute implémentation.**
Ce fichier ne contient que les règles qui doivent tenir à chaque session.

## Périmètre

Une instance par Mac, pilotée depuis l'iPhone de son propriétaire, sur le réseau
local. Plusieurs Macs du foyer peuvent recevoir l'app : les installations sont
indépendantes et ne se connaissent pas. Pas de cloud, pas de comptes, pas de
serveur central, pas de pilotage d'un Mac par un autre, pas d'accès depuis
l'extérieur. Ne pas généraliser au-delà du besoin décrit.

Ce qui est multiple, c'est le déploiement. L'architecture, elle, reste mono-Mac :
un serveur ne connaît que la machine sur laquelle il tourne.

## Contraintes techniques non négociables

- **Node.js ≥ 18, zéro dépendance npm.** Modules intégrés uniquement (`http`,
  `child_process`, `fs`, `crypto`). Pas de bundler, pas d'étape de build, pas de
  TypeScript. Si une solution semble exiger un paquet, proposer l'alternative en
  modules intégrés avant de suggérer l'installation.
- **SSE, pas WebSocket.** C'est ce qui permet le zéro-dépendance. Ne pas
  réintroduire `ws`.
- **`execFile` avec un tableau d'arguments, jamais `exec`.** Aucune commande
  système construite par concaténation de chaîne. Toute valeur venant du client
  est validée et bornée côté serveur avant l'appel.
- **Coalescing du volume, jamais de file d'attente.** Une seule commande
  `osascript` en vol à la fois ; les demandes qui arrivent pendant l'exécution
  écrasent une variable « valeur en attente ». On remplace, on n'empile pas.
- **Un seul `osascript -e 'get volume settings'`** pour lire volume et état muet
  d'un coup. Ne jamais forker deux fois pour ces deux valeurs.
- **Tolérance de ±3 à la réconciliation du volume.** macOS arrondit en interne :
  envoyer 42 et relire 41 est normal. Sans cette tolérance le curseur sautille.
- **Tolérance de ±1 seulement pour la luminosité.** La relecture y est exacte,
  mesurée sur toute la plage. Ne pas l'aligner sur les ±3 du volume : les crans
  du clavier du Mac valent environ six points et doivent rester visibles.
- **La luminosité passe par JXA, pas par un binaire.** `DisplayServices` est
  chargé et lié depuis JavaScript for Automation, ce qui garde le projet sans
  étape de build. Ne pas proposer `brightness` de Homebrew ni un binaire Swift.
  Framework privé : traiter son absence comme le cas V1, pas comme une panne.
- **L'écran endormi ment sur sa luminosité.** Toujours passer par
  `CGDisplayIsAsleep` avant de publier une valeur, sinon le curseur tombe à
  zéro tout seul et écrase le réglage à retrouver au réveil.
- **Le plein écran est relu après écriture, jamais cru.** Sans image à
  afficher, VLC accepte la commande sans l'appliquer.
- **Ne jamais interroger System Events pour savoir ce qui est au premier plan.**
  `NSWorkspace` le dit sans aucune autorisation. L'Accessibilité est constatée
  par `AXIsProcessTrusted()`, jamais demandée.
- **Le token est vérifié sur toutes les routes `/api/*`, flux SSE compris.**
- **Sondage conditionnel :** la boucle de relecture d'état ne tourne que s'il
  existe au moins un client SSE connecté. Sans client, aucun process forké.

## L'interface vient du design, pas de Claude Code

`public/index.html` implémente le handoff de `design_handoff_winx_remote/`. Le
rôle de Claude Code est de **le brancher sur l'API, pas de le redessiner**.

- Ne pas modifier la palette, la typographie, la mise en page ni les gestes.
- Ne pas extraire le CSS ou le JS dans des fichiers séparés sans le demander.
- Si un choix d'interface semble être un bug, le signaler avant de le corriger.
  Plusieurs comportements sont délibérés : un déplacement de moins de 3 px n'est
  pas un glissement, le glissement pose le volume à la hauteur du doigt plutôt
  que par incréments, monter le volume sort automatiquement du mode muet.
- **Ne jamais afficher une commande qui ne peut pas aboutir.** Le sélecteur de
  source est un indicateur, pas un choix : macOS n'expose qu'une seule session
  de lecture. La barre de progression se masque quand la source ne publie ni
  durée ni position, plutôt que de rester figée à zéro.
- Trois écarts assumés avec le handoff : le pas des boutons est de 5 et non 4,
  valeur validée à l'usage ; la police Outfit est embarquée dans `public/fonts/`
  au lieu d'être chargée depuis Google Fonts, la télécommande devant
  fonctionner sans accès à Internet ; le sélecteur volume/luminosité et le
  bouton de plein écran ne figurent pas au handoff, les deux commandes ayant
  été ajoutées après lui.
- **L'appui sans glissement reste inerte.** C'est la cible la plus facile à
  viser dans le noir, donc la tentation est grande de lui confier la bascule
  volume/luminosité. Ne pas le faire sans demander : l'inertie est délibérée.

## Méthode de travail

- **Un jalon à la fois**, dans l'ordre du §11 des specs. Ne pas anticiper sur le
  suivant. Proposer un plan et attendre l'accord avant d'écrire.
- **Valider le serveur au `curl` avant de toucher à l'interface.** L'interface
  fonctionne déjà en mode démo ; si quelque chose casse après branchement, on
  doit savoir de quel côté.
- **Ne rien installer via Homebrew sans demander.** `nowplaying-cli` est
  optionnel et repose sur une API privée d'Apple.
- Commit à la fin de chaque jalon, messages en français.

## Ce que Claude Code ne peut pas vérifier seul

Le son qui sort des haut-parleurs, l'écran qui s'éteint, le rendu sur l'iPhone.
Pour tout ce qui touche au matériel, produire la commande à lancer et demander
le résultat plutôt que de supposer que ça marche.

## Langue

Interface, messages d'erreur, commentaires de code et commits en français.
Noms de variables et de fonctions en anglais.
