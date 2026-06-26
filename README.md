# FACOM EV Fleet Safeguard

Livrables disponibles :

- Documentation Partie 1 : `docs/partie-1-connexion-scandiag.md`
- Prompt Partie 2 : `docs/partie-2-prompt-pwa-monitoring.md`
- Logiciel local Partie 3 : `docs/partie-3-logiciel-local.md`
- Notes reverse engineering : `docs/reverse-engineering-scandiag.md`
- Proxy COM virtuel : `docs/option-2-proxy-com-virtuel.md`
- Mode FACOM arriere-plan : `docs/mode-facom-arriere-plan.md`
- Livrable final connexion : `docs/livrable-final-connexion-scandiag.md`
- PWA Monitoring EV avec simulation et Web Bluetooth : `app/index.html`

## Lancer le POC

Web Bluetooth exige un contexte securise. Le plus simple en local :

```powershell
python -m http.server 5173 -d app
```

Puis ouvrir :

```text
http://localhost:5173
```

Renseigner ensuite les UUID BLE du service et de la caracteristique identifies pendant le reverse engineering du SCANDIAG.

## Lancer le logiciel local

```powershell
cd bridge
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python scandiag_bridge.py --list-services
```

Puis ouvrir la PWA et cliquer `Connecter Logiciel Local`.

## Trouver les sorties du logiciel FACOM

Juste apres un scan dans le logiciel officiel :

```powershell
cd bridge
.\.venv\Scripts\Activate.ps1
python find_facom_outputs.py --minutes 10
```

Si `temp.raw` est mis a jour par FACOM :

```powershell
python temp_raw_bridge.py --plate AY-389-IM
```

## Mode stable avec FACOM en arriere-plan

Pendant la demo, le mode le plus fiable est de laisser FACOM ouvert/minimise pour garder le SCANDIAG initialise, puis d'utiliser la PWA comme interface principale :

```powershell
cd bridge
.\.venv\Scripts\Activate.ps1
python temp_raw_bridge.py --plate AY-389-IM
```

La PWA recoit automatiquement une mesure quand FACOM met a jour `C:\ProgramData\Facom\ScanDiag\temp.raw`.

## Utilisation finale sans logiciel FACOM

Apres capture de la commande proprietaire avec le proxy COM virtuel :

```powershell
cd bridge
.\.venv\Scripts\Activate.ps1
python scandiag_bridge.py --serial-port COM4 --serial-baudrate 9600 --trigger-write-hex "AA BB CC DD"
```

Remplacer `AA BB CC DD` par la trame reelle trouvee dans `serial-proxy.log`.
Dans la PWA, cliquer ensuite `Connecter le logiciel local`, puis `Mesure SCANDIAG`.
