# Winx Remote — spécifications

Télécommande web pour piloter le volume, la lecture et l'écran d'un Mac depuis un iPhone, sur le réseau local.

---

## 1. Objectif et cadre

**Le besoin.** Le Mac est posé sur un meuble le soir et diffuse du son. On veut, depuis le lit, régler le volume, couper le son, passer une piste et éteindre l'écran — sans se lever, sans allumer la lumière, et sans avoir à bien viser.

**Ce que ce n'est pas.** Pas une app de contrôle à distance générique (pas de souris, pas de clavier, pas d'écran déporté). Pas d'accès depuis l'extérieur du domicile. Pas de pilotage croisé : une instance ne pilote jamais que le Mac sur lequel elle tourne.

**Plusieurs personnes, plusieurs installations.** L'app est installée séparément sur chaque Mac du foyer, et chacun pilote le sien depuis son propre iPhone. Les instances sont totalement indépendantes : chacune a son token, son nom Bonjour et son URL, et aucune ne connaît l'existence des autres. Ni annuaire, ni serveur central, ni compte. Ce qui doit être multiple, c'est l'installation — pas l'architecture, qui reste strictement mono-Mac.

**Contraintes retenues.**

| Contrainte | Décision |
|---|---|
| Réseau | LAN uniquement, Wi-Fi domestique |
| Client | Safari iOS, ajouté à l'écran d'accueil |
| Latence perçue | < 150 ms entre le geste et le son qui bouge |
| Dépendances Mac | Node.js obligatoire, à installer ; `nowplaying-cli` optionnel |
| Déploiement | Une instance autonome par Mac, sans lien entre elles |
| Utilisation | Une main, dans le noir, sans regarder précisément |

---

## 2. Vérifications préalables (bloquantes)

À faire **avant** d'écrire une ligne de code. Chacune peut invalider une partie du projet.

**À refaire sur chaque Mac qui reçoit l'app.** V1 dépend de la sortie audio et V2 de la version de macOS : un résultat obtenu sur une machine ne dit rien de la suivante. Une installation peut parfaitement fonctionner chez l'un et rester inutilisable chez l'autre, sans que rien ne soit cassé pour autant.

**V1 — le volume système est-il pilotable ?**

```bash
osascript -e 'set volume output volume 30'
```

Le son doit baisser immédiatement. Si rien ne bouge, c'est que la sortie audio (HDMI, optique, DAC USB, certains amplis) verrouille le volume à 100 % côté macOS. Dans ce cas, ce projet ne peut pas piloter ce chemin audio — il faudrait passer par le volume interne de l'application (AppleScript sur Music/Spotify) ou par un pilote type BackgroundMusic. **À tester avec ta configuration du soir, pas avec les haut-parleurs internes.**

**V2 — les touches média fonctionnent-elles ?**

```bash
brew install nowplaying-cli
nowplaying-cli togglePlayPause
```

`nowplaying-cli` s'appuie sur un framework privé d'Apple. <cite index="9-1">Son auteur prévient lui-même que l'usage de frameworks privés peut le casser lors de mises à jour de macOS</cite>, et il a effectivement cessé de fonctionner à partir de macOS 15.4. <cite index="1-1">Le support a depuis été restauré via le projet mediaremote-adapter, intégré à l'outil</cite> — donc installe la version Homebrew récente et vérifie sur ta machine. Si la commande ne fait rien, on retombe sur le plan B décrit en §6.3.

**V3 — l'extinction d'écran laisse-t-elle l'audio tourner ?**

```bash
pmset displaysleepnow
```

L'écran doit s'éteindre sans interrompre la lecture ni endormir la machine. Pas de `sudo` nécessaire.

**V4 — le nom Bonjour du Mac.** Réglages → Général → Partage → nom d'hôte local, de la forme `mon-mac.local`. C'est l'adresse qu'utilisera l'iPhone ; elle évite d'avoir à retenir une IP qui peut changer.

---

## 3. Architecture

```
  iPhone (Safari, écran d'accueil)
        │
        │  HTTP + SSE  ·  http://mon-mac.local:8765/?t=<token>
        ▼
  ┌─────────────────────────────────────────┐
  │  Serveur Node.js (LaunchAgent, au login)│
  │                                         │
  │   /public   fichiers statiques          │
  │   /api      commandes                   │
  │   /events   flux d'état (SSE)           │
  │                                         │
  │   ├── audio    → osascript              │
  │   ├── média    → nowplaying-cli         │
  │   └── écran    → pmset / caffeinate     │
  └─────────────────────────────────────────┘
              macOS
```

**Choix de la stack : Node.js ≥ 18, zéro dépendance npm.**

Node n'est pas fourni avec macOS : il faudra l'installer sur chaque machine, et c'est le seul prérequis du projet. En contrepartie, son module `http` intégré suffit, et `child_process.execFile` couvre tout l'appel système. Surtout : en remplaçant le WebSocket par du **SSE** (Server-Sent Events), on supprime la seule dépendance qui aurait été nécessaire. Le flux serveur → client transporte l'état ; le sens client → serveur passe par de simples `POST`. C'est exactement la forme du besoin, et `EventSource` est natif dans Safari iOS.

Python ferait le travail aussi, mais impose une gestion de venv qui complique le LaunchAgent. Un binaire Swift serait plus rapide et sans dépendance du tout — c'est la bonne cible si tu veux plus tard supprimer le coût des `osascript` (voir §6.1) — mais c'est un cycle d'itération plus lourd pour une v1.

---

## 4. API

Toutes les réponses sont en JSON. Le token est transmis dans l'en-tête `X-Token` (le client le lit une fois depuis `?t=` et le conserve).

### `GET /api/state`

