#!/usr/bin/env python3
"""Print a PulsePC pairing token locally on the monitored PC."""
import argparse
import base64
import json
from urllib.parse import urlsplit

from agent import ETC, PORT, TOKEN, read, run


def served_address():
    try:
        status = json.loads(run("tailscale", "serve", "status", "--json"))
    except ValueError:
        return ""
    if not isinstance(status, dict):
        return ""
    for authority, config in status.get("Web", {}).items():
        url = urlsplit("https://" + authority)
        port = str(url.port or 443)
        if not status.get("TCP", {}).get(port, {}).get("HTTPS"):
            continue
        if status.get("AllowFunnel", {}).get(authority):
            continue
        proxy = config.get("Handlers", {}).get("/", {}).get("Proxy", "")
        upstream = urlsplit(proxy)
        if upstream.hostname in {"localhost", "127.0.0.1"} and upstream.port == PORT:
            return "https://" + (url.hostname if port == "443" else authority)
    return ""


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("address", nargs="?", help="Adresse HTTPS privée de PulsePC si la détection échoue")
    parser.add_argument("--read-only", action="store_true", help="Inclure uniquement le suivi")
    args = parser.parse_args()
    url = urlsplit(args.address or served_address())
    if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ("", "/"):
        parser.error("Adresse introuvable. Indique l’adresse HTTPS Tailscale Serve de PulsePC.")
    token = read(TOKEN)
    if not token:
        parser.error("Jeton de suivi introuvable. Exécute cette commande avec sudo.")
    control = "" if args.read_only else read(ETC / "control-token")
    payload = {"url": f"https://{url.netloc}", "token": token, "control": control}
    encoded = base64.urlsafe_b64encode(json.dumps(payload).encode()).decode().rstrip("=")
    print("ppc1." + encoded)


if __name__ == "__main__":
    main()
