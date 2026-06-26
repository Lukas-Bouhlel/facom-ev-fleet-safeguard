# Partie 2 - Prompt PWA de monitoring SCANDIAG EV

## Prompt a utiliser

Construire une PWA de monitoring temps reel pour le FACOM SCANDIAG / DX.TSCAN.

Contexte :

- L'application doit fonctionner sur tablette, smartphone et desktop.
- Le SCANDIAG peut etre connecte reellement via Web Bluetooth.
- Si le Bluetooth est indisponible pendant la demonstration, l'application doit proposer une simulation credible de scans entrants.
- Le sujet met en avant le risque d'usure acceleree lie au surpoids des vehicules electriques en 2026.

Interface attendue :

- Theme sombre atelier, contraste eleve, lisible a distance.
- En haut : carte "RAPPORT DE SCAN TEMPS REEL v2026".
- Afficher l'immatriculation du dernier vehicule scanne.
- Afficher les mesures principales : profondeur pneu en mm et epaisseur disque en mm.
- Tableau historique avec colonnes : Immat., Heure, Pneu (mm), Disque (mm), Statut.
- Bloc statut bas de page : Connexion et Dernier Scan.
- Boutons principaux : "Connecter FACOM SCANDIAG" et "Simuler Scan Entrant".
- Zone de configuration avancee pour renseigner le prefixe Bluetooth, l'UUID service et l'UUID caracteristique.

Regles metier :

- Statut `CONFORME` si les pneus et disques sont dans les seuils.
- Statut `VIGILANCE` si pneu < 4.0 mm ou disque < 1.8 mm.
- Statut `CRITIQUE` si pneu < 3.0 mm ou disque < 1.5 mm.
- En `CRITIQUE`, afficher une alerte rouge "ALERTE CRITIQUE EV 2026".
- Conserver les derniers scans en memoire dans la session.

Connexion reelle :

- Utiliser l'API Web Bluetooth.
- Filtrer les appareils par `namePrefix: "FACOM_SCANDIAG_"`.
- Demander les `optionalServices` a partir de l'UUID service saisi.
- Se connecter au serveur GATT.
- Ouvrir la caracteristique cible.
- Activer `startNotifications()`.
- Decoder les notifications.

Formats de trame acceptes :

- JSON : `{"plate":"AY-389-IM","tire":4.8,"disk":1.7}`
- Texte brut : `AY-389-IM tire=4.8 disk=1.7`
- Binaire POC : 4 octets, `uint16` little-endian pour pneu puis disque, valeurs en dixiemes de millimetre.

Mode simulation :

- Le bouton "Simuler Scan Entrant" ajoute un scan factice realiste.
- Prevoir au moins un scan conforme, un scan en vigilance et un scan critique.
- La simulation doit permettre de presenter le POC meme sans outil physique.

PWA :

- Ajouter un `manifest.webmanifest`.
- Ajouter un `service-worker.js` basique avec cache des fichiers statiques.
- L'application doit fonctionner sur `http://localhost` et etre installable en contexte securise.

Livrables attendus :

- `app/index.html`
- `app/styles.css`
- `app/app.js`
- `app/manifest.webmanifest`
- `app/service-worker.js`

## Notes d'integration

Les UUID BLE exacts du SCANDIAG ne sont pas fournis dans les documents constructeur disponibles. Ils doivent etre mappes pendant la phase de reverse engineering de la Partie 1, puis renseignes dans la configuration avancee de la PWA.