```json
{
  "volume": 42,
  "muted": false,
  "outputDevice": "MacBook Pro Speakers",
  "volumeControllable": true,
  "brightness": 68,
  "brightnessControllable": true,
  "media": {
    "available": true, "playing": true,
    "title": "…", "artist": "…",
    "duration": 3626, "elapsed": 178,
    "source": "netflix"
  },
  "fullscreen": {
    "available": true, "active": false, "app": "VLC"
  }
}
```

`volumeControllable` à `false` signale le cas V1 : l'interface doit alors afficher un état dégradé explicite plutôt qu'un curseur qui ne fait rien.

`brightnessControllable` joue le même rôle pour l'écran, et vaut `false` dès que DisplayServices refuse — écran externe, ou framework retiré par une mise à jour de macOS.

`fullscreen.available` dit si l'application au premier plan se laisse piloter ; `active` vaut `null` quand elle ne publie pas son état, ce qui est le cas des navigateurs.

### `POST /api/volume`

Corps `{ "value": 42 }` (absolu, 0–100) ou `{ "delta": -5 }` (relatif, borné à 0–100).
Réponse : l'état complet. `409` si `volumeControllable` est faux.

### `POST /api/brightness`

Corps `{ "value": 68 }` (absolu, 0–100) ou `{ "delta": -5 }` (relatif, borné à 0–100).
Réponse : l'état complet. `409` si `brightnessControllable` est faux.

Zéro est atteignable : l'écran devient noir sans s'éteindre, et se remonte depuis l'iPhone — c'est précisément ce à quoi sert la télécommande, et les touches du clavier du Mac restent un filet si le serveur tombe.

### `POST /api/mute`

Corps `{ "muted": true }` ou `{ "toggle": true }`.

### `POST /api/media`

Corps `{ "action": "playpause" | "next" | "previous" }`, ou `{ "action": "seek", "position": 178 }` pour une position absolue en secondes.
`503` si aucun backend média n'est disponible.

`duration` et `elapsed` sont nuls quand la source ne les publie pas — c'est le cas de Netflix, qui ne publie ni l'un ni l'autre.

`source` est le **nom affichable** de ce qui joue : « Netflix », « Prime Video », « YouTube » quand le titre publié le trahit, sinon le nom de l'application déduit de `clientBundleIdentifier` — « VLC », « Music », « Spotify », ou le navigateur à défaut. Nul quand rien ne permet de nommer la source, auquel cas l'interface n'affiche aucun badge. On nomme la lecture en cours, on ne la choisit pas.

### `POST /api/fullscreen`

Corps `{ "toggle": true }`, ou `{ "active": true }` quand l'application publie son état.
`503` si aucune application pilotable n'est au premier plan.

La réponse rapporte l'état **relu après écriture**, et non celui qui a été demandé : sans image à afficher, VLC accepte la commande sans l'appliquer. `{ "active": … }` est refusé sur une application qui ne publie pas son état, faute de pouvoir vérifier quoi que ce soit.

### `POST /api/display`

Corps `{ "action": "sleep" | "wake" }`.
`sleep` → `pmset displaysleepnow`. `wake` → `caffeinate -u -t 1`, qui simule une activité utilisateur et rallume l'écran.

### `GET /api/events` (SSE)

Émet un événement `state` à chaque changement, avec le même schéma que `GET /api/state`.

### Codes d'erreur

| Code | Cas |
|---|---|
| 400 | Corps invalide, valeur hors bornes |
| 401 | Token absent ou faux |
| 409 | Sortie audio non pilotable |
| 503 | Backend média indisponible |
| 500 | Échec de la commande système |

---

## 5. État et synchronisation

**Source de vérité : le Mac.** Le volume peut changer depuis le clavier du Mac ou une autre app ; l'iPhone doit suivre.

**Boucle de sondage.** Le serveur relit l'état toutes les 2 s **uniquement s'il existe au moins un client SSE connecté**. Sans client, aucun process n'est forké — le serveur ne coûte rien quand personne ne regarde.

**Trois pièges à traiter explicitement :**

1. **Quantification.** macOS arrondit en interne. Envoyer 42 et relire 41 est normal. La réconciliation doit tolérer un écart de ±3, sinon le curseur sautillera en permanence pendant qu'on le manipule.
2. **Fenêtre de garde.** Après une action locale, le client ignore les événements SSE pendant 600 ms. Sans ça, l'affichage optimiste est écrasé par un état serveur périmé et le curseur recule sous le doigt.
3. **Suspension iOS.** Quand l'écran de l'iPhone s'éteint ou que l'app passe en arrière-plan, Safari gèle la page et le SSE tombe. Il faut : la reconnexion automatique native d'`EventSource`, **plus** un `GET /api/state` forcé sur `visibilitychange` au retour au premier plan.

**Affichage optimiste.** L'interface bouge au doigt, sans attendre la réponse. En cas d'erreur, elle revient à la dernière valeur confirmée et signale la perte de connexion.

---

## 6. Couche système

### 6.1 Audio

| Action | Commande |
|---|---|
| Lire | `osascript -e 'get volume settings'` → `output volume:42, output muted:false, …` |
| Écrire | `osascript -e 'set volume output volume 42'` |
| Muet | `osascript -e 'set volume output muted true'` |
| Périphérique | `system_profiler SPAudioDataType -json` (lent, à mettre en cache) |

Un seul appel `get volume settings` renvoie volume **et** état muet : à parser d'un coup plutôt que de forker deux fois. Attention, certains périphériques renvoient `missing value` pour `output muted` — le parseur doit le supporter sans planter.

**Coalescing, obligatoire.** Chaque `osascript` coûte un fork d'environ 25 ms. Un curseur glissé produit des dizaines d'événements par seconde. Règle : une seule commande en vol à la fois ; les demandes arrivant pendant l'exécution écrasent une variable « valeur en attente », appliquée dès la fin. On ne met jamais en file, on remplace. Côté client, throttle à 80 ms pendant le glissement, plus un envoi final garanti au relâchement.

