<p align="center">
  <img src="public/icons/icon-192.png" width="96" height="96" alt="">
</p>

<h1 align="center">Winx Remote</h1>

<p align="center">
  Une télécommande pour son Mac, depuis son iPhone, sur le réseau de la maison.<br>
  Le volume, la lecture, l'écran. Rien d'autre.
</p>

---

Le Mac diffuse un film le soir. On est dans le canapé, ou déjà au lit, et il
faudrait se lever pour baisser le son. Winx Remote met cette commande sur
l'iPhone : on ouvre l'icône, on glisse le pouce, le volume suit.

Tout reste à la maison. Pas de compte, pas de cloud, pas de serveur ailleurs :
le Mac sert lui-même une petite page à l'iPhone, sur le réseau local, et rien
ne sort de chez vous.

## Ce que ça fait

- **Le volume**, en glissant le pouce n'importe où sur l'écran — la surface
  entière est le curseur, on n'a pas à viser. Boutons plus et moins par pas
  de 5, et sourdine.
- **La lecture** : pause, reprise, piste suivante et précédente, avance et
  recul de dix secondes. Ce que la source accepte, voir plus bas.
- **L'écran du Mac**, qu'on éteint sans interrompre le son. C'est le geste qui
  a motivé le projet : le film continue, la pièce redevient sombre.
- **Ce qui joue**, affiché en bas — titre, source, position quand elles sont
  publiées.

L'iPhone suit ce qui se passe sur le Mac : changez le volume au clavier, la
page bouge dans la seconde.

## Ce qu'il vous faut

