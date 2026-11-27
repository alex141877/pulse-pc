#!/usr/bin/env python3
"""Print a PulsePC pairing token locally on the monitored PC."""
import argparse
import base64
import json
from urllib.parse import urlsplit

from agent import ETC, TOKEN, read


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("address", help="Adresse HTTPS privée affichée par tailscale serve status")
    parser.add_argument("--read-only", action="store_true", help="Inclure uniquement le suivi")
    args = parser.parse_args()
    url = urlsplit(args.address)
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ("", "/"):
        parser.error("Indique l’adresse HTTPS Tailscale sans chemin.")
    token = read(TOKEN)
    if not token:
        parser.error("Jeton de suivi introuvable. Exécute cette commande avec sudo.")
    control = "" if args.read_only else read(ETC / "control-token")
    payload = {"url": f"https://{url.netloc}", "token": token, "control": control}
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    print("ppc1." + encoded)


if __name__ == "__main__":
    main()
