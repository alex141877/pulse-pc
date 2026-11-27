#!/bin/sh
set -eu
umask 077
BASE=/opt/pulsepc
ETC=/etc/pulsepc
if [ "$(id -u)" -ne 0 ]; then exec sudo sh "$0" "$@"; fi
if [ "$#" -gt 1 ] || { [ "$#" -eq 1 ] && [ "$1" != --enable-power ]; }; then
  echo "Usage: $0 [--enable-power]" >&2
  exit 2
fi
cd "$(dirname "$0")"
install -d -m 0755 "$BASE" /etc/systemd/system/pulsepc.service.d
install -d -m 0700 "$ETC"
if [ ! -s "$ETC/token" ]; then
  python3 -c 'import secrets; print(secrets.token_urlsafe(32))' > "$ETC/token"
fi
if [ ! -s "$ETC/control-token" ]; then
  python3 -c 'import secrets; print(secrets.token_urlsafe(32))' > "$ETC/control-token"
fi
if [ "$#" -eq 1 ] && [ ! -e "$ETC/actions.json" ]; then
  printf '%s\n' '{"power":true,"wake":{}}' > "$ETC/actions.json"
fi
python3 -c 'from pathlib import Path; p=Path("agent.py"); compile(p.read_bytes(), str(p), "exec")'
if [ -f "$BASE/agent.py" ]; then
  backup=$(mktemp "$BASE/agent.py.backup.XXXXXX")
  install -m 0600 "$BASE/agent.py" "$backup"
fi
for asset in index.html app.css app.js manifest.webmanifest icon-192.png icon-512.png sw.js; do
  if [ -f "$asset" ]; then install -m 0644 "$asset" "$BASE/$asset"; fi
done
if [ -f pair.py ]; then install -m 0644 pair.py "$BASE/pair.py"; fi
install -m 0644 agent.py "$BASE/agent.py.new"
mv "$BASE/agent.py.new" "$BASE/agent.py"
if [ ! -f /etc/systemd/system/pulsepc.service ]; then
  cat > /etc/systemd/system/pulsepc.service <<'EOF'
[Unit]
Description=PulsePC metrics API
After=network-online.target
Wants=network-online.target
[Service]
ExecStart=/usr/bin/python3 /opt/pulsepc/agent.py
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
[Install]
WantedBy=multi-user.target
EOF
fi
printf '[Service]\nStateDirectory=pulsepc\nStateDirectoryMode=0700\n' > /etc/systemd/system/pulsepc.service.d/history.conf
systemctl daemon-reload
systemctl enable pulsepc
systemctl restart pulsepc
systemctl is-active pulsepc
printf '\nAppairage : sudo python3 /opt/pulsepc/pair.py\n'
