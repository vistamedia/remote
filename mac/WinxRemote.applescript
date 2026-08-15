(*
	Winx Remote — app de barre de menus
	Copyright (C) 2026 Emmanuel Danan <emmanuel.danan@gmail.com>
	Distribué sous licence GNU GPL v3 ou ultérieure. Voir LICENSE.

	Compilée par osacompile, présent sur tout Mac : aucun outil de
	développement n'est nécessaire, et un bundle fabriqué sur place n'est
	jamais mis en quarantaine par Gatekeeper.

	Attention en relisant : AppleScript ne distingue pas les majuscules des
	minuscules dans les identifiants. Nommer une variable « nsImage »
	écraserait la classe NSImage. Les noms de variables sont donc en
	français pour éviter toute collision avec AppKit.
*)

use framework "Foundation"
use framework "AppKit"
use framework "CoreImage"
use scripting additions

property statusItem : missing value
property leMenu : missing value
property itemEtat : missing value
property leToken : ""
property lAdresse : ""
property serveurActif : false

on run
	chargerConfig()
	construireMenu()
	rafraichir()
end run

(* Le rythme est lent à dessein : cette app ne fait qu'afficher un témoin,
   elle n'a aucune raison de réveiller la machine plus souvent. *)
on idle
	rafraichir()
	return 5
end idle

on chargerConfig()
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
end chargerConfig

on construireMenu()
	set laBarre to current application's NSStatusBar's systemStatusBar()
	set statusItem to laBarre's statusItemWithLength:(current application's NSVariableStatusItemLength)

	(* Icône monochrome en mode « template » : macOS la recolore lui-même,
	   noire sur une barre claire, blanche sur une barre sombre, et gère
	   l'état pressé. C'est la seule façon de s'intégrer proprement, une
	   icône en couleurs restant figée quel que soit le thème.

	   imageNamed: choisit la densité qui convient à l'écran parmi les trois
	   fichiers du bundle ; le repli par chemin sert si le nom n'est pas
	   résolu, ce qui arrive hors bundle compilé. *)
	set nomIcone to "menubarWingsPlayTemplate"
	set lIcone to current application's NSImage's imageNamed:nomIcone
	if lIcone is missing value then
		set cheminIcone to (POSIX path of (path to me)) & "Contents/Resources/" & nomIcone & "@2x.png"
		set lIcone to current application's NSImage's alloc()'s initWithContentsOfFile:cheminIcone
	end if
	if lIcone is not missing value then
		lIcone's setTemplate:true
		lIcone's setSize:{22, 22}
		statusItem's button's setImage:lIcone
	end if

	set leMenu to current application's NSMenu's alloc()'s init()
	leMenu's setAutoenablesItems:false

	set itemEtat to ajouterItem("Vérification…", "", false)
	leMenu's addItem:(current application's NSMenuItem's separatorItem())
	ajouterItem("Ouvrir la télécommande", "ouvrirTelecommande:", true)
	ajouterItem("Afficher le QR code", "afficherQR:", true)
	ajouterItem("Copier l'adresse", "copierAdresse:", true)
	leMenu's addItem:(current application's NSMenuItem's separatorItem())
	ajouterItem("Redémarrer le serveur", "redemarrerServeur:", true)
	leMenu's addItem:(current application's NSMenuItem's separatorItem())
	ajouterItem("À propos de Winx Remote", "aPropos:", true)
	ajouterItem("Quitter Winx Remote", "quitterApp:", true)

	statusItem's setMenu:leMenu
end construireMenu

on ajouterItem(leTitre, leSelecteur, actif)
	set nouvelItem to current application's NSMenuItem's alloc()'s initWithTitle:leTitre action:leSelecteur keyEquivalent:""
	if leSelecteur is not "" then nouvelItem's setTarget:me
	nouvelItem's setEnabled:actif
	leMenu's addItem:nouvelItem
	return nouvelItem
end ajouterItem

(* Le serveur est interrogé sur la boucle locale : inutile de passer par le
   nom Bonjour, et ça reste vrai même si le Wi-Fi est coupé. *)
on serveurRepond()
	if leToken is "" then return false
	try
		set laReponse to do shell script "/usr/bin/curl -s -m 2 -o /dev/null -w '%{http_code}' -H " & quoted form of ("X-Token: " & leToken) & " http://127.0.0.1:8765/api/state"
		return laReponse is "200"
	on error
		return false
	end try