Si la latence reste gênante, l'optimisation est un petit binaire Swift tapant dans CoreAudio (`kAudioHardwareServiceDeviceProperty_VirtualMainVolume`) : réglage instantané, plus aucun fork. À garder comme évolution, pas comme prérequis.

### 6.2 Écran

| Action | Commande |
|---|---|
| Éteindre | `pmset displaysleepnow` |
| Rallumer | `caffeinate -u -t 1` |

**Luminosité.** macOS ne l'expose ni à `osascript` ni à `pmset` : aucune commande shell ne la règle. La seule voie sans binaire tiers passe par `DisplayServices`, un framework privé d'Apple, appelé depuis **JavaScript for Automation** — le pont ObjC de JXA sait charger un framework et lier une fonction C. Le projet reste donc sans dépendance et sans étape de build, et `osascript` demeure le seul appel système.

| Action | Fonction liée |
|---|---|
| Lire | `DisplayServicesGetBrightness(CGMainDisplayID(), &niveau)` |
| Écrire | `DisplayServicesSetBrightness(CGMainDisplayID(), niveau)` |
| Écran endormi ? | `CGDisplayIsAsleep(CGMainDisplayID())` |

Le niveau est un flottant de 0 à 1, converti en pourcentage entier pour l'API. Un appel coûte environ 80 ms, soit **deux fois moins** que le fork AppleScript du volume. Le coalescing du §6.1 s'applique à l'identique.

Trois points mesurés, à ne pas perdre :

1. **La relecture est exacte** — 42 écrit, 42 relu, sur toute la plage. La tolérance de réconciliation est donc de 1 et non de 3 : les crans du clavier du Mac valent environ six points et doivent rester visibles.
2. **L'écran endormi ment.** Pendant le sommeil, le niveau lu reflète l'extinction et non le réglage. Sans `CGDisplayIsAsleep`, le curseur tomberait à zéro tout seul et écraserait la valeur à retrouver au réveil.
3. **La luminosité automatique bouge seule.** Le capteur de lumière ambiante modifie le niveau sans qu'on le demande ; le sondage le remonte, ce qui est le comportement voulu — le Mac reste la source de vérité.

Framework privé veut dire fragile, exactement comme `nowplaying-cli` : une mise à jour majeure de macOS peut le retirer. L'échec est traité comme le cas V1 de l'audio, en annonçant `brightnessControllable: false`.

### 6.3 Média

Voie principale : `nowplaying-cli togglePlayPause | next | previous`. Elle a l'avantage de couvrir toute application enregistrée auprès du système, y compris la lecture vidéo dans Safari ou Chrome — donc YouTube.

**Plan B si V2 échoue.** Détecter l'application en cours et piloter directement :

```applescript
tell application "Music" to playpause
tell application "Spotify" to next track
```

Couvre Music, Spotify, VLC, QuickTime. Ne couvre pas les navigateurs. L'API renvoie alors `available: true` avec une liste de capacités réduite, et l'interface masque ce qu'elle ne peut pas faire plutôt que d'offrir des boutons morts.

### 6.4 Plein écran

Deux voies, et c'est la machine qui choisit.

| Application | Voie | État lisible |
|---|---|---|
| VLC | `fullscreen mode` | oui |
| QuickTime | `presenting of document 1` | oui |
| Chrome, Safari, Firefox | frappe de `f` par System Events | non |

L'application au premier plan est lue par `NSWorkspace.frontmostApplication`, qui ne réclame **aucune autorisation** — contrairement à System Events, dont l'interrogation déclencherait une demande d'accès dès le démarrage. C'est la même précaution que celle prise pour le repli média du §6.3. Un seul `osascript` rapporte l'identité de l'application, l'état de l'autorisation et le plein écran quand il est lisible.

**Le dégradé.** Les navigateurs n'exposent rien et ne se pilotent que par frappe de raccourci, ce qui exige l'autorisation Accessibilité pour le serveur. Elle n'est jamais demandée : `AXIsProcessTrusted()` constate si elle est là. Sur le Mac où elle a été accordée, Netflix et YouTube fonctionnent ; sur celui où personne n'a rien réglé, le bouton n'apparaît pas plutôt que de rester mort. Rien à configurer pour que le reste marche.

**Le raccourci est `f`, pas `Cmd-Ctrl-F`.** Le raccourci système met la *fenêtre* du navigateur en plein écran, avec l'interface du site tout autour ; `f` commande le *lecteur vidéo* lui-même, et Netflix, YouTube et Prime Video le reconnaissent tous les trois. C'est le plein écran vidéo qui est recherché depuis le lit, pas une grande fenêtre.

Le danger de `f` est qu'il s'écrit dans la page si le curseur se trouve dans un champ de saisie. L'élément qui a le focus est donc interrogé d'abord, et la frappe retenue si son rôle est `AXTextField`, `AXTextArea`, `AXComboBox` ou `AXSearchField`. L'API renvoie alors `409` : rien n'a été écrit, rien n'est en panne, et l'interface laisse le bouton en l'état sans annoncer de perte de connexion. Cette garde ne coûte aucune autorisation supplémentaire, la frappe passant déjà par System Events.

**L'écriture est relue, jamais crue.** Sans image à afficher — fichier audio, ou playlist vide — VLC accepte la commande sans l'appliquer. Le bouton aurait affiché le contraire de l'écran du Mac. Le refus est immédiat, mesuré, donc une seule relecture suffit et rien ne clignote. Même raison pour exiger un média chargé avant d'annoncer la commande disponible.

### 6.5 Position lue dans la page

Netflix ne publie à macOS **ni durée, ni position, ni horodatage** — vérifié à la source : son dictionnaire MediaRemote ne contient que le titre, la pochette et le taux de lecture. Prime Video publie la durée seule. Sans position, aucune barre n'est juste, et un saut relatif n'a pas d'origine.

