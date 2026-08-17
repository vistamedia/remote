(*
	Winx Remote — installeur
	Copyright (C) 2026 Emmanuel Danan <emmanuel.danan@gmail.com>
	Distribué sous licence GNU GPL v3 ou ultérieure. Voir LICENSE.

	Se double-clique. Tout ce qu'il installe voyage dans ses propres
	ressources : une seule chose à copier sur la clé USB.

	Rappel de relecture : AppleScript ignore la casse des identifiants, une
	variable nommée « nsImage » écraserait la classe NSImage. Les noms sont
	donc en français.
*)

use framework "Foundation"
use framework "AppKit"
use framework "CoreImage"
use scripting additions

property dossierServeur : missing value
property dossierApps : missing value
property cheminPlist : missing value
property lAdresse : ""

on run
	set dossierServeur to (POSIX path of (path to home folder)) & "Library/Application Support/Winx Remote"
	set dossierApps to (POSIX path of (path to home folder)) & "Applications"
	set cheminPlist to (POSIX path of (path to home folder)) & "Library/LaunchAgents/local.remote.plist"

	set laReponse to button returned of (display dialog "Winx Remote installera :

  • le serveur, qui démarrera tout seul à l'ouverture de session ;
  • l'app de barre de menus, pour l'état et le QR code.

Rien n'est envoyé sur Internet, tout reste sur ce Mac." with title "Installer Winx Remote" buttons {"Annuler", "Installer"} default button "Installer" with icon note)

	if laReponse is "Annuler" then return

	if not nodePresent() then
		afficherNodeManquant()
		return
	end if

	try
		installer()
	on error leMessage
		display alert "L'installation a échoué" message leMessage as critical
		return
	end try

	terminer()
end run

(* Node n'est pas fourni avec macOS. On ne télécharge rien nous-mêmes : le
   paquet officiel est signé et validé par Apple, il s'installe d'un
   double-clic sans le moindre avertissement. *)
on nodePresent()
	try
		do shell script "/usr/bin/which node || /bin/ls /usr/local/bin/node || /bin/ls /opt/homebrew/bin/node"
		return true
	on error
		return false
	end try
end nodePresent

on cheminNode()
	try
		return do shell script "/usr/bin/which node || /bin/ls /usr/local/bin/node || /bin/ls /opt/homebrew/bin/node"
	on error
		return "/usr/local/bin/node"
	end try
end cheminNode

on afficherNodeManquant()
	set leChoix to button returned of (display dialog "Winx Remote a besoin de Node.js, qui n'est pas installé sur ce Mac.

Téléchargez la version LTS depuis le site officiel, installez-la d'un double-clic, puis relancez cet installeur.

Le paquet est signé par Apple : aucun avertissement de sécurité." with title "Node.js requis" buttons {"Plus tard", "Ouvrir le site"} default button "Ouvrir le site" with icon caution)
	if leChoix is "Ouvrir le site" then
		do shell script "/usr/bin/open https://nodejs.org/fr/download"
	end if
end afficherNodeManquant

on installer()
	set lesRessources to (POSIX path of (path to me)) & "Contents/Resources/"

	-- Le serveur, remplacé s'il existait déjà
	do shell script "/bin/mkdir -p " & quoted form of dossierServeur
	do shell script "/usr/bin/rsync -a --delete " & quoted form of (lesRessources & "payload/") & " " & quoted form of (dossierServeur & "/")

	-- L'app de barre de menus, compilée sur place : fabriquée localement,
	-- elle échappe à la mise en quarantaine et ne déclenche aucun blocage.
	do shell script "/bin/mkdir -p " & quoted form of dossierApps
	do shell script "/bin/rm -rf " & quoted form of (dossierApps & "/Winx Remote.app")
	do shell script "/usr/bin/osacompile -s -o " & quoted form of (dossierApps & "/Winx Remote.app") & " " & quoted form of (lesRessources & "WinxRemote.applescript")
	do shell script "/bin/cp " & quoted form of (lesRessources & "menubarWingsPlayTemplate.png") & " " & quoted form of (lesRessources & "menubarWingsPlayTemplate@2x.png") & " " & quoted form of (lesRessources & "menubarWingsPlayTemplate@3x.png") & " " & quoted form of (dossierApps & "/Winx Remote.app/Contents/Resources/")
	-- Remplace l'icône d'AppleScript posée par osacompile.
	do shell script "/bin/cp " & quoted form of (lesRessources & "AppIcon.icns") & " " & quoted form of (dossierApps & "/Winx Remote.app/Contents/Resources/applet.icns")

	set lePlistApp to dossierApps & "/Winx Remote.app/Contents/Info.plist"
	do shell script "/usr/libexec/PlistBuddy -c 'Add :LSUIElement bool true' " & quoted form of lePlistApp & " 2>/dev/null || true"
	do shell script "/usr/libexec/PlistBuddy -c 'Add :CFBundleName string Winx Remote' " & quoted form of lePlistApp & " 2>/dev/null || true"
	do shell script "/usr/libexec/PlistBuddy -c 'Add :CFBundleIdentifier string local.remote.menubar' " & quoted form of lePlistApp & " 2>/dev/null || true"
	-- CFBundleIconName pointe vers le catalogue d'AppleScript et prime sur
	-- CFBundleIconFile : tant qu'elle est là, notre icône reste ignorée.
	do shell script "/usr/libexec/PlistBuddy -c 'Delete :CFBundleIconName' " & quoted form of lePlistApp & " 2>/dev/null || true"
	do shell script "/usr/bin/codesign --force --sign - " & quoted form of (dossierApps & "/Winx Remote.app") & " 2>/dev/null || true"

	-- Le service, avec les chemins de cette machine
	ecrirePlist()
	do shell script "/bin/launchctl bootout gui/$(/usr/bin/id -u)/local.remote 2>/dev/null || true"
	do shell script "/bin/launchctl bootstrap gui/$(/usr/bin/id -u) " & quoted form of cheminPlist

	attendreServeur()
	calculerAdresse()

	do shell script "/usr/bin/open " & quoted form of (dossierApps & "/Winx Remote.app")
end installer

on ecrirePlist()
	set leNode to cheminNode()
	set leServeur to dossierServeur & "/server.js"
	set leJournal to (POSIX path of (path to home folder)) & "Library/Logs/remote.log"

	set leContenu to "<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
  <key>Label</key><string>local.remote</string>
  <key>ProgramArguments</key>
  <array>
    <string>" & leNode & "</string>
    <string>" & leServeur & "</string>
  </array>
  <key>WorkingDirectory</key><string>" & dossierServeur & "</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>/usr/bin:/bin:/usr/sbin:/sbin</string></dict>
  <key>StandardOutPath</key><string>" & leJournal & "</string>
  <key>StandardErrorPath</key><string>" & leJournal & "</string>
</dict>
</plist>"

	do shell script "/bin/mkdir -p " & quoted form of ((POSIX path of (path to home folder)) & "Library/LaunchAgents")

	(* L'écriture passe par Foundation, et non par « open for access ». La
	   coercion « POSIX file » échoue dans un applet qui charge des
	   frameworks : les Standard Additions et use framework se disputent le
	   terme, et la conversion en «class fsrf» part en erreur -1700. Mesuré
	   sur un applet compilé, c'est ce qui faisait échouer l'installation
	   entière. *)
	set nsContenu to current application's NSString's stringWithString:leContenu
	set ecrit to nsContenu's writeToFile:cheminPlist atomically:true encoding:(current application's NSUTF8StringEncoding) |error|:(missing value)
	if ecrit is false then error "impossible d'écrire " & cheminPlist
end ecrirePlist

(* Le premier démarrage lit l'état audio et génère le token : on laisse au
   serveur le temps de répondre avant d'annoncer que tout est prêt. *)
on attendreServeur()
	repeat 20 times
		try
			set leCode to do shell script "/usr/bin/curl -s -m 1 -o /dev/null -w '%{http_code}' http://127.0.0.1:8765/"
			if leCode is "200" then return true
		end try
		delay 1
	end repeat
	return false
end attendreServeur

on calculerAdresse()
	set leToken to ""
	set cheminConfig to (POSIX path of (path to home folder)) & ".remote/config.json"
	set lesDonnees to current application's NSData's dataWithContentsOfFile:cheminConfig
	if lesDonnees is not missing value then
		set leDict to current application's NSJSONSerialization's JSONObjectWithData:lesDonnees options:0 |error|:(missing value)
		if leDict is not missing value then
			set laValeur to leDict's objectForKey:"token"
			if laValeur is not missing value then set leToken to laValeur as text
		end if
	end if
	try
		set leNom to do shell script "/usr/sbin/scutil --get LocalHostName"
	on error
		set leNom to "localhost"
	end try
	set lAdresse to "http://" & leNom & ".local:8765/?t=" & leToken
end calculerAdresse

on terminer()
	set leChoix to button returned of (display dialog "Winx Remote est installé.

Le serveur démarrera désormais à chaque ouverture de session, et l'icône ◉ apparaît dans la barre de menus.

Pour poser la télécommande sur un iPhone : scannez le QR code, puis, dans Safari, Partager › Sur l'écran d'accueil." with title "Installation terminée" buttons {"Fermer", "Afficher le QR code"} default button "Afficher le QR code" with icon note)

	if leChoix is "Afficher le QR code" then afficherQR()
end terminer

on afficherQR()
	set cheminBrut to "/tmp/soft-remote-qr-brut.png"
	set cheminFinal to "/tmp/soft-remote-qr.png"

	set nsTexte to current application's NSString's stringWithString:lAdresse
	set lesOctetsTexte to nsTexte's dataUsingEncoding:(current application's NSISOLatin1StringEncoding)

	set leFiltre to current application's CIFilter's filterWithName:"CIQRCodeGenerator"
	if leFiltre is missing value then
		set the clipboard to lAdresse
		display alert "QR code indisponible" message "L'adresse a été copiée dans le presse-papiers." as warning
		return
	end if

	leFiltre's setDefaults()
	leFiltre's setValue:lesOctetsTexte forKey:"inputMessage"
	leFiltre's setValue:"M" forKey:"inputCorrectionLevel"

	set laRep to current application's NSCIImageRep's imageRepWithCIImage:(leFiltre's outputImage())
	set imageQR to current application's NSImage's alloc()'s init()
	imageQR's addRepresentation:laRep

	set lesOctetsPNG to (current application's NSBitmapImageRep's imageRepWithData:(imageQR's TIFFRepresentation()))'s representationUsingType:(current application's NSBitmapImageFileTypePNG) |properties|:(current application's NSDictionary's dictionary())
	lesOctetsPNG's writeToFile:cheminBrut atomically:true

	do shell script "/usr/bin/sips -s format png -z 540 540 " & quoted form of cheminBrut & " --out " & quoted form of cheminFinal & " >/dev/null 2>&1"
	do shell script "/usr/bin/open " & quoted form of cheminFinal
end afficherQR
