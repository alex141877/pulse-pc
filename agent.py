#!/usr/bin/env python3
"""Small read-only status API for PulsePC. Bind to Tailscale interface only."""
import json, os, platform, secrets, subprocess, time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.getenv("PULSEPC_PORT", "8765"))
TOKEN_FILE = Path(os.getenv("PULSEPC_TOKEN_FILE", "/etc/pulsepc/token"))
TOKEN = TOKEN_FILE.read_text().strip() if TOKEN_FILE.exists() else ""

def run(*args):
    try: return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, timeout=2).strip()
    except Exception: return ""

def read(path):
    try: return Path(path).read_text().strip()
    except Exception: return ""

def metrics():
    load = os.getloadavg()[0] if hasattr(os, "getloadavg") else 0
    cpus = os.cpu_count() or 1
    mem = {}
    for line in read("/proc/meminfo").splitlines():
        p=line.split()
        if len(p)>=2: mem[p[0].rstrip(":")]=int(p[1])*1024
    total=mem.get("MemTotal",0); available=mem.get("MemAvailable",0)
    disk=subprocess.run(["df","-B1","/"],capture_output=True,text=True).stdout.splitlines()
    used=totaldisk=0
    if len(disk)>1:
        p=disk[1].split(); totaldisk=int(p[1]); used=int(p[2])
    temps=[]
    for f in Path("/sys/class/thermal").glob("thermal_zone*/temp"):
        try:
            n=int(f.read_text().strip())/1000
            if 0<n<150: temps.append(n)
        except Exception: pass
    gpu=""
    nv=run("nvidia-smi","--query-gpu=name,utilization.gpu,temperature.gpu","--format=csv,noheader,nounits")
    if nv:
        p=[x.strip() for x in nv.split(",")]; gpu={"name":p[0],"usage":int(p[1]),"temp":int(p[2])}
    return {"name":platform.node(),"os":platform.platform(),"uptime":int(time.time()-float(read("/proc/uptime").split()[0])),"cpu":{"usage":round(min(100,load/cpus*100)),"name":platform.processor() or platform.machine(),"cores":cpus,"load":round(load,2)},"memory":{"total":total,"used":total-available},"disk":{"total":totaldisk,"used":used},"temperature":round(sum(temps)/len(temps)) if temps else None,"gpu":gpu or None,"tailscale":"connecté" if run("tailscale","status") else "inconnu","updated":int(time.time())}

class Handler(BaseHTTPRequestHandler):
    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
    def do_OPTIONS(self):
        self.send_response(204); self.cors(); self.send_header("Content-Length", "0"); self.end_headers()
    def do_GET(self):
        if self.path in ("/", "/index.html", "/manifest.webmanifest", "/sw.js"):
            try: raw=Path(__file__).with_name("index.html" if self.path in ("/", "/index.html") else self.path.lstrip("/")).read_bytes()
            except OSError: self.send_error(404); return
            mime="text/html; charset=utf-8" if self.path in ("/", "/index.html") else ("application/manifest+json" if self.path.endswith("webmanifest") else "application/javascript")
            self.send_response(200); self.send_header("Content-Type",mime); self.send_header("Content-Length",str(len(raw))); self.end_headers(); self.wfile.write(raw); return
        if self.path not in ("/api/status", "/health"): self.send_error(404); return
        if self.path != "/health" and (not TOKEN or self.headers.get("Authorization") != "Bearer "+TOKEN): self.send_error(401); return
        data={"ok":True} if self.path=="/health" else metrics()
        raw=json.dumps(data).encode(); self.send_response(200); self.send_header("Content-Type","application/json"); self.cors(); self.send_header("Content-Length",str(len(raw))); self.end_headers(); self.wfile.write(raw)
    def log_message(self,*args): pass

if __name__=="__main__":
    if not TOKEN: raise SystemExit("Configure /etc/pulsepc/token first")
    ip=run("tailscale","ip","-4")
    if not ip: raise SystemExit("Tailscale is not connected")
    print(f"PulsePC API on http://127.0.0.1:{PORT} (via Tailscale Serve at {ip})")
    ThreadingHTTPServer(("127.0.0.1",PORT),Handler).serve_forever()