L'élément `<video>` de la page, lui, sait tout. `lib/webplayer.js` l'interroge par `do JavaScript` :

| Action | Expression |
|---|---|
| Lire | `v.currentTime`, `v.duration`, `v.paused` |
| Déplacer | `v.currentTime = n` |
| Plein écran | `v.webkitEnterFullScreen()` |
| Nommer | l'incrustation des contrôles, à défaut le titre de l'onglet |

**Le nom de ce qui joue.** Netflix ne le publie nulle part ailleurs : ni au système, ni dans le titre de l'onglet — qui vaut « Netflix », sans plus — ni dans une métadonnée, un objet global ou le stockage local. Tout cela a été vérifié sur la page de lecture. Le seul endroit où il apparaît est l'incrustation des contrôles : un `h2` ou `h4` pour l'œuvre, un `h3` pour l'épisode, dans un conteneur `watch-video--evidence-overlay`. On s'appuie sur ce nom de conteneur et non sur les classes voisines, générées et renouvelées à chaque déploiement.

Cette incrustation **disparaît du DOM** dès que les contrôles se masquent. Le titre n'est donc lisible que par intermittence, et il est retenu, associé au chemin de la page : Netflix change de chemin à chaque épisode, ce qui suffit à savoir quand l'oublier. Sans cette mémoire, le nom apparaîtrait et s'effacerait au gré des mouvements de souris devant le Mac.

**Plusieurs chemins sont gardés**, huit au plus, et non un seul : en passant d'une plateforme à l'autre puis en revenant, une mémoire à une entrée était écrasée entre-temps, et le nom ne revenait qu'à la prochaine apparition des contrôles — donc, en pratique, qu'à la mise en pause. Un redémarrage du serveur vide cette mémoire : le titre ne revient alors qu'au prochain affichage des contrôles.

**Prime Video nomme ses éléments.** Le SDK de son lecteur expose `atvwebplayersdk-title-text` pour l'œuvre et `atvwebplayersdk-episode-info` pour l'épisode — des noms sémantiques, là encore préférables aux classes voisines, générées. Les deux sont cherchés **séparément** : l'épisode reste souvent en place quand le titre a déjà disparu, et les lier faisait perdre les deux. La mémoire complète donc chaque champ indépendamment, plutôt que d'écraser ce qu'elle sait par une lecture partielle.

**Le titre, l'épisode et la plateforme sont trois choses distinctes.** Le badge nomme la plateforme, le titre l'œuvre, le sous-titre l'épisode — ou l'artiste, pour de la musique. Le préfixe de plateforme est retiré du titre quelle que soit sa provenance : Prime Video préfixe le sien jusque dans le titre de l'onglet, et le répéter sous un badge qui l'affiche déjà n'apprend rien.

**La source est déduite de l'adresse de la page**, et non de la session du système. Celle-ci rapporte ce qui *joue*, pas ce qui est *affiché* : les deux diffèrent dès qu'un second onglet garde une lecture en pause, et le badge annonçait alors une plateforme pendant qu'on en regardait une autre. Le titre du système ne l'emporte que s'il nomme autre chose que sa propre plateforme, celle d'avant comprise.

Le titre de la page ne s'impose que là où le système n'en donne pas de vrai — reconnaissable au fait qu'il est identique au nom de la source. Prime Video, qui publie un titre complet, garde la main.

L'élément retenu est celui qui joue, sinon le plus long de ceux qui ont des données : une page porte souvent plusieurs vidéos — aperçus au survol, bandes-annonces, publicités.

`webkitEnterFullScreen` est l'API vidéo native, distincte de l'API Fullscreen du document : elle ne réclame **pas de geste utilisateur**, ce qui la rend utilisable depuis une télécommande, et elle vise la vidéo plutôt que la fenêtre. Le plein écran l'essaie donc avant la frappe de touche du §6.4.

**Netflix refuse qu'on lui impose une position.** Il diffuse par Media Source Extensions : il alimente lui-même un tampon de segments chiffrés et gère sa session DRM. Écrire `currentTime` sort de ce qu'il a préparé, et le lecteur abandonne sur l'erreur **M7375** — constaté, la page doit être rechargée pour repartir, ce qui est bien pire que de ne pas savoir sauter.

Son propre lecteur saurait le faire, mais il n'est pas joignable : `execute javascript` s'exécute dans un **monde isolé**, qui voit le DOM sans voir les variables de la page. L'objet `netflix` y est donc introuvable, et avec lui toute l'API du lecteur.

Le module publie en conséquence un champ `seekable`, faux sur les hôtes où l'écriture a été vue casser la lecture. L'API refuse alors le déplacement par un `409`, et l'interface masque les deux sauts de dix secondes et la poignée de la barre — la barre elle-même reste affichée, car informer de la position garde tout son sens quand on ne peut pas la changer. La liste ne nomme que ce qui a été constaté : ailleurs, l'écriture est permise sans avoir été vérifiée site par site.

**C'est un complément, jamais un remplacement.** Quand la page ne répond pas, l'état retombe sur celui du système. La page ne fournit que la position et la durée : `playing` reste à `media.js`, qui porte la bascule optimiste du bouton de lecture — l'écraser le ferait clignoter à chaque sondage.

**Firefox est hors de portée.** Il n'expose rien à AppleScript, ni `do JavaScript` ni son équivalent. Sur Netflix dans Firefox, la barre et les sauts restent masqués quel que soit le réglage. Seuls Safari et Chrome répondent, et seulement après activation manuelle (§10).

---

## 7. Interface

### 7.1 Le principe directeur

