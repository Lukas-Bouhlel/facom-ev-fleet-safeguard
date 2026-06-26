# FACOM EV Fleet Safeguard

Livrables disponibles :

- Documentation Partie 1 : `docs/partie-1-connexion-scandiag.md`
- Prompt Partie 2 : `docs/partie-2-prompt-pwa-monitoring.md`
- Logiciel local Partie 3 : `docs/partie-3-logiciel-local.md`
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
