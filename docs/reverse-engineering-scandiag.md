# Reverse engineering SCANDIAG

## Hypothese actuelle

Le SCANDIAG apparait dans Windows sous un nom de serie `LSG...` et expose un port Bluetooth serie SPP :

```text
00001101-0000-1000-8000-00805F9B34FB
```

Le port COM peut etre ouvert par le bridge, mais aucune mesure ne remonte quand le logiciel FACOM n'est pas actif. L'hypothese la plus probable est que le logiciel FACOM envoie une commande d'initialisation ou selectionne un mode de scan avant que l'appareil ne transmette les mesures.

## Plan propre

1. Appairer l'appareil avec le logiciel FACOM officiel.
2. Fermer le logiciel officiel.
3. Ouvrir le port COM avec le bridge en debug.
4. Tester si des trames arrivent.
5. Si rien n'arrive, capturer les echanges serie du logiciel officiel pour trouver la commande d'activation.
6. Rejouer cette commande avec le bridge.

## Commandes utiles

Lire et journaliser les trames :

```powershell
python scandiag_bridge.py --serial-port COM4 --serial-baudrate 9600 --serial-debug --serial-log scandiag-raw.log
```

Envoyer une commande ASCII :

```powershell
python scandiag_bridge.py --serial-port COM4 --serial-baudrate 9600 --serial-debug --serial-write "SCAN" --serial-crlf
```

Envoyer une commande hexadecimale :

```powershell
python scandiag_bridge.py --serial-port COM4 --serial-baudrate 9600 --serial-debug --serial-write-hex "02 53 43 41 4E 03"
```

## Ce qu'il faut capturer

Pendant que le logiciel FACOM fonctionne, identifier :

- la vitesse serie effective ;
- les octets envoyes par le PC au SCANDIAG au moment de la connexion ;
- les octets envoyes quand un type de scan est choisi ;
- les octets recus quand une mesure est faite.

Une fois ces trames connues, elles peuvent etre rejouees par le bridge local.

## Option 3 - Recuperer les sorties du logiciel FACOM

Si le logiciel FACOM sait scanner mais que le protocole serie n'est pas encore connu, le chemin le plus rapide consiste a recuperer les resultats ecrits localement par le logiciel officiel.

Juste apres un scan FACOM :

```powershell
python find_facom_outputs.py --minutes 10
```

Si le fichier trouve est un log, CSV ou texte contenant les mesures, le relayer vers la PWA :

```powershell
python tail_file_bridge.py "C:\chemin\vers\fichier.log"
```

Puis ouvrir la PWA et cliquer `Connecter Logiciel Local`.

### Cas observe : `temp.raw`

Le logiciel FACOM met a jour :

```text
C:\ProgramData\Facom\ScanDiag\temp.raw
```

Le fichier contient une matrice de profil brute. Pour une demonstration POC, le bridge peut surveiller ce fichier et generer un scan a chaque nouvelle capture :

```powershell
python temp_raw_bridge.py --plate AY-389-IM
```

Puis utiliser normalement le logiciel FACOM pour effectuer les mesures. Quand `temp.raw` est modifie, la PWA recoit un scan via `ws://localhost:8765`.
