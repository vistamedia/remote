#!/bin/bash
# Winx Remote — fabrique l'app de barre de menus et l'installeur.
# Copyright (C) 2026 Emmanuel Danan <emmanuel.danan@gmail.com>
# Distribué sous licence GNU GPL v3 ou ultérieure. Voir LICENSE.
#
# osacompile est livré avec macOS : aucun outil de développement n'est
# nécessaire. Un bundle fabriqué sur place n'est jamais mis en quarantaine,
# donc aucun avertissement de sécurité à l'ouverture.
#
#   ./mac/build.sh            → construit tout dans mac/build/
#   ./mac/build.sh --menubar  → seulement l'app de barre de menus

set -e

ICI="$(cd "$(dirname "$0")" && pwd)"
RACINE="$(cd "$ICI/.." && pwd)"
SORTIE="$ICI/build"

# Renseigne l'Info.plist d'un bundle, que la clé existe déjà ou non.
poser() {
  local plist="$1" cle="$2" type="$3" valeur="$4"
  /usr/libexec/PlistBuddy -c "Add :$cle $type $valeur" "$plist" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Set :$cle $valeur" "$plist"
}

construire_menubar() {
  local cible="$1"
  rm -rf "$cible"
  mkdir -p "$(dirname "$cible")"
  # -s produit une application « stay open », qui reste vivante et reçoit
  # périodiquement le gestionnaire idle.
  osacompile -s -o "$cible" "$ICI/WinxRemote.applescript"

  # Icône de barre de menus, monochrome, dans les trois densités d'écran.
  cp "$ICI/assets/menubarWingsPlayTemplate"*.png "$cible/Contents/Resources/"
  # L'icône du bundle remplace celle d'AppleScript, posée par osacompile.
  cp "$ICI/assets/AppIcon.icns" "$cible/Contents/Resources/applet.icns"

  local plist="$cible/Contents/Info.plist"
  # LSUIElement la garde hors du Dock : elle ne vit que dans la barre de menus.
  poser "$plist" LSUIElement bool true
  poser "$plist" CFBundleName string "Winx Remote"
  poser "$plist" CFBundleIdentifier string local.remote.menubar
  poser "$plist" CFBundleShortVersionString string 1.0
  poser "$plist" NSHumanReadableCopyright string "Copyright (C) 2026 Emmanuel Danan — GNU GPL v3"

  # Modifier le plist invalide la signature ad hoc posée par osacompile.
  codesign --force --sign - "$cible" >/dev/null 2>&1 || true
  echo "  app de barre de menus : $cible"
}

construire_installeur() {
  local cible="$SORTIE/Installer Winx Remote.app"
  rm -rf "$cible"
  mkdir -p "$SORTIE"
  osacompile -o "$cible" "$ICI/Installer.applescript"

  local plist="$cible/Contents/Info.plist"
  poser "$plist" CFBundleName string "Installer Winx Remote"
  poser "$plist" CFBundleIdentifier string local.remote.installer
  poser "$plist" CFBundleShortVersionString string 1.0
  poser "$plist" NSHumanReadableCopyright string "Copyright (C) 2026 Emmanuel Danan — GNU GPL v3"

  # Tout ce qui sera installé voyage dans les ressources du bundle : une
  # seule chose à copier sur la clé USB.
  local res="$cible/Contents/Resources"
  mkdir -p "$res/payload/lib" "$res/payload/public"
  cp "$RACINE/server.js" "$res/payload/"
  cp "$RACINE/LICENSE" "$res/payload/"
  cp "$RACINE"/lib/*.js "$res/payload/lib/"
  # -R : public/ contient désormais les sous-dossiers icons/ et fonts/.
  cp -R "$RACINE"/public/. "$res/payload/public/"
  cp "$ICI/WinxRemote.applescript" "$res/"
  cp "$ICI/assets/menubarWingsPlayTemplate"*.png "$res/"
  cp "$ICI/assets/AppIcon.icns" "$res/"
  cp "$ICI/assets/AppIcon.icns" "$res/applet.icns"

  codesign --force --sign - "$cible" >/dev/null 2>&1 || true
  echo "  installeur            : $cible"
}

if [ "$1" = "--menubar" ]; then
  construire_menubar "${2:-$SORTIE/Winx Remote.app}"
else
  construire_menubar "$SORTIE/Winx Remote.app"
  construire_installeur
  echo
  echo "À copier sur la clé USB :"
  echo "  $SORTIE/Installer Winx Remote.app"
  echo
  # Les bundles ne sont pas versionnés : sans cette ouverture, on les cherche.
  open -R "$SORTIE/Installer Winx Remote.app" 2>/dev/null || true
fi
