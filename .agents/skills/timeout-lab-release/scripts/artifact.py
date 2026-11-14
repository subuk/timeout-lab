#!/usr/bin/env python3
"""Package an already-built Timeout Lab dist or verify its served bytes."""

import argparse
import hashlib
import io
from pathlib import Path
import subprocess
import tarfile
from urllib.parse import urlsplit


ROOT = Path(__file__).resolve().parents[4]
FILES = (
    "index.html", "app.js", "style.css", "i18n.js", "worker.js",
    "wasm_exec.js", "core.wasm", "standalone.html",
)


def artifacts():
    result = {}
    for name in FILES:
        path = ROOT / "dist" / name
        if path.is_symlink() or not path.is_file() or not path.stat().st_size:
            raise ValueError(f"Missing, empty or symlink artifact: {path}")
        result[name] = path.read_bytes()
    return result


def digest(data):
    return hashlib.sha256(data).hexdigest()


def package(output):
    output = Path(output).expanduser().resolve()
    if output == ROOT or ROOT in output.parents:
        raise ValueError("Write the archive outside the project (for example /tmp)")
    data = artifacts()
    config = ROOT / "deployment" / "tmlab.conf"
    if config.is_symlink() or not config.is_file():
        raise ValueError("Missing nginx configuration or unexpected symlink")
    manifest = "".join(f"{digest(value)}  {name}\n" for name, value in data.items())
    entries = {f"dist/{name}": value for name, value in data.items()}
    entries["deployment/tmlab.conf"] = config.read_bytes()
    entries["SHA256SUMS"] = manifest.encode()
    # Refuse to silently replace an archive from another attempt.
    with output.open("xb") as stream:
        with tarfile.open(fileobj=stream, mode="w:gz") as archive:
            for name, value in entries.items():
                info = tarfile.TarInfo(name)
                info.size = len(value)
                info.mode = 0o644
                archive.addfile(info, io.BytesIO(value))
    print(f"Packaged {len(data)} static files: {output}")


def verify(base_url):
    parsed = urlsplit(base_url)
    if (parsed.scheme not in ("https", "http") or not parsed.hostname
            or parsed.username or parsed.password or parsed.query or parsed.fragment):
        raise ValueError("Use an HTTP(S) base URL without credentials, query or fragment")
    mismatches = []
    for name, value in artifacts().items():
        url = base_url.rstrip("/") + "/" + name
        served = subprocess.check_output(
            ["curl", "--fail", "--silent", "--show-error", "--max-time", "30", url]
        )
        if digest(served) != digest(value):
            mismatches.append(name)
            print(f"MISMATCH: {name}")
        else:
            print(f"SHA-256 OK: {name}")
    if mismatches:
        raise ValueError("Served files differ: " + ", ".join(mismatches))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("package", help="Package existing dist; no build or upload").add_argument("output")
    commands.add_parser("verify", help="Compare served files with local dist").add_argument("base_url")
    args = parser.parse_args()
    try:
        if args.command == "package":
            package(args.output)
        else:
            verify(args.base_url)
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, f"Error: {error}\n")


if __name__ == "__main__":
    main()
