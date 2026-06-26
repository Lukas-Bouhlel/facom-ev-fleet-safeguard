import argparse
import asyncio
import json
import re
from datetime import datetime
from pathlib import Path

import websockets


clients = set()


def build_parser():
    parser = argparse.ArgumentParser(
        description="Relaye un fichier log/CSV FACOM vers la PWA via WebSocket."
    )
    parser.add_argument("path")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--from-start", action="store_true")
    return parser


async def websocket_handler(websocket):
    clients.add(websocket)
    await websocket.send(json.dumps({
        "type": "status",
        "label": "Lecture fichier FACOM",
        "detail": "PONT LOCAL ACTIF"
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


async def follow_file(path, from_start):
    position = 0 if from_start else path.stat().st_size

    while True:
        try:
            with path.open("r", encoding="utf-8", errors="ignore") as file:
                file.seek(position)
                lines = file.readlines()
                position = file.tell()
        except OSError as error:
            await broadcast({
                "type": "error",
                "title": "Lecture fichier impossible",
                "detail": str(error)
            })
            await asyncio.sleep(2)
            continue

        for line in lines:
            scan = parse_scan(line)
            if scan:
                await broadcast(scan)

        await asyncio.sleep(1)


def parse_scan(line):
    tire = read_number(line, r"(?:pneu|tire|depth|value)\D*(-?\d+(?:[,.]\d+)?)")
    disk = read_number(line, r"(?:disque|disk|brake)\D*(-?\d+(?:[,.]\d+)?)")
    plate_match = re.search(r"[A-Z]{2}-\d{3}-[A-Z]{2}", line, re.IGNORECASE)

    if tire is None and disk is None:
        return None

    return {
        "type": "scan",
        "source": "FACOM fichier",
        "time": datetime.now().isoformat(),
        "plate": plate_match.group(0).upper() if plate_match else None,
        "tire": tire,
        "disk": disk
    }


def read_number(text, pattern):
    match = re.search(pattern, text, re.IGNORECASE)
    if not match:
        return None
    return float(match.group(1).replace(",", "."))


async def main():
    args = build_parser().parse_args()
    path = Path(args.path)

    async with websockets.serve(websocket_handler, args.host, args.port):
        print(f"Pont fichier actif: ws://{args.host}:{args.port}")
        print(f"Lecture: {path}")
        await follow_file(path, args.from_start)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\nPont fichier arrete.")
