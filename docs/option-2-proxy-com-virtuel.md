# Option 2 - Proxy COM virtuel

## Objectif

Capturer les commandes envoyees par le logiciel FACOM au SCANDIAG afin de pouvoir ensuite les rejouer depuis notre bridge.

Schema :

```text
Logiciel FACOM
      |
      v
COM10 virtuel
      |
      v
COM11 virtuel
      |
      v
serial_proxy.py
      |
      v
COM4 reel Bluetooth
      |
      v
SCANDIAG
```

Le logiciel FACOM croit parler au SCANDIAG via `COM10`. En realite, notre proxy lit `COM11`, journalise toutes les trames, puis les transmet au vrai `COM4`.

## Prerequis

Installer un outil de ports serie virtuels qui cree une paire de ports COM relies entre eux, par exemple :

- `COM10` cote logiciel FACOM ;
- `COM11` cote proxy Python.

Il faut ensuite configurer le logiciel FACOM pour utiliser `COM10` au lieu de `COM4`.

## Lister les ports

```powershell
cd bridge
.\.venv\Scripts\Activate.ps1
python serial_proxy.py --list
```

## Lancer le proxy

Exemple avec :

- `COM10` configure dans FACOM ;
- `COM11` ouvert par le proxy ;
- `COM4` port Bluetooth reel du SCANDIAG.

```powershell
python serial_proxy.py --facom-port COM11 --device-port COM4 --baudrate 9600 --log serial-proxy.log
```

Ensuite :

1. lancer le proxy ;
2. lancer le logiciel FACOM ;
3. connecter le SCANDIAG dans FACOM ;
4. choisir le type de scan ;
5. faire une mesure ;
6. ouvrir `serial-proxy.log`.

## Ce qu'il faut extraire

Dans le log :

- trames `FACOM -> SCANDIAG` au demarrage ;
- trames `FACOM -> SCANDIAG` lors du choix du mode de scan ;
- trames `FACOM -> SCANDIAG` juste avant une mesure ;
- trames `SCANDIAG -> FACOM` contenant la reponse de mesure.

Une fois ces commandes identifiees, elles pourront etre integrees dans `scandiag_bridge.py` pour que la PWA lance les scans sans le logiciel FACOM.
