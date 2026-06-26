import argparse
import os
from datetime import datetime, timedelta
from pathlib import Path


INTERESTING_SUFFIXES = {
    ".db",
    ".sqlite",
    ".sqlite3",
    ".json",
    ".xml",
    ".csv",
    ".txt",
    ".log",
    ".ini",
    ".dat"
}


def build_parser():
    parser = argparse.ArgumentParser(
        description="Trouve les fichiers modifies recemment par le logiciel FACOM/TEXA."
    )
    parser.add_argument("--minutes", type=int, default=15)
    parser.add_argument("--limit", type=int, default=80)
    parser.add_argument("--all", action="store_true", help="Inclure tous les types de fichiers.")
    parser.add_argument(
        "--wide",
        action="store_true",
        help="Scanner tout AppData/ProgramData. Par defaut, seuls les chemins FACOM/TEXA/SCANDIAG sont parcours."
    )
    return parser


def roots():
    candidates = [
        os.environ.get("APPDATA"),
        os.environ.get("LOCALAPPDATA"),
        r"C:\ProgramData"
    ]
    return [Path(path) for path in candidates if path and Path(path).exists()]


def is_interesting(path, include_all):
    return include_all or path.suffix.lower() in INTERESTING_SUFFIXES


def main():
    args = build_parser().parse_args()
    since = datetime.now() - timedelta(minutes=args.minutes)
    matches = []

    for root in target_roots(args.wide):
      for path in walk_files(root):
          try:
              stat = path.stat()
          except OSError:
              continue

          modified = datetime.fromtimestamp(stat.st_mtime)
          if modified < since or not is_interesting(path, args.all):
              continue

          matches.append((modified, stat.st_size, path))

    matches.sort(reverse=True, key=lambda item: item[0])

    if not matches:
        print(f"Aucun fichier interessant modifie depuis {args.minutes} min.")
        return

    for modified, size, path in matches[:args.limit]:
        print(f"{modified:%Y-%m-%d %H:%M:%S} | {size:>10} | {path}")


def walk_files(root):
    try:
        iterator = root.rglob("*")
        for path in iterator:
            if path.is_file():
                yield path
    except OSError:
        return


def target_roots(wide):
    if wide:
        return roots()

    keywords = ("facom", "texa", "scandiag", "scan")
    targets = []

    for root in roots():
        try:
            children = [root, *root.iterdir()]
        except OSError:
            children = [root]

        for path in children:
            path_text = str(path).lower()
            if any(keyword in path_text for keyword in keywords):
                targets.append(path)

    # Fallback: if no obvious vendor directory exists, scan roots shallowly.
    return targets or roots()


if __name__ == "__main__":
    main()
