# FACOM EV Fleet Safeguard

PWA de supervision pour le controle des pneus de vehicules de livraison et de flottes logistiques lourdes, basee sur le FACOM SCANDIAG.

Le projet detourne l'usage initial de l'outil FACOM pour en faire un capteur de controle d'entrepot. Le materiel et le firmware d'origine sont conserves : la mesure laser reste effectuee par le SCANDIAG. Le hack se situe dans la couche logicielle : recuperer les analyses de pneus produites par l'ecosysteme FACOM, les transmettre a une PWA, puis les historiser par vehicule dans un dashboard exploitable par un responsable de flotte.

## Problematique

En 2026, l'usure prematuree des pneus des vehicules de livraison devient un sujet critique pour les flottes intensives. Les vehicules tournent toute la journee, entrent et sortent des entrepots, et repartent souvent rapidement pour de nouvelles tournees.

Pour des entreprises comme DHL, Amazon, Chronopost, UPS ou des prestataires logistiques, le risque est double :

- securite : un pneu use augmente le risque d'accident, surtout sur des vehicules charges ;
- exploitation : un vehicule defectueux immobilise trop tard perturbe les tournees ;
- cout : une maintenance reactive coute plus cher qu'une prevention planifiee ;
- tracabilite : il faut savoir quel vehicule a ete controle, quand, et dans quel etat.

Le besoin metier est donc simple : verifier rapidement l'etat des pneus des vehicules qui rentrent a l'entrepot avant de les renvoyer en livraison.

## Solution

FACOM EV Fleet Safeguard transforme le SCANDIAG en outil de controle semi-fixe d'entrepot.

Le flux cible du POC est le suivant :

```text
Vehicule entrant
      |
      v
Scan des pneus avec FACOM SCANDIAG
      |
      v
Logiciel FACOM initialise l'outil et produit l'analyse
      |
      v
Bridge local Python detecte la nouvelle mesure
      |
      v
PWA Monitoring EV
      |
      v
Historique SQLite + dashboard flotte
```

L'operateur saisit la plaque du vehicule dans la PWA, puis scanne les pneus un par un. A chaque nouvelle analyse, la PWA met a jour la roue correspondante. Une fois les quatre pneus mesures, l'analyse reste enregistree et peut etre retrouvee dans le tableau de bord.

Le POC couvre actuellement uniquement les pneus. Les mesures de freins/disques ne sont pas exploitees dans cette version.

## Fonctionnalites

- Saisie manuelle de la plaque d'immatriculation.
- Creation automatique d'une analyse des que la plaque est validee.
- Recuperation automatique des mesures de pneus issues de FACOM.
- Association des mesures aux roues : avant gauche, avant droite, arriere gauche, arriere droite.
- Calcul de statut : conforme, vigilance, critique.
- Sauvegarde locale via SQLite embarquee avec `sql.js`.
- Persistance dans le navigateur via IndexedDB.
- Dashboard historique avec recherche par plaque et filtres par statut.
- Consultation detaillee des anciennes analyses.
- Mode bridge local pour relier le logiciel FACOM a la PWA.

## Architecture technique

```text
app/
  index.html              Interface PWA
  app.js                  Logique metier, analyse, dashboard
  db.js                   Base SQLite via sql.js
  manifest.webmanifest    Installation PWA
  service-worker.js       Cache PWA basique

bridge/
  temp_raw_bridge.py      Bridge stable FACOM -> PWA
  scandiag_bridge.py      Bridge Bluetooth/serie experimental
  serial_proxy.py         Proxy COM pour reverse engineering
  requirements.txt        Dependances Python

docs/
  Documentation technique et notes de reverse engineering
```

Le mode stable utilise `temp_raw_bridge.py`. Le logiciel FACOM reste ouvert en arriere-plan pour initialiser le scanner et produire le fichier de mesure local. Le bridge surveille ensuite les nouvelles analyses et les transmet en WebSocket a la PWA.

## Manuel d'utilisation

### 1. Installer et connecter le SCANDIAG

1. Installer le logiciel officiel FACOM SCANDIAG sur le PC Windows.
2. Installer les drivers Bluetooth recommandes par FACOM si necessaire.
3. Allumer le SCANDIAG.
4. Appairer le SCANDIAG dans Windows.
5. Ouvrir le logiciel FACOM.
6. Connecter le SCANDIAG dans le logiciel FACOM.
7. Choisir le mode d'analyse pneu.
8. Laisser le logiciel FACOM ouvert, puis le minimiser.

