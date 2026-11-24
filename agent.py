#!/usr/bin/env python3
import hmac
import ipaddress
import json
import mimetypes
import os
import platform
import re
import socket
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ETC = Path("/etc/pulsepc")
PORT = int(os.getenv("PULSEPC_PORT", "8765"))
TOKEN = Path(os.getenv("PULSEPC_TOKEN_FILE", str(ETC / "token")))
STATE = Path(os.getenv("STATE_DIRECTORY", "/var/lib/pulsepc")) / "history.json"
LOCK = threading.Lock()
LATEST = None
PREVIOUS_CPU = None
SAMPLES = []
EVENTS = []

def read(path):
    try:
        return Path(path).read_text().strip()
    except OSError:
        return ""

def run(*args):
    try:
        return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, timeout=3).strip()
    except (OSError, subprocess.SubprocessError):
        return ""

def cpu_usage():
    global PREVIOUS_CPU
    fields = [int(value) for value in read("/proc/stat").splitlines()[0].split()[1:9]]
    current = sum(fields), sum(fields[3:5])
    previous, PREVIOUS_CPU = PREVIOUS_CPU, current
    if not previous or current[0] <= previous[0]:
        return None
    return round(max(0, min(100, 100 * (1 - (current[1]-previous[1]) / (current[0]-previous[0])))))

def duration():
    # procps uptime -s reports the local timestamp at boot.
    started = run("uptime", "-s")
    seconds = float(read("/proc/uptime").split()[0])
    if started:
        try:
            measured = time.time() - time.mktime(time.strptime(started, "%Y-%m-%d %H:%M:%S"))
            if abs(measured - seconds) < 5:
                seconds = measured
        except (ValueError, OverflowError):
            pass
    return int(seconds)

def temperature():
    sensors = []
    for directory in Path("/sys/class/hwmon").glob("hwmon*"):
        if read(directory / "name") in {"coretemp", "k10temp", "zenpower", "cpu_thermal"}:
            sensors.extend(directory.glob("temp*_input"))
    if not sensors:
        for directory in Path("/sys/class/thermal").glob("thermal_zone*"):
            if read(directory / "type") in {"x86_pkg_temp", "cpu-thermal", "cpu_thermal", "soc_thermal"}:
                sensors.append(directory / "temp")
    values = []
    for sensor in sensors:
        try:
            value = int(read(sensor)) / 1000
            if 0 < value < 150:
                values.append(value)
        except ValueError:
            pass
    return round(max(values), 1) if values else None

