"""Local definitions and approved actions for PulsePC's program list."""
import hashlib
import json
import pwd
import re
import subprocess
import tempfile
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from threading import Lock

NAME = r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}"
UNIT = r"[a-zA-Z0-9][a-zA-Z0-9_.@-]{0,119}\.service"
IDENTIFIER = r"[a-z0-9][a-z0-9_-]{0,39}"
OPERATIONS = ("start", "stop", "status")
MAX_PROGRAMS = 40


class ConflictError(ValueError):
    pass


def identifier(value):
    return isinstance(value, str) and re.fullmatch(IDENTIFIER, value) is not None


def load_object(path):
    try:
        data = json.loads(path.read_text())
    except (OSError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


def normalize(entry):
    if not isinstance(entry, dict) or not identifier(entry.get("id")):
        raise ValueError("Identifiant de programme invalide.")
    name = entry.get("name")
    note = entry.get("note", "")
    if not isinstance(name, str) or not 0 < len(name.strip()) <= 80:
        raise ValueError("Le nom doit contenir entre 1 et 80 caractères.")
    if not isinstance(note, str) or len(note) > 300:
        raise ValueError("La note est limitée à 300 caractères.")
    kind = entry.get("kind")
    normalized = {"id": entry["id"], "name": name.strip(), "kind": kind, "note": note.strip()}
    if kind == "custom":
        for action in OPERATIONS:
            value = entry.get(action)
            if not identifier(value):
                raise ValueError("Choisis un profil pour chaque action personnalisée.")
            normalized[action] = value
        return normalized
    target = entry.get("target")
    pattern = {"systemd": UNIT, "docker": NAME}.get(kind) if isinstance(kind, str) else None
    if not isinstance(target, str) or not pattern or not re.fullmatch(pattern, target):
        raise ValueError("Indique le vrai nom du conteneur ou d’un service se terminant par .service.")
    if kind == "systemd" and (target in {"docker.service", "containerd.service"} or
                             target.startswith(("pulsepc", "tailscaled", "systemd-", "ssh", "dbus", "network"))):
        raise ValueError("Les services essentiels de la machine sont protégés.")
    normalized["target"] = target
    return normalized


def run(*args, timeout=3):
    try:
        return subprocess.check_output(args, text=True, stderr=subprocess.DEVNULL, timeout=timeout).strip()
    except (OSError, subprocess.SubprocessError):
        return None


class ProgramRegistry:
    def __init__(self, etc, state):
        self.etc = etc
        self.state = state / "program-list.json"
        self.lock = Lock()

    def items(self):
        if self.state.exists():
            candidates = load_object(self.state).get("programs", [])
        else:
            candidates = [{**entry, "id": key} for key, entry in load_object(self.etc / "programs.json").items()
                          if isinstance(entry, dict)]
        result = []
        for entry in candidates if isinstance(candidates, list) else ():
            try:
                result.append(normalize(entry))
            except ValueError:
                continue
        return result[:MAX_PROGRAMS]

    def profiles(self):
        result = {}
        for key, value in load_object(self.etc / "program-commands.json").items():
            if not identifier(key) or not isinstance(value, dict):
                continue
            operation, argv, cwd, user = (value.get(field) for field in ("operation", "argv", "cwd", "user"))
            if operation not in OPERATIONS or not isinstance(argv, list) or not argv or len(argv) > 32:
                continue
            if not all(isinstance(arg, str) and len(arg) <= 1024 and "\x00" not in arg for arg in argv):
                continue
            if not Path(argv[0]).is_absolute() or not isinstance(cwd, str) or not Path(cwd).is_absolute() or "\x00" in cwd:
                continue
            try:
                uid = pwd.getpwnam(user).pw_uid if isinstance(user, str) and user else 0
            except KeyError:
                continue
            if uid == 0:
                continue
            name = value.get("name")
            result[key] = {"name": str(name)[:80] if name else key, "operation": operation,
                           "argv": argv, "cwd": cwd, "uid": uid}
        return result

    @staticmethod
    def revision(items):
        data = json.dumps(items, sort_keys=True).encode()
        return hashlib.sha256(data).hexdigest()

    def configuration(self):
        items = self.items()
        profiles = [{key: value[key] for key in ("name", "operation", "cwd")} | {"id": ident}
                    for ident, value in self.profiles().items()]
        return {"programs": items, "revision": self.revision(items), "profiles": profiles}

    def save(self, data):
        items = data.get("programs")
        if not isinstance(items, list) or len(items) > MAX_PROGRAMS:
            raise ValueError(f"La liste peut contenir jusqu’à {MAX_PROGRAMS} programmes.")
        normalized = [normalize(entry) for entry in items]
        if len({entry["id"] for entry in normalized}) != len(normalized):
            raise ValueError("Plusieurs programmes ont le même identifiant.")
        with self.lock:
            if data.get("revision") != self.revision(self.items()):
                raise ConflictError("La liste a changé sur un autre appareil. Rouvre le formulaire.")
            self.state.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile("w", dir=self.state.parent, prefix=".programs-", delete=False) as out:
                temp = Path(out.name)
                try:
                    json.dump({"programs": normalized}, out)
                    out.close()
                    temp.replace(self.state)
                finally:
                    temp.unlink(missing_ok=True)
            return self.configuration()

    @staticmethod
    def invoke_profile(profile):
        status_check = profile["operation"] == "status"
        time_limit = 3 if status_check else 12
        return subprocess.run(
            ["/usr/bin/systemd-run", "--wait", "--pipe", "--quiet", "--collect", "--expand-environment=no",
             f"--uid={profile['uid']}", "--property=NoNewPrivileges=yes",
             f"--property=RuntimeMaxSec={time_limit}", f"--working-directory={profile['cwd']}",
             "--", *profile["argv"]],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
            timeout=time_limit + 4).returncode

    @staticmethod
    def find_profile(entry, profiles, operation):
        profile = profiles.get(entry.get(operation))
        return profile if profile and profile["operation"] == operation else None

    def statuses(self):
        entries = self.items()
        profiles = self.profiles() if any(entry["kind"] == "custom" for entry in entries) else {}
        docker = None
        if any(entry["kind"] == "docker" for entry in entries):
            raw = run("/usr/bin/docker", "container", "ls", "--all", "--format", "{{.Names}}\t{{.State}}")
            if raw is not None:
                docker = dict(line.split("\t", 1) for line in raw.splitlines() if "\t" in line)

        def state(entry):
            if entry["kind"] == "docker":
                if docker is None:
                    return "unknown"
                key = docker.get(entry["target"], "missing")
                return {"running": "on", "created": "off", "exited": "off", "dead": "off",
                        "restarting": "pending", "removing": "pending", "missing": "missing"}.get(key, "unknown")
            if entry["kind"] == "systemd":
                raw = run("/usr/bin/systemctl", "show", "-p", "LoadState", "-p", "ActiveState", "--", entry["target"])
                values = dict(line.split("=", 1) for line in (raw or "").splitlines() if "=" in line)
                if values.get("LoadState") == "not-found":
                    return "missing"
                return {"active": "on", "inactive": "off", "failed": "off", "activating": "pending",
                        "deactivating": "pending", "reloading": "pending"}.get(values.get("ActiveState"), "unknown")
            matching = {action: self.find_profile(entry, profiles, action) for action in OPERATIONS}
            if not all(matching.values()):
                return "missing"
            try:
                return {0: "on", 1: "off"}.get(self.invoke_profile(matching["status"]), "unknown")
            except (OSError, subprocess.SubprocessError):
                return "unknown"

        with ThreadPoolExecutor(max_workers=16) as workers:
            return [{"id": entry["id"], "name": entry["name"], "kind": entry["kind"], "note": entry["note"],
                     "state": current} for entry, current in zip(entries, workers.map(state, entries))]

    def change(self, key, operation):
        with self.lock:
            entry = next((item for item in self.items() if item["id"] == key), None)
            if not entry:
                raise ValueError("Programme absent de la liste.")
            profile = None
            if entry["kind"] == "custom":
                profile = self.find_profile(entry, self.profiles(), operation)
                if not profile:
                    raise ValueError("Cette commande doit être approuvée sur ce Debian.")
            try:
                if profile:
                    if self.invoke_profile(profile) != 0:
                        raise ValueError("Le profil n’a pas terminé avec succès.")
                elif entry["kind"] == "docker":
                    args = ["/usr/bin/docker", "container", operation]
                    if operation == "stop":
                        args.extend(["--time", "8"])
                    subprocess.run([*args, "--", entry["target"]], check=True, timeout=18, capture_output=True)
                else:
                    subprocess.run(["/usr/bin/systemctl", operation, "--no-block", "--", entry["target"]],
                                   check=True, timeout=18, capture_output=True)
            except (OSError, subprocess.SubprocessError) as error:
                raise ValueError("Debian a refusé le changement d’état de ce programme.") from error
