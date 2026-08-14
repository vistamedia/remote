# remote — spécifications

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
  "media": { "available": true, "playing": true, "title": "…", "artist": "…" }
}
```

`volumeControllable` à `false` signale le cas V1 : l'interface doit alors afficher un état dégradé explicite plutôt qu'un curseur qui ne fait rien.

### `POST /api/volume`

Corps `{ "value": 42 }` (absolu, 0–100) ou `{ "delta": -5 }` (relatif, borné à 0–100).
Réponse : l'état complet. `409` si `volumeControllable` est faux.

### `POST /api/mute`

Corps `{ "muted": true }` ou `{ "toggle": true }`.

### `POST /api/media`

Corps `{ "action": "playpause" | "next" | "previous" }`.
`503` si aucun backend média n'est disponible.

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

### 6.3 Média

Voie principale : `nowplaying-cli togglePlayPause | next | previous`. Elle a l'avantage de couvrir toute application enregistrée auprès du système, y compris la lecture vidéo dans Safari ou Chrome — donc YouTube.

**Plan B si V2 échoue.** Détecter l'application en cours et piloter directement :

```applescript
tell application "Music" to playpause
tell application "Spotify" to next track
```

Couvre Music, Spotify, VLC, QuickTime. Ne couvre pas les navigateurs. L'API renvoie alors `available: true` avec une liste de capacités réduite, et l'interface masque ce qu'elle ne peut pas faire plutôt que d'offrir des boutons morts.

---

## 7. Interface

### 7.1 Le principe directeur

L'utilisateur est allongé, dans le noir, à moitié endormi, tenant le téléphone d'une main. Il ne visera pas juste. **La cible, c'est donc l'écran entier** : un glissement vertical n'importe où sur la page règle le volume. Il n'y a pas de curseur fin à attraper. Le remplissage de l'écran *est* le curseur.

Un simple tap ne change rien — il réveille l'affichage. Seul le glissement agit. C'est ce qui rend l'objet utilisable sans regarder.

### 7.2 Direction visuelle

Le fond est noir chaud, presque sans bleu, et l'accent est ambré. Ce n'est pas un choix décoratif : c'est la combinaison la moins agressive pour un œil adapté à l'obscurité, et la moins susceptible de réveiller. L'écran doit informer sans éclairer la chambre.

```
--ink        #0B0A09   fond
--surface    #17140F   colonne vide
--ember      #E8873A   remplissage, accent
--ember-low  #7A4418   rail, états inactifs
--bone       #E6DDCE   texte principal (jamais de blanc pur)
--muted      #6E655A   libellés
```

**Typographie.** `ui-rounded` (SF Rounded, disponible nativement sur iOS, aucun téléchargement) pour tout. Le nombre du volume est posé très gros — lisible à trois mètres, à moitié réveillé — en `font-variant-numeric: tabular-nums` pour qu'il ne tressaute pas en changeant de chiffre. Les libellés sont minuscules, espacés, en `--muted`, et se contentent de nommer.

**Auto-atténuation.** Après 8 secondes sans contact, toute l'interface passe à 35 % d'opacité en fondu lent. Le premier contact la restaure. C'est le geste principal du design : l'objet s'éteint tout seul et attend.

### 7.3 Structure

```
┌──────────────────────┐
│                      │
│                      │   toute la surface = zone de glissement
│                      │
│         42           │   nombre, très grand, centré
│       VOLUME         │   libellé minuscule
│                      │
│  ░░░░░░░░░░░░░░░░░░  │   remplissage ambré depuis le bas
│  ██████████████████  │
│  ██████████████████  │
├──────────────────────┤
│  ⏮    ⏯    ⏭    🔇   │   barre fixe, cibles ≥ 64 px
│         écran        │
└──────────────────────┘
```

État muet : le remplissage passe en `--ember-low`, le nombre reste affiché mais désaturé. On doit comprendre en un dixième de seconde que le son est coupé, pas seulement à zéro.

### 7.4 Détails techniques d'interface

- `touch-action: none` sur la zone de glissement, sinon Safari déclenche le pull-to-refresh et le rebond de scroll.
- `user-select: none` et `-webkit-touch-callout: none` : pas de loupe de sélection sur appui long.
- `viewport-fit=cover` et `env(safe-area-inset-*)` : la barre de transport doit rester au-dessus de l'indicateur d'accueil.
- Pas de retour haptique : `navigator.vibrate` n'existe pas sur Safari iOS.
- `prefers-reduced-motion` respecté sur le fondu d'atténuation.
- Point de connexion discret en haut, ambré si connecté, éteint sinon. Pas de bannière d'erreur qui éclaire l'écran.

---

## 8. Installation sur l'iPhone

Ajout via Safari → Partager → « Sur l'écran d'accueil ». L'URL enregistrée contient le token, qui n'est donc à saisir qu'une fois.

**Requis :**
- `<meta name="apple-mobile-web-app-capable" content="yes">` — supprime la barre Safari.
- `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`
- `apple-touch-icon` en 180 × 180, sinon iOS génère une capture d'écran comme icône.
- Un `manifest.webmanifest` malgré tout, pour la cohérence et l'avenir.

**Ce qui ne marchera pas, et c'est assumé.** En HTTP sur le LAN, la page n'est pas en contexte sécurisé. Donc : pas de service worker (aucune mise en cache hors ligne) et pas de Wake Lock (l'écran de l'iPhone s'éteindra tout seul). Ce n'est pas gênant ici — l'app est inutile sans le serveur de toute façon, et on rallume l'iPhone d'un appui. Ce n'est donc pas une PWA au sens strict, mais une page web en plein écran avec une icône. La différence est invisible à l'usage.

Si tu veux plus tard la vraie PWA : `mkcert` avec l'autorité installée sur l'iPhone, ou `tailscale serve` qui fournit un certificat valide et ouvre en prime l'accès depuis l'extérieur.

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

**Installer sur une machine qu'on ne connaît pas.** Chaque Mac reçoit sa propre installation, et la personne qui s'en sert ne doit rien avoir à configurer. `install.sh` prend donc tout en charge : vérifier que Node est présent et s'arrêter avec un message clair sinon, générer le token, écrire le plist, charger le LaunchAgent, lire le nom Bonjour de la machine et afficher l'URL à ajouter à l'écran d'accueil. Il doit aussi constater l'absence de `nowplaying-cli` sans échouer : le média bascule alors sur le repli AppleScript du §6.3, et l'interface masque ce qu'elle ne sait pas faire plutôt que d'afficher des boutons morts.

**Arborescence.**

```
remote/
├── server.js
├── lib/
│   ├── audio.js       osascript, parsing, coalescing
│   ├── media.js       nowplaying-cli + repli AppleScript
│   ├── display.js     pmset, caffeinate
│   ├── state.js       état, sondage conditionnel
│   └── sse.js
├── public/
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   ├── manifest.webmanifest
│   └── icon-180.png
└── install.sh         token, plist, chargement, affichage de l'URL
```

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

Le jalon 2 est déjà utilisable tous les soirs. Le reste est du confort.

---

## 12. Limites connues

- Chemins audio à volume verrouillé (HDMI, certains DAC) : hors de portée. Voir V1.
- `nowplaying-cli` repose sur une API privée d'Apple : peut casser à toute mise à jour majeure de macOS. Le repli AppleScript ne couvre pas les navigateurs.
- Netflix ne publie que « Netflix » comme titre, sans nom de film ni d'épisode, et laisse l'artiste et l'album vides. Prime Video publie le vrai titre : la différence vient de la source, pas de l'application. Compléter l'information supposerait de lire le titre de l'onglet, que Firefox n'expose pas à AppleScript.
- Le changement d'épisode Netflix est hors de portée. Une page web doit déclarer auprès de l'API MediaSession les commandes qu'elle accepte ; Netflix déclare la lecture et la pause, mais pas le passage à la piste suivante ou précédente. Les boutons restent donc sans effet sur ses lectures — y compris depuis les touches média du clavier du Mac, ce qui confirme que rien ne vient de l'application. Ces deux boutons gardent tout leur sens pour Music, Spotify, VLC et YouTube.
- Mac endormi : télécommande injoignable.
- Pas de fonctionnement hors ligne : l'app est une fenêtre sur le serveur.
- Volume système global uniquement, pas de réglage par application.
- Une installation par Mac, à vérifier machine par machine (§2). Rien n'est mutualisé, rien ne se synchronise.
- Node.js doit être installé au préalable sur chaque machine.

## 13. Évolutions envisageables

- Binaire Swift CoreAudio pour supprimer la latence des forks.
- `tailscale serve` : certificat valide, vraie PWA, accès hors domicile.
- Changement de périphérique de sortie via `switchaudio-osx`.
- Réglage de la luminosité de l'écran du Mac (nécessite un binaire tiers).
- Minuterie d'arrêt : baisser progressivement le volume puis mettre en pause après *n* minutes — la fonction d'endormissement qui manque, et qui donnerait tout son sens au nom.
