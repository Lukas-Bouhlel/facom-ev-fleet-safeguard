# Partie 3 - Logiciel local SCANDIAG Bridge

## Objectif

Pour une connexion reelle au FACOM SCANDIAG, le choix le plus robuste est d'ajouter un logiciel local Windows entre le scanner et la PWA.

Architecture :

```text
FACOM SCANDIAG Bluetooth
        |
        v
Logiciel local Python / Bleak
        |
        v
WebSocket ws://localhost:8765
        |
        v
PWA Monitoring EV
```

Ce pont local contourne les limites de Web Bluetooth dans le navigateur et permet de scanner plus facilement les services GATT, lister les characteristics, puis relayer les mesures en JSON vers l'interface web.

## Installation

```powershell
cd bridge
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Scanner le SCANDIAG

```powershell
python scandiag_bridge.py --scan-only
```

Le logiciel cherche par defaut les appareils dont le nom commence par :

```text
FACOM_SCANDIAG_
```

## Lister les services GATT

```powershell
python scandiag_bridge.py --list-services
```

Cette commande se connecte au premier SCANDIAG trouve et affiche les services et characteristics. Il faut reperer une characteristic avec `notify` ou `indicate`.

## Ecouter les mesures

Une fois la characteristic identifiee :

```powershell
python scandiag_bridge.py --characteristic-uuid "UUID_CHARACTERISTIC_NOTIFY"
```

Si le service UUID est necessaire par la pile BLE, le renseigner aussi :

```powershell
python scandiag_bridge.py --service-uuid "UUID_SERVICE" --characteristic-uuid "UUID_CHARACTERISTIC_NOTIFY"
```

## Cas Bluetooth Classic / port COM

Si Windows voit l'appareil, par exemple sous un nom de serie `LSG...`, mais que le scan BLE ne le liste pas avec son nom, le SCANDIAG peut exposer un profil Bluetooth Classic SPP. Dans ce cas, Windows cree un port serie virtuel.

Lister les ports :

```powershell
python scandiag_bridge.py --list-serial
```

Exemple observe :

```text
COM5 | Lien serie sur Bluetooth standard | BTHENUM\{00001101-0000-1000-8000-00805F9B34FB}
```

Le UUID `00001101-0000-1000-8000-00805F9B34FB` correspond au profil Serial Port Profile. Pour tester :

```powershell
python scandiag_bridge.py --serial-port COM5 --serial-baudrate 9600
```

Si aucune mesure ne remonte, tester les vitesses courantes `19200`, `38400`, `57600` puis `115200`.

## Brancher la PWA

1. Lancer le bridge.
2. Ouvrir la PWA.
3. Cliquer `Connecter Logiciel Local`.

La PWA ecoute :

```text
ws://localhost:8765
```

## Mode simulation logiciel

Pour tester toute la chaine sans appareil :

```powershell
python scandiag_bridge.py --simulate
```
