import argparse
import asyncio
import json
import re
import signal
from datetime import datetime

from bleak import BleakClient, BleakScanner
import serial
import serial.tools.list_ports
import websockets


DEFAULT_NAME_PREFIX = "FACOM_SCANDIAG_"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8765

clients = set()


def build_parser():
    parser = argparse.ArgumentParser(
        description="Pont local FACOM SCANDIAG vers la PWA de monitoring."
    )
    parser.add_argument("--name-prefix", default=DEFAULT_NAME_PREFIX)
    parser.add_argument("--all-devices", action="store_true", help="Scanner tous les appareils visibles sans filtre de nom.")
    parser.add_argument("--address", help="Adresse Bluetooth de l'appareil si elle est connue.")
    parser.add_argument("--service-uuid", help="UUID du service GATT a utiliser.")
    parser.add_argument("--characteristic-uuid", help="UUID de la caracteristique a notifier.")
    parser.add_argument("--host", default=DEFAULT_HOST)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--scan-timeout", type=float, default=10)
    parser.add_argument("--scan-only", action="store_true")
    parser.add_argument("--list-services", action="store_true")
    parser.add_argument("--list-serial", action="store_true", help="Lister les ports COM disponibles.")
    parser.add_argument("--serial-port", help="Lire le SCANDIAG via un port COM Bluetooth Classic, ex: COM5.")
    parser.add_argument("--serial-auto", action="store_true", help="Choisir automatiquement un port COM Bluetooth SPP.")
    parser.add_argument("--serial-baudrate", type=int, default=9600)
    parser.add_argument("--serial-debug", action="store_true", help="Afficher les octets recus sur le port serie.")
    parser.add_argument("--serial-write", action="append", default=[], help="Envoyer une commande ASCII au port serie.")
    parser.add_argument("--serial-write-hex", action="append", default=[], help="Envoyer une commande hex, ex: 02 53 43 41 4E 03.")
    parser.add_argument("--serial-crlf", action="store_true", help="Ajouter CRLF aux commandes ASCII envoyees.")
    parser.add_argument("--serial-log", help="Sauvegarder les trames recues dans un fichier.")
    parser.add_argument("--simulate", action="store_true")
    return parser


async def websocket_handler(websocket):
    clients.add(websocket)
    await websocket.send(json.dumps({
        "type": "status",
        "label": "Logiciel local connecte",
        "detail": "PONT LOCAL ACTIF"
    }))

    try:
        async for _ in websocket:
            pass
    finally:
        clients.discard(websocket)


def list_serial_ports():
    ports = list(serial.tools.list_ports.comports())

    if not ports:
        print("Aucun port COM detecte.")
        return []

    print("Ports COM detectes:")
    for port in ports:
        details = " | ".join(
            part for part in [
                port.device,
                port.description,
                port.hwid
            ] if part
        )
        print(f"- {details}")

    return ports


def choose_serial_port():
    ports = list_serial_ports()
    bluetooth_ports = [
        port for port in ports
        if "BTHENUM" in (port.hwid or "") or "Bluetooth" in (port.description or "")
    ]

    if not bluetooth_ports:
        raise RuntimeError("Aucun port COM Bluetooth detecte.")

    return bluetooth_ports[0].device


async def broadcast(message):
    payload = json.dumps(message, ensure_ascii=False)
    dead_clients = []

    for websocket in clients:
        try:
            await websocket.send(payload)
        except websockets.ConnectionClosed:
            dead_clients.append(websocket)

    for websocket in dead_clients:
        clients.discard(websocket)


async def scan_devices(name_prefix, timeout):
    devices = await BleakScanner.discover(timeout=timeout, return_adv=True)
    matches = []

    for device, advertisement in devices.values():
        name = device.name or advertisement.local_name or ""
        if not name_prefix or name.startswith(name_prefix):
            matches.append((device, advertisement))

    return matches