end serveurRepond

on rafraichir()
	set serveurActif to serveurRepond()

	if statusItem is not missing value then
		if serveurActif then
			statusItem's button's setAlphaValue:1.0
			statusItem's button's setToolTip:"Winx Remote — serveur actif"
		else
			statusItem's button's setAlphaValue:0.4
			statusItem's button's setToolTip:"Winx Remote — serveur arrêté"
		end if
	end if

	if itemEtat is not missing value then
		if serveurActif then
			itemEtat's setTitle:"Serveur actif"
		else
			itemEtat's setTitle:"Serveur arrêté"
		end if
	end if
end rafraichir

on ouvrirTelecommande:sender
	do shell script "/usr/bin/open " & quoted form of lAdresse
end ouvrirTelecommande:

on copierAdresse:sender
	set the clipboard to lAdresse
end copierAdresse:

(* Le QR code évite d'avoir à recopier un token de 32 caractères sur un
   iPhone. Généré par CoreImage, donc sans aucune dépendance, puis agrandi
   par sips avant d'être ouvert dans Aperçu. *)
on afficherQR:sender
	set cheminBrut to "/tmp/soft-remote-qr-brut.png"
	set cheminFinal to "/tmp/soft-remote-qr.png"

	set nsTexte to current application's NSString's stringWithString:lAdresse
	set lesDonnees to nsTexte's dataUsingEncoding:(current application's NSISOLatin1StringEncoding)

	set leFiltre to current application's CIFilter's filterWithName:"CIQRCodeGenerator"
	if leFiltre is missing value then
		display alert "QR code indisponible" message "CoreImage n'a pas fourni de générateur. L'adresse a été copiée dans le presse-papiers." as warning
		set the clipboard to lAdresse
		return
	end if

	leFiltre's setDefaults()
	leFiltre's setValue:lesDonnees forKey:"inputMessage"
	leFiltre's setValue:"M" forKey:"inputCorrectionLevel"

	set laSortie to leFiltre's outputImage()
	set laRep to current application's NSCIImageRep's imageRepWithCIImage:laSortie
	set imageQR to current application's NSImage's alloc()'s init()
	imageQR's addRepresentation:laRep

	set lesOctets to (current application's NSBitmapImageRep's imageRepWithData:(imageQR's TIFFRepresentation()))'s representationUsingType:(current application's NSBitmapImageFileTypePNG) |properties|:(current application's NSDictionary's dictionary())
	lesOctets's writeToFile:cheminBrut atomically:true

	do shell script "/usr/bin/sips -s format png -z 540 540 " & quoted form of cheminBrut & " --out " & quoted form of cheminFinal & " >/dev/null 2>&1"
	do shell script "/usr/bin/open " & quoted form of cheminFinal
end afficherQR:

on redemarrerServeur:sender
	try
		do shell script "/bin/launchctl kickstart -k gui/$(/usr/bin/id -u)/local.remote"
		delay 2
		rafraichir()
	on error leMessage
		display alert "Redémarrage impossible" message leMessage as warning
	end try
end redemarrerServeur:

(* Une app de barre de menus n'a pas de fenêtre : sans cette activation, le
   dialogue s'ouvrirait derrière l'application de premier plan. *)
on aPropos:sender
	set laVersion to "1.0"
	try
		set laVersion to do shell script "/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' " & quoted form of ((POSIX path of (path to me)) & "Contents/Info.plist")
	end try

	current application's NSApp's activateIgnoringOtherApps:true

	set leTexte to "Télécommande pour Mac, pilotée depuis un iPhone.
Version " & laVersion & "

Conçue pour Elisa.

—

Emmanuel Danan
Conception d'applications mobiles et web, d'interfaces et d'outils sur mesure, de la première idée à la mise en service.

Une application à imaginer, un outil qui vous manque ? Parlons-en.
emmanuel.danan@gmail.com

Logiciel libre, sous licence GNU GPL v3."

	set leChoix to button returned of (display alert "Winx Remote" message leTexte buttons {"Fermer", "Écrire à Emmanuel"} default button "Fermer")

	if leChoix is "Écrire à Emmanuel" then
		do shell script "/usr/bin/open " & quoted form of "mailto:emmanuel.danan@gmail.com?subject=Une%20application%20sur%20mesure"
	end if
end aPropos:

on quitterApp:sender
	quit
end quitterApp:

on quit
	continue quit
end quit