def metrics():
    mem = {}
    for line in read("/proc/meminfo").splitlines():
        key, value = line.split(":", 1)
        if value.strip().endswith(" kB"):
            mem[key] = int(value.split()[0]) * 1024
    total = mem["MemTotal"]
    free = mem["MemFree"]
    available = mem.get("MemAvailable", free)
    cached = mem.get("Cached", 0)
    used = max(0, total - (available if available <= total else free))
    disk = os.statvfs("/")
    used_disk = (disk.f_blocks - disk.f_bfree) * disk.f_frsize
    available_disk = disk.f_bavail * disk.f_frsize
    capacity = used_disk + available_disk
    gpu = None
    line = run("nvidia-smi", "--query-gpu=name,utilization.gpu,temperature.gpu", "--format=csv,noheader,nounits").splitlines()
    if line:
        parts = line[0].rsplit(",", 2)
        if len(parts) == 3:
            gpu = {"name": parts[0], "usage": int(parts[1]) if parts[1].strip().isdigit() else None,
                   "temp": int(parts[2]) if parts[2].strip().isdigit() else None}
    model = next((line.partition(":")[2].strip() for line in read("/proc/cpuinfo").splitlines()
                  if line.startswith("model name")), platform.machine())
    return {"name": platform.node(), "os": platform.platform(), "uptime": duration(), "apiVersion": 2,
            "cpu": {"usage": cpu_usage(), "name": model, "cores": os.cpu_count(), "load": round(os.getloadavg()[0], 2)},
            "memory": {"total": total, "used": used, "available": available, "free": free, "cached": cached},
            "disk": {"total": disk.f_blocks * disk.f_frsize, "used": used_disk, "available": available_disk,
                     "percent": (used_disk * 100 + capacity - 1) // capacity if capacity else 0, "mount": "/"},
            "temperature": temperature(), "gpu": gpu, "updated": int(time.time())}

def classify(sample):
    mem = sample["memory"]
    checks = ((sample["cpu"]["usage"], 75, 95, "CPU"), (100 - 100 * mem["available"] / mem["total"], 80, 95, "RAM"),
              (sample["temperature"], 75, 90, "Température CPU"), (sample["disk"]["percent"], 85, 95, "Stockage /"))
    severity = 0
    reasons = []
    for value, warning, critical, label in checks:
        if value is not None and value >= warning:
            severity = max(severity, 2 if value >= critical else 1)
            reasons.append(f"{label} : {value:.0f}{' °C' if label.startswith('Température') else ' %'}")
    return {"level": ("green", "orange", "red")[severity], "reason": ", ".join(reasons) or "Dans les seuils"}

def sample_loop():
    global LATEST
    previous = EVENTS[-1]["level"] if EVENTS else None
    while True:
        try:
            sample = metrics()
            sample["status"] = classify(sample)
            with LOCK:
                LATEST = sample
                SAMPLES.append({"time": sample["updated"], "cpu": sample["cpu"]["usage"],
                                "ram": round(100 * sample["memory"]["used"] / sample["memory"]["total"]),
                                "temperature": sample["temperature"], "disk": sample["disk"]["percent"]})
                del SAMPLES[:-180]
                level = sample["status"]["level"]
                if level != previous:
                    event = {"time": sample["updated"], **sample["status"]}
                    updated = (EVENTS + [event])[-500:]
                    STATE.parent.mkdir(parents=True, exist_ok=True)
                    temp = STATE.with_suffix(".tmp")
                    temp.write_text(json.dumps(updated))
                    temp.replace(STATE)
                    EVENTS[:] = updated
                    previous = level
        except Exception as error:
            print(f"PulsePC: {error}", flush=True)
        time.sleep(5)

def config():
    try:
        return json.loads(read(ETC / "actions.json") or "{}")
    except ValueError:
        return {}

def wake(target, settings):
    entry = settings.get("wake", {}).get(target)
    if not entry:
        raise ValueError("Cible Wake-on-LAN non configurée sur ce relais.")
    mac = entry["mac"].replace(":", "").replace("-", "")
    if not re.fullmatch(r"[0-9a-fA-F]{12}", mac):
        raise ValueError("Adresse MAC invalide.")
    address = str(ipaddress.IPv4Address(entry.get("broadcast", "255.255.255.255")))
    with socket.socket(socket.AF_INET, socket.SOCK_DGRAM) as sender:
        sender.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
        sender.sendto(b"\xff" * 6 + bytes.fromhex(mac) * 16, (address, 9))

class Handler(BaseHTTPRequestHandler):
    def respond(self, code, data=None):
        raw = b"" if data is None else json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def authorized(self, token):
        value = self.headers.get("Authorization", "").encode()
        return bool(token) and hmac.compare_digest(value, ("Bearer " + token).encode())

    def do_OPTIONS(self):
        self.respond(204)

    def do_GET(self):
        name = "index.html" if self.path == "/" else self.path.lstrip("/")
        if name in {"index.html", "app.js", "app.css", "manifest.webmanifest", "icon-192.png", "icon-512.png", "sw.js"}:
            try:
                content = Path(__file__).with_name(name).read_bytes()
            except OSError:
                return self.respond(404, {"error": "Fichier absent."})
            self.send_response(200)
            self.send_header("Content-Type", mimetypes.guess_type(name)[0] or "application/octet-stream")
            self.send_header("Cache-Control", "no-cache")
            self.send_header("Content-Length", str(len(content)))
            self.end_headers()
            self.wfile.write(content)
            return
        if self.path == "/health":
            return self.respond(200, {"ok": True})
        if self.path not in {"/api/status", "/api/history"}:
            return self.respond(404, {"error": "Route inconnue."})
        if not self.authorized(read(TOKEN)):
            return self.respond(401, {"error": "Jeton de suivi refusé."})
        with LOCK:
            data = dict(LATEST) if LATEST else None
            if self.path == "/api/history":
                data = {"events": list(EVENTS), "samples": list(SAMPLES)}
        self.respond(200 if data else 503, data or {"error": "Première mesure en cours."})

    def do_POST(self):
        if self.path != "/api/action":
            return self.respond(404, {"error": "Route inconnue."})
        if not self.authorized(read(ETC / "control-token")):
            return self.respond(401, {"error": "Jeton de commande refusé."})
        if self.headers.get_content_type() != "application/json":
            return self.respond(415, {"error": "JSON requis."})
        try:
            size = int(self.headers.get("Content-Length", "0"))
            if not 0 < size <= 1024:
                raise ValueError()
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError()
        except (ValueError, UnicodeError):
            return self.respond(400, {"error": "Requête invalide."})
        action = data.get("action")
        settings = config()
        try:
            if action == "wake":
                target = data.get("target")
                if not isinstance(target, str) or not target:
                    raise ValueError("Cible Wake-on-LAN manquante.")
                wake(target, settings)
            elif isinstance(action, str) and action in {"poweroff", "reboot"}:
                if settings.get("power") is not True:
                    return self.respond(403, {"error": "Actions d’alimentation désactivées sur cet agent."})
                subprocess.run(["/usr/bin/systemd-run", "--on-active=3s", "--collect",
                                "/usr/bin/systemctl", action], check=True, timeout=5, capture_output=True)
            else:
                return self.respond(400, {"error": "Action inconnue."})
        except (ValueError, OSError, subprocess.SubprocessError) as error:
            return self.respond(422, {"error": str(error)})
        self.respond(202, {"ok": True})

    def log_message(self, *_):
        pass

if __name__ == "__main__":
    if not read(TOKEN):
        raise SystemExit("Configure /etc/pulsepc/token first")
    try:
        EVENTS[:] = json.loads(read(STATE) or "[]")[-500:]
    except (ValueError, TypeError):
        pass
    threading.Thread(target=sample_loop, daemon=True).start()
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