L'utilisateur est allongé, dans le noir, à moitié endormi, tenant le téléphone d'une main. Il ne visera pas juste. **La cible, c'est donc l'écran entier** : un glissement vertical n'importe où sur la page règle le volume. Il n'y a pas de curseur fin à attraper. Le remplissage de l'écran *est* le curseur.

Le glissement pose le volume à la hauteur du doigt, il ne l'incrémente pas : la zone entière est un curseur absolu. Un déplacement de moins de 3 px n'est pas un glissement, ce qui évite qu'un simple appui ne déplace le son.

### 7.2 Direction visuelle

**Le design fait l'objet d'un handoff dédié**, `design_handoff_winx_remote/`, qui fait foi sur les couleurs, la typographie, les espacements et les gestes. Cette section n'en donne que la substance.

Fond indigo profond, accent fuchsia virant au violet sur le remplissage du volume. La palette a été retenue pour une utilisatrice précise plutôt que pour l'usage nocturne : elle est plus lumineuse et plus saturée que la direction ambrée d'origine, qui visait à ne pas éclairer une chambre.

```
--indigo-850  #0E0620   fond de l'app
--indigo-900  #0B0518   fond du bloc lecture
--indigo-700  #1B0E30   surface des boutons
--fuchsia     #FF2D95   accent principal, haut du remplissage
--violet      #8B36E8   bas du remplissage
--gold        #FFCF5C   sourdine active, écran éteint
--mint        #5CE6B5   état connecté
--white       #FFF4FA   texte principal
--mauve-500   #9C86B8   texte tertiaire
```

**Typographie.** Outfit, en woff2 variable, **servie par le serveur et non par un CDN** : la télécommande doit fonctionner sur le réseau local sans accès à Internet. Le nombre du volume est posé en 104 px / 800, en `tabular-nums` pour qu'il ne tressaute pas en changeant de chiffre.

**Pas d'auto-atténuation.** L'écran ne s'estompe plus après quelques secondes : le handoff ne retient qu'une seule transition, celle du remplissage de volume.

### 7.3 Structure

```
┌──────────────────────┐
│  [🔈|☀]         ● ⬤  │   grandeur réglée, état de connexion
│  ⋀ Winx Remote (Netflix)│ icône, nom du Mac, badge de source
│                      │
│          +           │
│         75           │   nombre, très grand, centré
│       VOLUME         │   remplissage fuchsia → violet depuis le bas
│          −           │
├──────────────────────┤
│  ▬▬▬▬▬▬●▭▭▭▭▭▭▭▭▭▭   │   progression, masquée si non publiée
│  Titre · Source      │
│  ⏮  −10  ⏯  +10  ⏭   │   transport, cibles ≥ 52 px
│  🔇  éteindre l'écran ⛶│  plein écran masqué si indisponible
└──────────────────────┘
```

État muet : le nombre affiche 0 en `--mauve-700`, le libellé passe à « sourdine », le bouton devient doré. La valeur réelle du volume est conservée et revient dès qu'on lève la sourdine.

**Volume ou luminosité.** Le grand curseur règle l'un ou l'autre, et un sélecteur en haut à gauche choisit lequel. Le geste, les boutons `+` et `−` et le throttle sont partagés : seule la destination change. Le remplissage vire à l'or en mode luminosité, déjà la couleur de l'écran dans la palette, pour que les deux modes se distinguent sans lire le libellé — l'or étant clair là où le fuchsia et le violet sont sombres, les signes `+` et `−` reçoivent un disque translucide qui les en détache.

Le sélecteur est en icônes seules, délibérément distinct du sélecteur de source : l'un est un vrai choix, l'autre un simple indicateur, et deux composants de même forme aux comportements différents se seraient contredits. Il disparaît quand la luminosité n'est pas pilotable, le curseur revenant alors au volume.

L'appui sans glissement reste inerte, comme prévu au §7.1 : il n'a pas été détourné pour basculer de grandeur, bien qu'il soit la cible la plus facile à viser dans le noir.

### 7.4 Écran hors connexion

Variante **2A « Complice »** du handoff. Une fée a raté son sort ; le bouton relance l'incantation, échoue, et sert une réplique différente à chaque essai, jusqu'à ce qu'elle renonce et aille se faire un chocolat chaud.

**Il ne peut pas venir d'un service worker**, contrairement à ce que prescrit le handoff : la page n'est pas en contexte sécurisé sur le LAN en HTTP (§8). Il est donc posé en superposition dans `index.html`. La différence est réelle et il faut la connaître : l'écran couvre le cas qui compte — le Mac qui ne répond plus, le Wi-Fi qui tombe pendant l'usage, l'app relancée hors du réseau — mais pas celui d'une page qui n'a pas pu se charger du tout. Le cache d'une semaine (§8) bouche ce trou la plupart du temps ; quand iOS a purgé le sien, le navigateur garde la main et affiche sa propre erreur, soit une page blanche en plein écran.