- **Un Mac** sous macOS récent. Développé et vérifié sur macOS 26, Apple Silicon.
- **Node.js 18 ou plus.** C'est le seul prérequis, et il n'est pas fourni avec
  macOS : [nodejs.org](https://nodejs.org/fr/download), paquet officiel signé
  par Apple, double-clic.
- **Un iPhone** sur le même réseau que le Mac.
- Facultatif : [`nowplaying-cli`](https://github.com/kirtan-shah/nowplaying-cli)
  pour contrôler la lecture d'un navigateur, Netflix ou YouTube compris. Sans
  lui, seules les applications natives répondent — Music, Spotify, VLC.

## Installation

### Avec l'installeur

```bash
git clone https://github.com/vistamedia/remote.git
cd remote
./mac/build.sh
```

La fabrique produit `mac/build/Installer Winx Remote.app` et ouvre le Finder
dessus. Double-cliquez : il installe le serveur, le fait démarrer à chaque
ouverture de session, pose une app de barre de menus et affiche un QR code à
scanner pour poser l'icône sur l'iPhone.

Rien à compiler, aucun outil de développement : `osacompile`, `iconutil` et
`sips` sont livrés avec macOS.

> **Pour installer sur une autre machine, passez par une clé USB.** L'app n'est
> pas signée par un certificat Apple — un abonnement à 99 $ par an — et macOS
> bloque à l'ouverture tout ce qui arrive par mail, AirDrop ou téléchargement.
> Une copie depuis un volume externe ne porte pas cette marque et s'ouvre
> normalement.

### À la main

```bash
node server.js
```

L'adresse à ouvrir, token compris, s'affiche au démarrage. Ajoutez-la à
l'écran d'accueil depuis Safari — Partager, puis « Sur l'écran d'accueil » —
pour l'avoir en plein écran avec son icône.

## Ce que ça ne fait pas

Autant le dire tout de suite, ces limites ne se contournent pas.

**Certaines sorties audio verrouillent leur volume.** En HDMI vers un
téléviseur, sur une sortie optique ou certains DAC, macOS refuse de régler le
niveau et l'application ne peut rien y faire. Vérifiez avant d'installer :

```bash
osascript -e 'set volume output volume 30'
```

Si le son ne bouge pas, ce projet ne vous servira à rien sur ce chemin audio.

**Netflix ne laisse pas changer d'épisode.** Une page web déclare au système
les commandes qu'elle accepte ; Netflix déclare la lecture et la pause, pas le
passage au titre suivant. Les boutons restent sans effet sur ses lectures — y
compris depuis les touches média du clavier, ce qui montre bien que le
problème n'est pas ici. Ils fonctionnent avec Music, Spotify, VLC et YouTube.

**Netflix ne publie pas non plus le nom de ce qu'on regarde**, seulement
« Netflix ». Prime Video, lui, publie le vrai titre. La barre de progression
se masque quand la source ne donne ni durée ni position, plutôt que de rester
figée à zéro.

**Il n'y a pas de sélecteur de source.** macOS ne maintient qu'une seule
session de lecture à la fois et ne permet pas d'en choisir une : on nomme
celle qui joue, on ne la commande pas. Lancez une autre application, elle
prend la main.

**Le réseau local, et rien d'autre.** Pas d'accès depuis l'extérieur, et le
serveur refuse les connexions qui ne viennent pas d'une adresse privée. Si le
Mac s'endort, la télécommande devient injoignable — une lecture en cours suffit
en général à l'en empêcher.

**Une installation par Mac.** Les instances s'ignorent, chacune avec son
adresse et son jeton. Rien ne se synchronise, il n'y a pas d'annuaire.

**Environ 190 ms de latence.** Chaque réglage passe par `osascript`, dont le
démarrage coûte ce prix sur un Mac récent. L'affichage bouge sous le doigt
sans attendre ; c'est le son qui suit avec ce léger retard.

**Ce n'est pas une PWA complète.** En HTTP sur le réseau local, la page n'est
pas en contexte sécurisé : pas de service worker, pas de fonctionnement hors
ligne, et l'écran de l'iPhone s'éteint tout seul. Sans conséquence ici, l'app
étant inutile sans le serveur.

## Comment c'est fait

Un serveur Node.js **sans aucune dépendance npm** : modules intégrés
uniquement. Le flux d'état passe par du SSE plutôt qu'un WebSocket, ce qui
évite d'installer quoi que ce soit, et `EventSource` est natif dans Safari.

```
iPhone ── HTTP + SSE ──> serveur Node ──> osascript, nowplaying-cli, pmset
```

Quelques partis pris qui expliquent le code :

- **Le volume ne fait jamais la queue.** Une seule commande système en vol à
  la fois ; les demandes qui arrivent pendant l'exécution écrasent la valeur
  en attente. Un glissement de deux cents pixels coûte ainsi deux appels, pas
  quarante.
- **Rien ne tourne quand personne ne regarde.** La relecture d'état ne
  démarre qu'à l'arrivée d'un client et s'arrête au départ du dernier :
  aucun processus n'est lancé le reste du temps.
- **Aucune commande morte à l'écran.** Ce que le Mac ne sait pas faire n'est
  pas affiché.

Les spécifications complètes sont dans [`docs/SPECS.md`](docs/SPECS.md), et la
référence de design dans `design_handoff_winx_remote/`.

## Sécurité

Le modèle de menace est modeste : quelqu'un sur le Wi-Fi de la maison qui
couperait le son pour rire. Mais l'API exécute des commandes système, donc :

- un jeton de 32 caractères, généré au premier lancement dans
  `~/.remote/config.json`, vérifié sur toutes les routes et comparé en temps
  constant ;
- les connexions hors du réseau local sont refusées, ce qui évite d'exposer le
  serveur en emportant le portable dans un café ;
- aucune commande n'est construite par concaténation : les valeurs passent en
  arguments séparés, validées et bornées avant tout appel système.

## Licence

GNU GPL v3 — voir [`LICENSE`](LICENSE).

Conçue pour Elisa, par **Emmanuel Danan** — applications mobiles et web,
interfaces, outils sur mesure. Une idée à concrétiser ?
[emmanuel.danan@gmail.com](mailto:emmanuel.danan@gmail.com)
