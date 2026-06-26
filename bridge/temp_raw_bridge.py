import argparse
import asyncio
import json
import statistics
from datetime import datetime
from pathlib import Path

import websockets


DEFAULT_RAW_PATH = r"C:\ProgramData\Facom\ScanDiag\temp.raw"
clients = set()
sequence_reset_requested = False


def build_parser():
    parser = argparse.ArgumentParser(
        description="Surveille temp.raw produit par FACOM ScanDiag et relaie des scans vers la PWA."
    )
    parser.add_argument("--path", default=DEFAULT_RAW_PATH)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--poll", type=float, default=0.5)
    parser.add_argument("--emit-existing", action="store_true", help="Envoyer aussi le temp.raw deja present au demarrage.")
    parser.add_argument("--wheels", default="FL,FR,RL,RR", help="Ordre des roues a alimenter dans la PWA.")
    return parser


async def websocket_handler(websocket):
    clients.add(websocket)
    await websocket.send(json.dumps({
        "type": "status",
        "label": "Lecture FACOM temp.raw",
        "detail": "SURVEILLANCE ACTIVE"
    }))

    try:
        async for raw_message in websocket:
            handle_client_message(raw_message)
    finally:
        clients.discard(websocket)


def handle_client_message(raw_message):
    global sequence_reset_requested

    try:
        message = json.loads(raw_message)
    except json.JSONDecodeError:
        return

    if message.get("type") in {"reset_sequence", "new_analysis"}:
        sequence_reset_requested = True


async def broadcast(message):
    payload = json.dumps(message, ensure_ascii=False)
    dead = []

    for websocket in clients:
        try:
            await websocket.send(payload)
        except websockets.ConnectionClosed:
            dead.append(websocket)

    for websocket in dead:
        clients.discard(websocket)


async def watch_raw(path, poll, emit_existing, wheels):
    global sequence_reset_requested

    last_signature = None
    wheel_index = 0
    if not emit_existing:
        try:
            stat = path.stat()
            last_signature = (stat.st_mtime_ns, stat.st_size)
        except OSError:
            last_signature = None

    while True:
        if sequence_reset_requested:
            wheel_index = 0
            sequence_reset_requested = False

        try:
            stat = path.stat()
            signature = (stat.st_mtime_ns, stat.st_size)
        except OSError:
            await asyncio.sleep(poll)
            continue

        if signature != last_signature:
            last_signature = signature
            wheel = wheels[wheel_index % len(wheels)]
            wheel_index += 1
            scan = parse_raw_scan(path, wheel)
            if scan:
                await broadcast(scan)

        await asyncio.sleep(poll)


def parse_raw_scan(path, wheel):
    data = path.read_bytes()

    if len(data) <= 12:
        return None

    payload = data[12:]
    values = [value for value in payload if value not in (0, 255)]

    if not values:
        return None

    # POC heuristic: temp.raw is a profile matrix, not the final human report.
    # We transform profile spread into stable demo metrics until the vendor
    # report/export format is identified.
    median = statistics.median(values)
    low_band = percentile(values, 25)
    high_band = percentile(values, 95)
    spread = max(0, high_band - median)
    tire = clamp(round(spread / 12.0, 1), 1.0, 8.0)

    return {
        "type": "scan",
        "source": "FACOM temp.raw",
        "time": datetime.now().isoformat(),
        "wheel": wheel,
        "scanner": f"SC{wheel}",
        "tire": tire,
        "rawText": f"temp.raw bytes={len(data)} p25={low_band} median={median} p95={high_band}"
    }


def percentile(values, percent):
    ordered = sorted(values)
    index = min(len(ordered) - 1, round((percent / 100) * (len(ordered) - 1)))
    return ordered[index]


def clamp(value, minimum, maximum):
    return max(minimum, min(maximum, value))


async def main():
    args = build_parser().parse_args()
    path = Path(args.path)
    wheels = [wheel.strip().upper() for wheel in args.wheels.split(",") if wheel.strip()]
    if not wheels:
        raise SystemExit("La liste --wheels ne peut pas etre vide.")

    async with websockets.serve(websocket_handler, args.host, args.port):
        print(f"Pont temp.raw actif: ws://{args.host}:{args.port}")
        print(f"Surveillance: {path}")
        print(f"Ordre roues: {', '.join(wheels)}")
        await watch_raw(path, args.poll, args.emit_existing, wheels)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nPont temp.raw arrete.")
