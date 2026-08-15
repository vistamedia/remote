#!/bin/bash
# Soft Remote — fabrique l'app de barre de menus.
# Copyright (C) 2026 Emmanuel Danan <emmanuel.danan@gmail.com>
# Distribué sous licence GNU GPL v3 ou ultérieure. Voir LICENSE.
#
# osacompile est livré avec macOS : aucun outil de développement n'est
# nécessaire. Un bundle fabriqué sur place n'est jamais mis en quarantaine,
# donc aucun avertissement de sécurité à l'ouverture.

set -e

ICI="$(cd "$(dirname "$0")" && pwd)"
SOURCE="$ICI/SoftRemote.applescript"
CIBLE="${1:-$ICI/build/Soft Remote.app}"

mkdir -p "$(dirname "$CIBLE")"
rm -rf "$CIBLE"

# -s produit une application « stay open », qui reste vivante et reçoit
# périodiquement le gestionnaire idle.
osacompile -s -o "$CIBLE" "$SOURCE"

PLIST="$CIBLE/Contents/Info.plist"

# LSUIElement masque l'app du Dock et du sélecteur d'applications : elle ne
# vit que dans la barre de menus.
/usr/libexec/PlistBuddy -c "Add :LSUIElement bool true" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :LSUIElement true" "$PLIST"

/usr/libexec/PlistBuddy -c "Add :CFBundleName string Soft Remote" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :CFBundleName Soft Remote" "$PLIST"

/usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string local.remote.menubar" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier local.remote.menubar" "$PLIST"

/usr/libexec/PlistBuddy -c "Add :CFBundleShortVersionString string 1.0" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString 1.0" "$PLIST"

/usr/libexec/PlistBuddy -c "Add :NSHumanReadableCopyright string Copyright (C) 2026 Emmanuel Danan — GNU GPL v3" "$PLIST" 2>/dev/null \
  || /usr/libexec/PlistBuddy -c "Set :NSHumanReadableCopyright Copyright (C) 2026 Emmanuel Danan — GNU GPL v3" "$PLIST"

# La signature ad hoc posée par osacompile est invalidée par la modification
# du plist : on resigne, toujours en ad hoc, ce qui suffit hors distribution.
codesign --force --sign - "$CIBLE" >/dev/null 2>&1 || true

echo "app construite : $CIBLE"
