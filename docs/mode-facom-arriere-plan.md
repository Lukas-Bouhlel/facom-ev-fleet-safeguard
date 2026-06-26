# Mode realiste - FACOM en arriere-plan

## Pourquoi ce mode

Le SCANDIAG communique avec le logiciel FACOM par un protocole proprietaire sur port serie Bluetooth SPP.

Le port `COM4` est bien accessible, mais les commandes exactes de configuration et de declenchement ne sont pas encore connues. Le proxy COM virtuel devait permettre de les capturer, mais si ce montage devient instable pendant le rush, le mode le plus fiable est :

```text
SCANDIAG -> logiciel FACOM officiel ouvert en arriere-plan -> fichier local temp.raw -> bridge Python -> PWA
```

L'operateur ne manipule pas FACOM pendant la demo. FACOM reste seulement ouvert pour garder le scanner initialise.

## Flux d'exploitation

1. Lancer le logiciel FACOM.
2. Connecter le SCANDIAG dans FACOM.
3. Choisir le mode de scan une seule fois.
4. Minimiser FACOM.
5. Lancer le bridge `temp_raw_bridge.py`.
6. Utiliser la PWA comme interface visible.

Quand une mesure est realisee avec l'outil, FACOM met a jour :

```text
C:\ProgramData\Facom\ScanDiag\temp.raw
```

Le bridge detecte la modification et envoie automatiquement une mesure a la PWA via :

```text
ws://localhost:8765
```

## Commandes

Terminal 1 - bridge local :

```powershell
cd C:\Users\lukas\OneDrive\Bureau\Portfolio\facom-ev-fleet-safeguard\bridge
.\.venv\Scripts\Activate.ps1
python temp_raw_bridge.py --wheels FL,FR,RL,RR
```

Terminal 2 - PWA :

```powershell
cd C:\Users\lukas\OneDrive\Bureau\Portfolio\facom-ev-fleet-safeguard
python -m http.server 5173 -d app
```

Puis ouvrir :

```text
http://localhost:5173
```

Dans la PWA :

1. saisir la plaque ;
2. cliquer `Connecter le logiciel local` ;
3. scanner les pneus dans l'ordre choisi ;
4. verifier que chaque roue se met a jour dans le plan vehicule.

Par defaut, l'ordre est :

```text
FL = avant gauche
FR = avant droite
RL = arriere gauche
RR = arriere droite
```

Si l'ordre terrain est different, changer le parametre :

```powershell
python temp_raw_bridge.py --wheels FL,RL,FR,RR
```

La plaque n'est pas transmise par la commande bridge : elle est saisie dans la PWA et utilisee pour creer l'analyse dans SQLite. Le bridge transmet uniquement la roue, les valeurs pneu/disque et l'heure de mesure.

## Positionnement pour le livrable

Ce mode est acceptable pour un POC car :

- le scanner reel est bien utilise ;
- le Bluetooth reel et le logiciel constructeur initialisent l'outil ;
- l'interface metier finale est la PWA ;
- les donnees remontent automatiquement sans ressaisie ;
- la simulation reste disponible si l'appareil ou FACOM bloque pendant la presentation.

La limite est transparente : tant que le protocole proprietaire FACOM n'est pas completement decode, la PWA ne declenche pas elle-meme le laser. Elle consomme les resultats produits localement par l'ecosysteme officiel.

## Evolution cible

Le mode completement autonome reste :

```text
PWA -> bridge Python -> COM4 -> SCANDIAG
```

Pour l'atteindre, il faudra capturer les trames proprietaires envoyees par FACOM puis les rejouer avec :

```powershell
python scandiag_bridge.py --serial-port COM4 --serial-baudrate 9600 --trigger-write-hex "TRAME_CAPTUREE"
```
