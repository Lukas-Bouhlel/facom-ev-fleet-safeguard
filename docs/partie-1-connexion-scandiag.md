# Partie 1 - Documentation technique de connexion SCANDIAG

## Objectif

Cette partie décrit comment l'application web communique avec le SCANDIAG / DX.TSCAN afin de recuperer les mesures en temps reel. Le SCANDIAG est considere comme un peripherique Bluetooth Low Energy (BLE) expose par le navigateur via l'API Web Bluetooth.

Sources projet :

- Declaration de conformite FACOM DX.TSCAN : `DoC/DOC-DX.TSCAN_FR.pdf`
- Manuel constructeur fourni : `Manuals/FINAL man laser examiner FAC08233 EANZ.pdf`

La declaration de conformite confirme que le produit est un analyseur de disques de freins et de pneus FACOM DX.TSCAN, soumis a la directive europeenne radio RED 2014/53/UE. Les UUID BLE exacts ne sont pas fournis dans les documents disponibles : ils doivent donc etre releves pendant la phase de reverse engineering BLE.

## Principe BLE

Le SCANDIAG agit comme un peripherique BLE. Il diffuse un signal d'advertising, puis expose une arborescence GATT :

- Device : appareil physique SCANDIAG.
- Service : groupe logique de fonctions BLE.
- Characteristic : canal de lecture, ecriture ou notification.
- Notification : emission automatique d'une valeur par le peripherique lorsque la mesure change.

Dans le POC, l'application web :

1. Lance le scan Bluetooth natif du navigateur.
2. Filtre les appareils dont le nom commence par `FACOM_SCANDIAG_`.
3. Se connecte au serveur GATT de l'appareil choisi.
4. Ouvre le service et la caracteristique mappes.
5. Active les notifications.
6. Decode chaque trame recue pour extraire la profondeur mesuree.

## Identification de l'appareil

Comportement attendu :

- Nom d'advertising : `FACOM_SCANDIAG_XXXX`
- Mode couplage : appareil allume, LED bleue clignotante
- Portee de test : appareil proche du poste, batterie chargee
- Navigateur cible : Chrome ou Edge desktop Android/Windows avec Web Bluetooth

Exemple de filtre Web Bluetooth :

```js
await navigator.bluetooth.requestDevice({
  filters: [{ namePrefix: "FACOM_SCANDIAG_" }],
  optionalServices: [SCANDIAG_SERVICE_UUID]
});
```

## Reverse engineering BLE

Les UUID du service et de la caracteristique doivent etre captures avant l'integration finale.

Procedure recommandee :

1. Allumer le SCANDIAG en mode appairage.
2. Ouvrir un outil de scan BLE, par exemple nRF Connect sur mobile ou Chrome `chrome://bluetooth-internals`.
3. Reperer l'appareil dont le nom commence par `FACOM_SCANDIAG_`.
4. Se connecter a l'appareil.
5. Lister les services GATT et leurs caracteristiques.
6. Identifier la caracteristique qui change lors d'une mesure laser.
7. Noter :
   - UUID du service.
   - UUID de la caracteristique.
   - Proprietes BLE : `notify`, `read`, eventuellement `write`.
   - Format des donnees : hexadecimal, ASCII, JSON brut ou binaire proprietaire.
8. Reporter ces UUID dans la configuration de l'application POC.

Important : Web Bluetooth impose de declarer les services accessibles au moment du scan. Si le SCANDIAG utilise un service proprietaire, son UUID doit etre connu et ajoute a `optionalServices` avant de pouvoir lire ses caracteristiques dans le navigateur.

## Capture des donnees

Quand une mesure est effectuee, le SCANDIAG emet une notification BLE sur la caracteristique cible. L'application recoit un `DataView` contenant la trame brute.

Exemples de formats possibles :

```text
Hexadecimal : 02 34 2E 35 6D 6D 03
ASCII       : 4.5mm
JSON brut   : {"depth":4.5,"unit":"mm"}
Binaire     : uint16 little-endian, valeur en dixiemes de millimetre
```

Le POC conserve volontairement trois niveaux d'information :

- `rawHex` : trame brute en hexadecimal, utile pour le reverse engineering.
- `rawText` : tentative de decodage texte UTF-8.
- `measurement` : valeur numerique extraite si le format est reconnu.

## Pseudo-code de connexion

```js
const device = await navigator.bluetooth.requestDevice({
  filters: [{ namePrefix: "FACOM_SCANDIAG_" }],
  optionalServices: [serviceUuid]
});

const server = await device.gatt.connect();
const service = await server.getPrimaryService(serviceUuid);
const characteristic = await service.getCharacteristic(characteristicUuid);

await characteristic.startNotifications();

characteristic.addEventListener("characteristicvaluechanged", event => {
  const value = event.target.value;
  const frame = decodeFrame(value);
  updateMeasurement(frame);
});
```

## Decodage des trames

Le decodeur doit rester tolerant pendant le reverse engineering :

- afficher systematiquement l'hexadecimal ;
- tenter un decodage texte ;
- detecter un JSON si la trame commence par `{` ;
- extraire une valeur numerique si le texte contient `4.5`, `4.5mm` ou `depth=4.5` ;
- conserver les trames non reconnues dans le journal.

Une fois le format confirme, le decodeur peut etre verrouille sur le protocole exact.

## Contraintes navigateur

- Web Bluetooth fonctionne uniquement en contexte securise : `https://` ou `http://localhost`.
- L'utilisateur doit declencher le scan par une action explicite, par exemple un bouton.
- Le navigateur affiche toujours une fenetre native de selection Bluetooth.
- iOS Safari ne supporte pas Web Bluetooth de maniere exploitable pour ce POC.
- Les UUID proprietaires doivent etre connus avant l'acces aux services GATT depuis la PWA.

## Critere de validation du POC

Le POC est valide si :

- l'appareil `FACOM_SCANDIAG_XXXX` apparait dans la fenetre de scan ;
- la connexion GATT s'etablit ;
- la caracteristique cible active les notifications ;
- chaque mesure laser produit une nouvelle trame dans le journal ;
- la profondeur est affichee en millimetres lorsque le format est reconnu.

## Configuration attendue dans l'application

```js
const DEFAULT_CONFIG = {
  namePrefix: "FACOM_SCANDIAG_",
  serviceUuid: "a-renseigner-apres-scan-ble",
  characteristicUuid: "a-renseigner-apres-scan-ble"
};
```

Les valeurs finales des UUID devront etre remplacees apres capture sur un SCANDIAG reel.
