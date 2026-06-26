# FACOM EV Fleet Safeguard

Livrables disponibles :

- Documentation Partie 1 : `docs/partie-1-connexion-scandiag.md`
- Prompt Partie 2 : `docs/partie-2-prompt-pwa-monitoring.md`
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