- **Reconnaître la coupure d'abord.** Il y a deux façons d'être hors réseau et elles ne se ressemblent pas. En mode avion, iOS rejette la requête sur-le-champ. Le Wi-Fi coupé mais les données cellulaires actives, la route existe toujours et le paquet part vers un Mac qui n'est pas là : la requête reste alors en vol jusqu'au délai TCP du système, une bonne minute pendant laquelle **rien n'échoue** — donc rien ne signale la coupure, et la télécommande s'affiche en se croyant connectée. Tous les appels sont donc bornés à **2,5 s** par un `AbortController`, le serveur répondant en 190 ms. Le POST compte autant que la lecture d'état : une commande en vol indéfini laisse l'affichage optimiste mentir aussi longtemps.
- **Délai de grâce de 3 s** avant de couvrir l'écran, mais **seulement après une première connexion réussie**. Le flux SSE hoquette à chaque bascule de réseau et se rétablit seul ; recouvrir l'interface à chaque hoquet serait insupportable. Un démarrage qui n'aboutit pas, lui, n'a aucun état à préserver : l'attente n'y ajouterait que trois secondes de télécommande trompeuse. Cette branche rejoint donc celle du jeton refusé, qui court-circuitait déjà le délai pour la même raison.
- **Le témoin de la barre du haut naît « hors ligne »** et ne devient « connecté » qu'une fois le Mac joint. Il réagit avant l'écran de la fée — il est discret, c'est son rôle — mais il n'affirme plus avant de savoir.
- **La tentative est un vrai appel** au Mac, pas une animation de complaisance : succès, on revient à la télécommande et le flux est rouvert ; échec, réplique suivante. Le plancher de 1600 ms n'est pas une temporisation feinte — sans lui, un échec instantané rendrait l'incantation illisible.
- **Rien n'est conservé** : on repart de la première réplique dès que l'écran a disparu, comme le demande le handoff.
- `window.addEventListener("online")` relance une tentative sans qu'on ait à appuyer.
- **Adaptation aux écrans courts.** Le handoff dessine sur un canvas de 844 px ; en dessous de 760 px de haut, la fée et les textes sont réduits, faute de quoi ils passeraient sous le bouton. Au-dessus, les valeurs du handoff s'appliquent telles quelles — la fée y fait ses 311 px exacts.

### 7.5 Détails techniques d'interface

- `touch-action: none` sur la zone de glissement, sinon Safari déclenche le pull-to-refresh et le rebond de scroll.
- `user-select: none` et `-webkit-touch-callout: none` : pas de loupe de sélection sur appui long.
- `viewport-fit=cover` et `env(safe-area-inset-*)` : la barre de transport doit rester au-dessus de l'indicateur d'accueil.
- Pas de retour haptique : `navigator.vibrate` n'existe pas sur Safari iOS.
- La capture de pointeur est défensive : elle échoue sur certains pointeurs sans que le glissement doive s'interrompre.
- **Aucune commande morte à l'écran.** Le nom de la source est un badge et non un sélecteur, macOS n'exposant qu'une session de lecture à la fois. La barre de progression et les deux sauts de dix secondes disparaissent quand la source ne publie pas sa position : un saut relatif sans origine renverrait le film à son début.

---

## 8. Installation sur l'iPhone

Ajout via Safari → Partager → « Sur l'écran d'accueil ». L'URL enregistrée contient le token, qui n'est donc à saisir qu'une fois.

**Requis :**
- `<meta name="apple-mobile-web-app-capable" content="yes">` — supprime la barre Safari.
- `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`
- `apple-touch-icon` en 180 × 180, sinon iOS génère une capture d'écran comme icône.
- Un `manifest.webmanifest` malgré tout, pour la cohérence et l'avenir.

**Le manifeste ne doit pas déclarer `start_url`.** Depuis iOS 16.4, Safari l'honore à l'ajout à l'écran d'accueil : une valeur en dur ouvre la racine **sans le `?t=` du QR code**. Et comme le stockage local d'une app en mode standalone est cloisonné, le jeton mémorisé lors de la visite dans Safari n'y est pas non plus. L'icône s'ouvre alors sur une page qui se charge normalement mais dont chaque appel d'API est refusé — symptôme trompeur s'il en est : tout marche dans Safari, rien depuis l'écran d'accueil. Sans `start_url`, la spécification impose d'utiliser l'URL du document, celle du QR code, jeton compris.

Le client sait distinguer ce cas d'une panne de réseau : un `401`, ou un jeton jamais reçu, affiche « Il manque la formule » et invite à rescanner, au lieu de renvoyer l'utilisateur vers son routeur. Le bouton de reconnexion disparaît alors, puisque réessayer ne peut rien donner.

**Ce qui ne marchera pas, et c'est assumé.** En HTTP sur le LAN, la page n'est pas en contexte sécurisé. Donc : pas de service worker (l'écran hors connexion du §7.4 ne peut être qu'une superposition, jamais une page servie en réponse d'échec de navigation) et pas de Wake Lock (l'écran de l'iPhone s'éteindra tout seul).

Ce n'est pas une opinion mais une règle appliquée par le navigateur, et elle se constate : depuis `http://localhost:8765`, `window.isSecureContext` vaut `true` et `navigator.serviceWorker` existe ; depuis `http://172.20.10.7:8765`, les deux valent respectivement `false` et `undefined`. L'objet n'est pas seulement inopérant, il est absent — aucun réglage serveur ne peut le faire apparaître.

**S'ouvrir sans réseau, malgré tout.** Sans mise en cache, la télécommande ne démarre pas du tout hors connexion : le navigateur exige de revalider la page, la revalidation échoue, et l'écran hors connexion lui-même ne peut pas s'afficher — l'iPhone reste sur une page blanche. Les fichiers statiques sont donc servis avec `Cache-Control: public, max-age=604800`, une semaine.

Ce cache figerait l'interface sur l'iPhone. Le serveur publie donc une **empreinte** de `index.html` — huit caractères de son SHA-1 — qu'il substitue au marqueur `__VERSION__` en servant la page, et qu'il annonce dans `GET /api/state`. La page compare la sienne à celle-ci et se remplace quand elles diffèrent, en ajoutant `&v=<empreinte>` à son adresse : rechargée telle quelle, elle reviendrait du cache. Un marqueur de session interdit plus d'un rechargement par empreinte, faute de quoi une discordance permanente ferait tourner la page en boucle.

L'empreinte est recalculée dès que la date du fichier change : modifier l'interface n'oblige pas à redémarrer le serveur. Deux limites demeurent : la première ouverture doit avoir eu lieu en ligne, et une interface inutilisée pendant plus d'une semaine devra être rechargée une fois avec le réseau. Ce n'est pas gênant ici — l'app est inutile sans le serveur de toute façon, et on rallume l'iPhone d'un appui. Ce n'est donc pas une PWA au sens strict, mais une page web en plein écran avec une icône. La différence est invisible à l'usage.

