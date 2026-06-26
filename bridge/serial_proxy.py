import argparse
import datetime as dt
import threading
import time

import serial
import serial.tools.list_ports


def build_parser():
    parser = argparse.ArgumentParser(
        description="Proxy serie pour capturer FACOM -> COM virtuel -> proxy -> COM SCANDIAG."
    )
    parser.add_argument("--facom-port", help="Port cote proxy relie au port virtuel utilise par FACOM, ex: COM11.")
    parser.add_argument("--device-port", help="Port Bluetooth reel du SCANDIAG, ex: COM4.")
    parser.add_argument("--baudrate", type=int, default=9600)
    parser.add_argument("--facom-baudrate", type=int)
    parser.add_argument("--device-baudrate", type=int)
    parser.add_argument("--timeout", type=float, default=0.05)
    parser.add_argument("--log", default="serial-proxy.log")
    parser.add_argument("--list", action="store_true", help="Lister les ports COM et quitter.")
    return parser


def list_ports():
    ports = list(serial.tools.list_ports.comports())
    if not ports:
        print("Aucun port COM detecte.")
        return

    print("Ports COM detectes:")
    for port in ports:
        print(f"- {port.device} | {port.description} | {port.hwid}")


def main():
    args = build_parser().parse_args()

    if args.list:
        list_ports()
        return

    if not args.facom_port or not args.device_port:
        raise SystemExit("Renseigner --facom-port et --device-port, ou utiliser --list pour afficher les ports.")

    facom_baudrate = args.facom_baudrate or args.baudrate
    device_baudrate = args.device_baudrate or args.baudrate

    print("Proxy serie FACOM actif")
    print(f"FACOM virtuel : {args.facom_port} @ {facom_baudrate}")
    print(f"SCANDIAG reel : {args.device_port} @ {device_baudrate}")
    print(f"Log           : {args.log}")

    with serial.Serial(args.facom_port, facom_baudrate, timeout=args.timeout) as facom_port:
        with serial.Serial(args.device_port, device_baudrate, timeout=args.timeout) as device_port:
            stop_event = threading.Event()
            threads = [
                threading.Thread(
                    target=pipe,
                    args=(facom_port, device_port, "FACOM -> SCANDIAG", args.log, stop_event),
                    daemon=True,
                ),
                threading.Thread(
                    target=pipe,
                    args=(device_port, facom_port, "SCANDIAG -> FACOM", args.log, stop_event),
                    daemon=True,
                ),
            ]

            for thread in threads:
                thread.start()

            try:
                while True:
                    time.sleep(0.2)
            except KeyboardInterrupt:
                stop_event.set()
                print("\nProxy serie arrete.")


def pipe(source, target, label, log_path, stop_event):
    while not stop_event.is_set():
        try:
            waiting = source.in_waiting
            data = source.read(waiting or 1)
            if not data:
                continue

            target.write(data)
            target.flush()
            log_frame(log_path, label, data)
        except serial.SerialException as error:
            log_text(log_path, label, f"ERREUR SERIE: {error}")
            stop_event.set()
            return


def log_frame(path, label, data):
    hex_data = " ".join(f"{byte:02X}" for byte in data)
    ascii_data = "".join(chr(byte) if 32 <= byte <= 126 else "." for byte in data)
    log_text(path, label, f"{hex_data} | {ascii_data}")


def log_text(path, label, text):
    timestamp = dt.datetime.now().isoformat(timespec="milliseconds")
    line = f"{timestamp} | {label:<18} | {text}"
    print(line)
    with open(path, "a", encoding="utf-8") as file:
        file.write(line + "\n")


if __name__ == "__main__":
    main()
