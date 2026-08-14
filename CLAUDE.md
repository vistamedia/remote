# remote

Télécommande web pour piloter le volume, la lecture et l'écran d'un Mac depuis un iPhone, sur le réseau local.

**Les specs complètes sont dans `docs/SPECS.md`. Les lire avant toute implémentation.**
Ce fichier ne contient que les règles qui doivent tenir à chaque session.

## Périmètre

Un seul Mac, un seul iPhone, un seul réseau local. Pas de cloud, pas de comptes,
pas de multi-utilisateur, pas d'accès depuis l'extérieur. Ne pas généraliser
au-delà du besoin décrit.

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
- **Le token est vérifié sur toutes les routes `/api/*`, flux SSE compris.**
- **Sondage conditionnel :** la boucle de relecture d'état ne tourne que s'il
  existe au moins un client SSE connecté. Sans client, aucun process forké.

## L'interface est figée

`public/index.html` est une interface validée après plusieurs itérations de
design. Le rôle de Claude Code est de **la brancher sur l'API, pas de la
redessiner**.

- Ne pas modifier la palette, la typographie, la mise en page ni les gestes.
- Ne pas extraire le CSS ou le JS dans des fichiers séparés sans le demander.
- Le seul changement attendu au départ : passer `MOCK` de `true` à `false`.
- Si un choix d'interface semble être un bug, le signaler avant de le corriger.
  Plusieurs comportements sont délibérés : le premier appui sur un écran atténué
  ne fait que réveiller, un appui de moins de 10 px n'est pas un glissement,
  monter le volume sort automatiquement du mode muet.

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