FACOM sert ici a garder l'outil initialise. L'interface visible pour l'operateur est ensuite la PWA.

### 2. Installer le bridge local

Dans un terminal PowerShell :

```powershell
cd C:\Users\lukas\OneDrive\Bureau\Portfolio\facom-ev-fleet-safeguard\bridge
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

### 3. Lancer le bridge

Toujours dans `bridge` :

```powershell
.\.venv\Scripts\Activate.ps1
python temp_raw_bridge.py
```

Par defaut, l'ordre de scan est :

```text
FL = avant gauche
FR = avant droite
RL = arriere gauche
RR = arriere droite
```

Si l'ordre terrain est different :

```powershell
python temp_raw_bridge.py --wheels FL,RL,FR,RR
```

### 4. Lancer la PWA

Dans un deuxieme terminal :

```powershell
cd C:\Users\lukas\OneDrive\Bureau\Portfolio\facom-ev-fleet-safeguard
python -m http.server 5173 -d app
```

Ouvrir ensuite :

```text
http://localhost:5173
```

### 5. Realiser une analyse vehicule

1. Saisir la plaque d'immatriculation du vehicule.
2. Cliquer sur `Demarrer le scan`.
3. Cliquer sur `Connecter le logiciel local`.
4. Scanner les pneus avec le SCANDIAG dans l'ordre configure.
5. Verifier que chaque roue se met a jour dans la PWA.
6. Une fois les quatre pneus analyses, l'analyse est conservee dans le dashboard.

Pour passer au vehicule suivant :

1. Cliquer sur `Nouveau vehicule`.
2. Saisir une nouvelle plaque.
3. Recommencer le scan des pneus.

L'analyse precedente reste sauvegardee automatiquement.

## Dashboard et historique

Le tableau de bord permet de retrouver les analyses precedentes :

- recherche par plaque ;
- filtre par statut ;
- tri par immatriculation, etat ou horodatage ;
- ouverture d'une analyse pour revoir les pneus mesures.

La base est geree en SQLite cote navigateur grace a `sql.js`, puis persistee dans IndexedDB. Les donnees restent donc disponibles dans le meme navigateur apres un rechargement de page.

## Limites actuelles

- Le POC analyse uniquement les pneus.
- La plaque est saisie manuellement dans la PWA.
- Le logiciel FACOM doit rester ouvert en arriere-plan pour initialiser le SCANDIAG.
- La lecture autonome directe du protocole SCANDIAG n'est pas finalisee, car le protocole serie proprietaire FACOM doit encore etre completement decode.
- Les donnees sont persistees localement dans le navigateur, pas encore synchronisees avec un serveur central.

## Perspectives d'avenir

Plusieurs evolutions sont possibles :

- lecture automatique des plaques via camera ou OCR ;
- synchronisation des analyses vers une base serveur centralisee ;
- ajout d'un module IA ou algorithmique pour detecter les vehicules qui s'usent le plus vite ;
- prediction de maintenance selon l'historique du vehicule ;
- scoring flotte pour identifier les vehicules a risque ;
- alertes automatiques pour le responsable d'exploitation ;
- export CSV/PDF pour les rapports de controle ;
- suppression du logiciel FACOM en arriere-plan apres reverse engineering complet du protocole ;
- extension future aux freins/disques si les donnees sont exposees de maniere fiable.

## Conclusion

FACOM EV Fleet Safeguard repond a une problematique concrete de controle de flottes logistiques : verifier rapidement l'etat des pneus des vehicules avant leur retour en tournee.

Le projet conserve la precision du SCANDIAG et ajoute une couche metier adaptee a l'entrepot : suivi par plaque, dashboard, historique, statuts de risque et supervision de flotte.

Dans sa version actuelle, le POC demontre une chaine fonctionnelle de bout en bout pour les pneus : mesure reelle avec l'outil FACOM, recuperation locale, affichage PWA et historisation des analyses.

## Livrables disponibles

- Documentation Partie 1 : `docs/partie-1-connexion-scandiag.md`
- Prompt Partie 2 : `docs/partie-2-prompt-pwa-monitoring.md`
- Logiciel local Partie 3 : `docs/partie-3-logiciel-local.md`
- Notes reverse engineering : `docs/reverse-engineering-scandiag.md`
- Proxy COM virtuel : `docs/option-2-proxy-com-virtuel.md`
- Mode FACOM arriere-plan : `docs/mode-facom-arriere-plan.md`
- Livrable final connexion : `docs/livrable-final-connexion-scandiag.md`
- Screens displonibles : `docs/screens`