async def choose_device(args):
    if args.address:
        return args.address

    name_prefix = "" if args.all_devices else args.name_prefix
    target = "tous les appareils visibles" if args.all_devices else f"prefixe {name_prefix!r}"
    print(f"Scan Bluetooth pendant {args.scan_timeout:.0f}s avec {target}...", flush=True)
    await broadcast({
        "type": "status",
        "label": "Scan Bluetooth...",
        "detail": "RECHERCHE SCANDIAG"
    })

    matches = await scan_devices(name_prefix, args.scan_timeout)

    if not matches:
        raise RuntimeError(f"Aucun appareil trouve avec {target}.")

    print("Appareils trouves:")
    for index, (device, advertisement) in enumerate(matches, start=1):
        uuids = ", ".join(advertisement.service_uuids or [])
        print(f"{index}. {device.name or advertisement.local_name} | {device.address} | {uuids}")

    return matches[0][0].address


async def print_services(client):
    services = client.services
    print("\nServices GATT detectes:")

    for service in services:
        print(f"- Service {service.uuid}")
        for characteristic in service.characteristics:
            props = ", ".join(characteristic.properties)
            print(f"  - Characteristic {characteristic.uuid} [{props}]")


async def connect_scandiag(args):
    address = await choose_device(args)

    if args.scan_only:
        await broadcast({
            "type": "status",
            "label": "SCANDIAG detecte",
            "detail": address
        })
        return

    await broadcast({
        "type": "status",
        "label": "Connexion BLE...",
        "detail": address
    })

    async with BleakClient(address) as client:
        await broadcast({
            "type": "status",
            "label": "Connecte (BLE local)",
            "detail": "SCANDIAG CONNECTE"
        })

        if args.list_services or not args.characteristic_uuid:
            await print_services(client)

        if not args.characteristic_uuid:
            await broadcast({
                "type": "error",
                "title": "UUID caracteristique manquant",
                "detail": "Copier une characteristic notify depuis la console, puis relancer avec --characteristic-uuid."
            })
            return

        def on_notification(_, data):
            message = decode_frame(data)
            asyncio.create_task(broadcast(message))

        await client.start_notify(args.characteristic_uuid, on_notification)
        print(f"Notifications actives sur {args.characteristic_uuid}")

        try:
            await asyncio.Event().wait()
        finally:
            await client.stop_notify(args.characteristic_uuid)


async def read_serial(args):
    if args.serial_auto:
        args.serial_port = choose_serial_port()
    else:
        list_serial_ports()

    loop = asyncio.get_running_loop()
    await broadcast({
        "type": "status",
        "label": "Connexion COM...",
        "detail": args.serial_port
    })

    def worker():
        try:
            with serial.Serial(args.serial_port, args.serial_baudrate, timeout=1) as port:
                print(f"Lecture {args.serial_port} a {args.serial_baudrate} bauds")
                send_startup_commands(port, args)
                buffer = bytearray()
                while True:
                    chunk = port.read(port.in_waiting or 1)
                    if not chunk:
                        if buffer:
                            flush_serial_buffer(buffer, args, loop)
                        continue

                    buffer.extend(chunk)

                    if args.serial_debug:
                        print(f"RX {args.serial_port}: {to_hex(chunk)}")

                    while b"\n" in buffer or b"\r" in buffer:
                        split_at = min(
                            index for index in [
                                buffer.find(b"\n"),
                                buffer.find(b"\r")
                            ] if index != -1
                        )
                        frame = bytes(buffer[:split_at])
                        del buffer[:split_at + 1]
                        if frame:
                            emit_serial_frame(frame, args, loop)

                    if len(buffer) >= 4 and not looks_like_text(buffer):
                        flush_serial_buffer(buffer, args, loop)
        except serial.SerialException as error:
            message = {
                "type": "error",
                "title": f"Port {args.serial_port} indisponible",
                "detail": str(error)
            }
            asyncio.run_coroutine_threadsafe(broadcast(message), loop)
            print(f"Erreur port serie: {error}")

    await asyncio.to_thread(worker)


def flush_serial_buffer(buffer, args, loop):
    frame = bytes(buffer)
    buffer.clear()
    emit_serial_frame(frame, args, loop)


def emit_serial_frame(frame, args, loop):
    if args.serial_debug:
        print(f"FRAME {args.serial_port}: {to_hex(frame)} | {frame!r}")

    if args.serial_log:
        with open(args.serial_log, "a", encoding="utf-8") as log_file:
            log_file.write(f"{datetime.now().isoformat()} {to_hex(frame)} {frame!r}\n")

    message = decode_frame(frame)
    asyncio.run_coroutine_threadsafe(broadcast(message), loop)


