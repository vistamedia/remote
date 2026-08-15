#!/bin/bash
# Soft Remote — fabrique l'app de barre de menus et l'installeur.
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
  osacompile -s -o "$cible" "$ICI/SoftRemote.applescript"

  local plist="$cible/Contents/Info.plist"
  # LSUIElement la garde hors du Dock : elle ne vit que dans la barre de menus.
  poser "$plist" LSUIElement bool true
  poser "$plist" CFBundleName string "Soft Remote"
  poser "$plist" CFBundleIdentifier string local.remote.menubar
  poser "$plist" CFBundleShortVersionString string 1.0
  poser "$plist" NSHumanReadableCopyright string "Copyright (C) 2026 Emmanuel Danan — GNU GPL v3"

  # Modifier le plist invalide la signature ad hoc posée par osacompile.
  codesign --force --sign - "$cible" >/dev/null 2>&1 || true
  echo "  app de barre de menus : $cible"
}

construire_installeur() {
  local cible="$SORTIE/Installer Soft Remote.app"
  rm -rf "$cible"
  mkdir -p "$SORTIE"
  osacompile -o "$cible" "$ICI/Installer.applescript"

  local plist="$cible/Contents/Info.plist"
  poser "$plist" CFBundleName string "Installer Soft Remote"
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
  cp "$RACINE"/public/* "$res/payload/public/"
  cp "$ICI/SoftRemote.applescript" "$res/"

  codesign --force --sign - "$cible" >/dev/null 2>&1 || true
  echo "  installeur            : $cible"
}

if [ "$1" = "--menubar" ]; then
  construire_menubar "${2:-$SORTIE/Soft Remote.app}"
else
  construire_menubar "$SORTIE/Soft Remote.app"
  construire_installeur
  echo
  echo "À copier sur la clé USB : $SORTIE/Installer Soft Remote.app"
fi
