# Livrable final - Connexion SCANDIAG sans logiciel FACOM

## Objectif

L'objectif final est de ne plus utiliser le logiciel FACOM pendant l'exploitation quotidienne.

Le logiciel FACOM reste utile uniquement pour :

- appairer/configurer le SCANDIAG une premiere fois dans Windows ;
- valider que le port Bluetooth serie fonctionne ;
- capturer les trames proprietaires necessaires au declenchement d'une mesure.

Une fois cette phase faite, le flux cible devient :

```text
PWA Monitoring EV
      |
      v
WebSocket ws://localhost:8765
      |
      v
SCANDIAG Bridge Python
      |
      v
COM4 Bluetooth SPP
      |
      v
FACOM SCANDIAG
```

## Mode POC retenu si le protocole reste proprietaire

Si le protocole serie ne peut pas etre decode dans le temps disponible, le mode retenu pour une demonstration fiable est :

```text
SCANDIAG -> FACOM ouvert en arriere-plan -> temp.raw -> SCANDIAG Bridge -> PWA
```

Dans ce mode, FACOM reste ouvert et minimise. Il sert uniquement a garder le scanner initialise et a produire le fichier local `temp.raw`. L'interface utilisee par l'operateur reste la PWA.

Commande :

```powershell
cd bridge
.\.venv\Scripts\Activate.ps1
python temp_raw_bridge.py --plate AY-389-IM
```

La PWA recoit une mesure automatiquement quand le fichier suivant est modifie :

```text
C:\ProgramData\Facom\ScanDiag\temp.raw
```

Ce mode est le plus robuste pour un POC presente en conditions reelles : il utilise le SCANDIAG physique, evite les ressaisies, et masque le logiciel constructeur derriere l'interface metier.

## Etat technique observe

Le SCANDIAG apparait dans Windows sous un nom de serie de type `LSG...`.

Windows expose ensuite un port serie Bluetooth standard :

```text
COM4 | Lien serie sur Bluetooth standard
UUID SPP : 00001101-0000-1000-8000-00805F9B34FB
```

Ce UUID correspond au profil Bluetooth Classic Serial Port Profile, et non a un service BLE GATT classique. C'est pour cette raison qu'une PWA seule ne peut pas parler directement au scanner dans le navigateur : elle doit passer par un petit bridge local.

## Phase 1 - Configuration unique avec FACOM

1. Appairer le SCANDIAG dans Windows.
2. Verifier que le logiciel FACOM detecte le scanner.
3. Effectuer un scan de test dans le logiciel FACOM.
4. Identifier le port reel utilise par Windows, ici `COM4`.

Cette phase prouve que la pile Bluetooth, les drivers et le scanner sont operationnels.

## Phase 2 - Capture des commandes FACOM

Pour supprimer le logiciel FACOM ensuite, il faut recuperer les commandes qu'il envoie au scanner.

Montage retenu :

```text
Logiciel FACOM -> COM10 virtuel -> COM11 virtuel -> serial_proxy.py -> COM4 reel -> SCANDIAG
```

Lancer le proxy :

```powershell
cd bridge
.\.venv\Scripts\Activate.ps1
python serial_proxy.py --facom-port COM11 --device-port COM4 --baudrate 9600 --log serial-proxy.log
```

Puis dans le logiciel FACOM :

1. selectionner le port `COM10` ;
2. connecter le SCANDIAG ;
3. choisir le type de scan ;
4. lancer une mesure.

Le fichier `serial-proxy.log` contient les trames :

- `FACOM -> SCANDIAG` : commandes envoyees au scanner ;
- `SCANDIAG -> FACOM` : reponses et mesures.

Les trames importantes sont celles envoyees :

- juste apres la connexion ;
- au choix du mode de scan ;
- au moment exact ou une mesure est lancee.

## Phase 3 - Utilisation finale sans logiciel FACOM

Une fois la commande de scan identifiee, le logiciel FACOM n'est plus necessaire.

Exemple de lancement du bridge avec une trame de declenchement :

```powershell
cd bridge
.\.venv\Scripts\Activate.ps1
python scandiag_bridge.py --serial-port COM4 --serial-baudrate 9600 --trigger-write-hex "AA BB CC DD"
```

`AA BB CC DD` est a remplacer par la trame reelle capturee dans `serial-proxy.log`.

Ensuite :

1. lancer la PWA ;
2. saisir la plaque du vehicule ;
3. cliquer `Connecter le logiciel local` ;
4. cliquer `Mesure SCANDIAG`.

La PWA envoie alors une demande au bridge local. Le bridge ecrit la commande sur `COM4`, lit la reponse du SCANDIAG et renvoie la mesure a l'interface web.

## Commandes utiles

Lister les ports COM :

```powershell
python scandiag_bridge.py --list-serial
```

Lire le scanner sans commande de declenchement :

```powershell
python scandiag_bridge.py --serial-port COM4 --serial-baudrate 9600 --serial-debug --serial-log scandiag-raw.log
```

Envoyer une commande au demarrage :

```powershell
python scandiag_bridge.py --serial-port COM4 --serial-baudrate 9600 --serial-write-hex "AA BB CC DD"
```

Envoyer une commande uniquement quand la PWA clique sur `Mesure SCANDIAG` :

```powershell
python scandiag_bridge.py --serial-port COM4 --serial-baudrate 9600 --trigger-write-hex "AA BB CC DD"
```

## Limite restante

Le logiciel FACOM utilise un protocole proprietaire. Le port `COM4` fonctionne, mais la commande de mesure exacte doit etre capturee avec le proxy COM virtuel avant de pouvoir etre rejouee de maniere fiable par notre bridge.

Une fois cette trame connue, l'architecture est realiste pour un entrepot : les operateurs utilisent uniquement la PWA et le SCANDIAG, sans ouvrir l'interface FACOM.