**Pourquoi on s'en tient là.** La vraie PWA suppose un contexte sécurisé, donc un certificat : `mkcert` avec son autorité installée sur l'iPhone, ou `tailscale serve` qui en fournit un valide. La première voie a été examinée puis écartée, et pour une raison pratique plutôt que doctrinale : un certificat couvre nommément les adresses qu'on y inscrit, et il n'existe aucun joker pour une adresse IP. Or l'adresse change d'un réseau à l'autre — 192.168.x à la maison, 172.20.10.x en partage de connexion — ce qui imposerait de réémettre le certificat et de réinstaller le profil sur l'iPhone à chaque fois. Le nom Bonjour y échapperait, mais c'est justement en partage de connexion qu'il ne résout pas. Reste à peser le gain : hors réseau la télécommande ne commande rien, et le service worker ne garantirait que l'affichage d'un écran d'excuse. Prix sans rapport. `tailscale serve` demeure ouvert, mais il change le cadre du projet en ouvrant l'accès depuis l'extérieur.

---

## 9. Sécurité

Le modèle de menace est modeste : quelqu'un sur le Wi-Fi domestique qui couperait le son pour rire. Mais l'API exécute des commandes système, donc pas de porte ouverte.

- Token de 32 caractères hexadécimaux, généré au premier lancement, stocké dans `~/.remote/config.json` (permissions `600`).
- Vérifié sur **toutes** les routes `/api/*`, y compris le flux SSE.
- Écoute sur `0.0.0.0:8765` — indispensable pour que l'iPhone joigne le Mac. Le pare-feu macOS demandera l'autorisation au premier lancement.
- Aucune commande construite par concaténation de chaîne : `execFile` avec un tableau d'arguments, jamais `exec` avec un shell.
- Les valeurs numériques sont validées et bornées côté serveur avant tout appel système, sans faire confiance au client.
- Aucun journal des requêtes au-delà des erreurs.

---

## 10. Exploitation

**Démarrage automatique.** LaunchAgent dans `~/Library/LaunchAgents/local.remote.plist`, avec `RunAtLoad`, `KeepAlive`, et les sorties redirigées vers `~/Library/Logs/remote.log`. Chargement :

```bash
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/local.remote.plist
```

**La veille du Mac.** Point à ne pas négliger : si le Mac s'endort, le serveur devient injoignable et la télécommande est morte. En pratique, une lecture audio en cours empêche la veille système, donc le cas nominal fonctionne. Mais si la musique est en pause et que le Mac s'endort, l'iPhone ne pourra plus rien faire — y compris relancer la lecture. Deux options : régler « empêcher la veille automatique lorsque l'écran est éteint » sur secteur, ou accepter la limite. À trancher à l'usage plutôt qu'à l'avance.

**Les autorisations ne sont jamais demandées, seulement constatées.** C'est une règle du projet : sur le Mac de quelqu'un qui n'a rien installé lui-même, aucun dialogue incompréhensible ne doit surgir au démarrage. `AXIsProcessTrusted()` constate l'Accessibilité sans la réclamer ; `NSWorkspace` donne l'application au premier plan sans rien exiger du tout. La contrepartie est qu'aucune invite ne rappelle à l'utilisateur ce qui manque — d'où l'écran **« Autorisations et réglages »** de l'app de barre de menus, qui énonce les deux réglages facultatifs, affiche l'état du serveur et de la luminosité, et ouvre le panneau d'Accessibilité en révélant le programme à y ajouter.

| Commande | Réglage | Sans lui |
|---|---|---|
| Volume, sourdine, écran, luminosité | aucun | — |
| Transport et position sur VLC, QuickTime, Music, Spotify | aucun | — |
| Plein écran sur VLC et QuickTime | aucun | — |
| Plein écran dans un navigateur | Accessibilité pour le programme du LaunchAgent | bouton masqué |
| Barre, sauts et titre sur Netflix, Prime Video, YouTube | « Autoriser JavaScript depuis les Apple Events » (Safari, Chrome) | barre, sauts et nom du film masqués |

Le réglage se trouve dans Safari sous Réglages → Avancé puis menu Développement, et dans Chrome sous **Présentation → Développeur**, tout en bas. Le message d'erreur de Chrome désigne un menu « Affichage » qui n'existe pas dans sa version française : c'est « Présentation ».

Le programme à autoriser est celui que lance le LaunchAgent — `node`, et non l'app de barre de menus : c'est son processus qui parle au système. Le menu en donne le chemin exact, lu dans le plist.

**Installer sur une machine qu'on ne connaît pas.** Chaque Mac reçoit sa propre installation, et la personne qui s'en sert ne doit rien avoir à configurer. `install.sh` prend donc tout en charge : vérifier que Node est présent et s'arrêter avec un message clair sinon, générer le token, écrire le plist, charger le LaunchAgent, lire le nom Bonjour de la machine et afficher l'URL à ajouter à l'écran d'accueil. Il doit aussi constater l'absence de `nowplaying-cli` sans échouer : le média bascule alors sur le repli AppleScript du §6.3, et l'interface masque ce qu'elle ne sait pas faire plutôt que d'afficher des boutons morts.

**Arborescence.**

