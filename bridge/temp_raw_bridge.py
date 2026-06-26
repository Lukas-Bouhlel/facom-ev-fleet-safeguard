import argparse
import asyncio
import json
import statistics
from datetime import datetime
from pathlib import Path

import websockets


DEFAULT_RAW_PATH = r"C:\ProgramData\Facom\ScanDiag\temp.raw"
clients = set()


def build_parser():
    parser = argparse.ArgumentParser(
        description="Surveille temp.raw produit par FACOM ScanDiag et relaie des scans vers la PWA."
    )
    parser.add_argument("--path", default=DEFAULT_RAW_PATH)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--plate", default=None)
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
        async for _ in websocket:
            pass
    finally:
        clients.discard(websocket)


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


async def watch_raw(path, plate, poll, emit_existing, wheels):
    last_signature = None
    wheel_index = 0
    if not emit_existing:
        try:
            stat = path.stat()
            last_signature = (stat.st_mtime_ns, stat.st_size)
        except OSError:
            last_signature = None

    while True:
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
            scan = parse_raw_scan(path, plate, wheel)
            if scan:
                await broadcast(scan)

        await asyncio.sleep(poll)


def parse_raw_scan(path, plate, wheel):
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
    high_band = percentile(values, 90)
    spread = max(0, high_band - median)
    tire = clamp(round(spread / 2.5, 1), 1.0, 8.0)
    disk = clamp(round((median / 4.0), 1), 1.0, 4.0)

    return {
        "type": "scan",
        "source": "FACOM temp.raw",
        "time": datetime.now().isoformat(),
        "plate": plate,
        "wheel": wheel,
        "scanner": f"SC{wheel}",
        "tire": tire,
        "disk": disk,
        "rawText": f"temp.raw bytes={len(data)} median={median} p90={high_band}"
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
        await watch_raw(path, args.plate, args.poll, args.emit_existing, wheels)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nPont temp.raw arrete.")