def send_startup_commands(port, args):
    for command in args.serial_write:
        payload = command.encode("utf-8")
        if args.serial_crlf:
            payload += b"\r\n"
        port.write(payload)
        print(f"TX {args.serial_port}: {to_hex(payload)} | {payload!r}")

    for command in args.serial_write_hex:
        payload = parse_hex_command(command)
        port.write(payload)
        print(f"TX {args.serial_port}: {to_hex(payload)} | {payload!r}")


def parse_hex_command(command):
    compact = command.replace("0x", "").replace(",", " ").replace(";", " ")
    parts = [part for part in compact.split() if part]
    return bytes(int(part, 16) for part in parts)


def looks_like_text(data):
    return all(byte in b"\r\n\t" or 32 <= byte <= 126 for byte in data)


def to_hex(data):
    return " ".join(f"{byte:02X}" for byte in data)


def decode_frame(data):
    raw_hex = " ".join(f"{byte:02X}" for byte in data)
    text = data.decode("utf-8", errors="ignore").replace("\x00", "").strip()
    payload = parse_payload(text)

    if payload is None and len(data) == 4:
        payload = {
            "tire": int.from_bytes(data[0:2], "little") / 10,
            "disk": int.from_bytes(data[2:4], "little") / 10
        }

    if payload is None:
        return {
            "type": "error",
            "title": "Trame non reconnue",
            "detail": raw_hex
        }

    return {
        "type": "scan",
        "source": "FACOM SCANDIAG",
        "rawHex": raw_hex,
        "rawText": text,
        **payload
    }


def parse_payload(text):
    if not text:
        return None

    if text.startswith("{"):
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return None

    plate = None
    plate_match = re.search(r"[A-Z]{2}-\d{3}-[A-Z]{2}", text, re.IGNORECASE)
    if plate_match:
        plate = plate_match.group(0).upper()

    tire = read_number(text, r"(?:pneu|tire|depth|value)\D*(-?\d+(?:[,.]\d+)?)")
    disk = read_number(text, r"(?:disque|disk|brake)\D*(-?\d+(?:[,.]\d+)?)")

    if tire is None and disk is None:
        return None

    return {
        "plate": plate,
        "tire": tire,
        "disk": disk
    }


def read_number(text, pattern):
    match = re.search(pattern, text, re.IGNORECASE)
    if not match:
        return None
    return float(match.group(1).replace(",", "."))


async def simulate_loop():
    samples = [
        {"plate": "AY-389-IM", "tire": 4.8, "disk": 1.7},
        {"plate": "JV-524-OE", "tire": 5.6, "disk": 2.4},
        {"plate": "OW-134-EU", "tire": 5.7, "disk": 1.3},
        {"plate": "QA-912-VE", "tire": 2.7, "disk": 2.1}
    ]
    index = 0

    while True:
        scan = samples[index % len(samples)]
        index += 1
        await broadcast({
            "type": "scan",
            "source": "Logiciel local",
            "time": datetime.now().isoformat(),
            **scan
        })
        await asyncio.sleep(4)


async def main():
    args = build_parser().parse_args()

    stop_event = asyncio.Event()
    loop = asyncio.get_running_loop()

    for signame in ("SIGINT", "SIGTERM"):
        if hasattr(signal, signame):
            try:
                loop.add_signal_handler(getattr(signal, signame), stop_event.set)
            except NotImplementedError:
                pass

    async with websockets.serve(websocket_handler, args.host, args.port):
        print(f"Pont local actif: ws://{args.host}:{args.port}")

        if args.list_serial:
            list_serial_ports()
            return

        if args.serial_port or args.serial_auto:
            worker = asyncio.create_task(read_serial(args))
        elif args.simulate:
            worker = asyncio.create_task(simulate_loop())
        else:
            worker = asyncio.create_task(connect_scandiag(args))

        if args.scan_only or (args.list_services and not args.characteristic_uuid):
            await worker
            return

        done, _ = await asyncio.wait(
            {worker, asyncio.create_task(stop_event.wait())},
            return_when=asyncio.FIRST_COMPLETED
        )

        for task in done:
            task.result()

        worker.cancel()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nPont local arrete.")