```
remote/
├── server.js
├── lib/
│   ├── audio.js       osascript, parsing, coalescing
│   ├── brightness.js  DisplayServices via JXA, coalescing
│   ├── media.js       nowplaying-cli + repli AppleScript
│   ├── display.js     pmset, caffeinate
│   ├── fullscreen.js  NSWorkspace, Apple Events, dégradé Accessibilité
│   ├── webplayer.js   position lue dans la balise vidéo de la page
│   ├── state.js       composition de l'état, sondage conditionnel
│   └── sse.js
├── public/
│   ├── index.html     écran unique, CSS et JS inclus
│   ├── manifest.webmanifest
│   ├── icons/         180 pour iOS, 192, 512 et maskable
│   └── fonts/         Outfit variable, servie localement
├── mac/
│   ├── WinxRemote.applescript   app de barre de menus
│   ├── Installer.applescript    installeur double-cliquable
│   ├── assets/menubar.png       icône de la barre de menus
│   └── build.sh                 fabrique les deux bundles
└── design_handoff_winx_remote/  référence de design, fait foi
```

**L'installation ne passe plus par un script shell** mais par un bundle
double-cliquable, fabriqué par `mac/build.sh` et transporté sur clé USB. Un
bundle créé localement n'est jamais mis en quarantaine : aucun avertissement
de sécurité n'apparaît sur le Mac de destination, sans certificat Apple ni
abonnement développeur.

---

## 11. Jalons

| # | Livrable | Critère de fin |
|---|---|---|
| 0 | Vérifications §2 | Les quatre commandes se comportent comme prévu |
| 1 | Serveur + audio | `curl` règle le volume ; coalescing en place |
| 2 | Interface volume | Glissement plein écran, mute, affichage optimiste |
| 3 | SSE | Changer le volume au clavier du Mac met à jour l'iPhone |
| 4 | Média + écran | Transport et extinction opérationnels |
| 5 | Finition | Icône, manifeste, atténuation auto, LaunchAgent |

Les six jalons sont livrés. L'interface a ensuite été refondue à partir du handoff `design_handoff_winx_remote/`, et l'installation confiée à un bundle double-cliquable plutôt qu'à un script.

Deux commandes ont été ajoutées après coup : la luminosité de l'écran (§6.2), qui partage le grand curseur avec le volume, et le plein écran de l'application au premier plan (§6.4).

---

## 12. Limites connues

- Chemins audio à volume verrouillé (HDMI, certains DAC) : hors de portée. Voir V1.
- `nowplaying-cli` repose sur une API privée d'Apple : peut casser à toute mise à jour majeure de macOS. Le repli AppleScript ne couvre pas les navigateurs.
- Netflix ne publie que « Netflix » comme titre au système, sans nom de film ni d'épisode, et laisse l'artiste et l'album vides. Prime Video publie le vrai titre : la différence vient de la source, pas de l'application. Le nom réel se lit dans la page (§6.5), ce qui suppose Safari ou Chrome autorisé — dans Firefox, qui n'expose rien à AppleScript, le badge continue d'afficher « Netflix » seul.
- Le changement d'épisode Netflix est hors de portée. Une page web doit déclarer auprès de l'API MediaSession les commandes qu'elle accepte ; Netflix déclare la lecture et la pause, mais pas le passage à la piste suivante ou précédente. Les boutons restent donc sans effet sur ses lectures — y compris depuis les touches média du clavier du Mac, ce qui confirme que rien ne vient de l'application. Ces deux boutons gardent tout leur sens pour Music, Spotify, VLC et YouTube.
- Mac endormi : télécommande injoignable.
- Pas de fonctionnement hors ligne : l'app est une fenêtre sur le serveur. Elle sait s'ouvrir sans réseau pour expliquer la coupure, rien de plus.
- Cette ouverture elle-même n'est pas garantie. Elle repose sur le cache HTTP de Safari (§8), qu'iOS purge quand il veut : la fée peut donc être remplacée par une page blanche, sans qu'on puisse le prévoir ni l'empêcher. Seul un service worker y remédierait, hors d'atteinte en HTTP, et le certificat qui l'ouvrirait coûte plus qu'il ne rapporte (§8).
- Volume système global uniquement, pas de réglage par application.
- La luminosité repose sur `DisplayServices`, framework privé d'Apple : même exposition que `nowplaying-cli` à une mise à jour majeure de macOS. Elle ne couvre que l'écran principal, la plupart des écrans externes refusant de rendre leur luminosité.
- Le plein écran d'une vidéo web reste hors de portée sans l'autorisation Accessibilité. Avec elle, la frappe de `f` atteint le lecteur, mais reste retenue tant que le curseur est dans un champ de saisie : le bouton ne fait alors rien, sans qu'on puisse le prévoir avant l'appui.
- VLC n'expose pas la présence d'une piste vidéo : la commande est annoncée disponible dès qu'un média est chargé, et le refus n'apparaît qu'à la relecture qui suit l'écriture.
- Firefox n'expose rien à AppleScript. La position lue dans la page, donc la barre et les sauts de dix secondes, n'y fonctionneront jamais — pas plus que le titre de l'onglet évoqué plus haut. Seuls Safari et Chrome répondent.
- Sur Netflix, le déplacement dans la lecture est hors de portée, réglage ou non : imposer une position casse son tampon chiffré et le renvoie à l'erreur M7375, et son propre lecteur n'est pas joignable depuis un monde isolé. La position et le titre s'y lisent, mais ne s'y écrivent pas.
- Netflix ne publie aucune position : sans le réglage du §10, la barre et les deux sauts restent masqués. C'est délibéré — les afficher supposait d'inventer une origine, ce qui renvoyait le film à son début.
- Une installation par Mac, à vérifier machine par machine (§2). Rien n'est mutualisé, rien ne se synchronise.
- Node.js doit être installé au préalable sur chaque machine.

## 13. Évolutions envisageables

- Binaire Swift CoreAudio pour supprimer la latence des forks.
- `tailscale serve` : certificat valide, vraie PWA, accès hors domicile.
- Changement de périphérique de sortie via `switchaudio-osx`.
- Minuterie d'arrêt : baisser progressivement le volume puis mettre en pause après *n* minutes — la fonction d'endormissement qui manque, et qui donnerait tout son sens au nom.
