# PulsePC — installation sur GitHub Pages

Application web installable sur Android. L'interface est publiée sur GitHub Pages ; les mesures restent sur les PC et passent par Tailscale.

## Publier

1. Crée un dépôt GitHub (par exemple `pulsepc`).
2. Ajoute à la racine du dépôt le contenu complet de ce dossier, y compris `android/`, `.github/workflows/` et les icônes PNG.
3. Dans **Settings → Pages**, choisis **Deploy from a branch**, branche `main`, dossier `/ (root)`, puis **Save**.
4. Attends la publication et ouvre l'URL Pages indiquée par GitHub depuis Chrome sur Android.
5. Dans Chrome, menu **⋮ → Installer l'application** ou **Ajouter à l'écran d'accueil**.

## Construire l'APK Android

Après avoir poussé les fichiers sur GitHub, ouvre l'onglet **Actions**, sélectionne **Build PulsePC Android APK**, puis **Run workflow**. À la fin, télécharge l'artefact **PulsePC-Android-APK** et récupère `app-debug.apk` dedans. Transfère l'APK sur le téléphone et ouvre-le pour l'installer ; Android peut demander d'autoriser l'installation depuis cette source.

## Connecter Debian

L'agent PulsePC doit tourner sur Debian et être publié par Tailscale Serve en HTTPS. Dans l'app, **Ajouter un PC** : nom du PC, URL HTTPS Tailscale (ex. `https://debian-machine.example.ts.net`) et jeton de `/etc/pulsepc/token`.

Pour mettre à jour l'agent Debian vers la version avec pré-vérification CORS (requise par l'app Android), lance sur Debian :

```bash
sudo curl -fsSL https://raw.githubusercontent.com/alex141877/pulse-pc/main/agent.py -o /opt/pulsepc/agent.py
sudo systemctl restart pulsepc
sudo systemctl --no-pager status pulsepc
```

Si l'agent a été installé avant l'activation CORS, remplace son fichier sur Debian par la version actuelle de `agent.py`, puis redémarre uniquement PulsePC :

```bash
sudo install -m 0644 agent.py /opt/pulsepc/agent.py
sudo systemctl restart pulsepc
```

La clé API est stockée dans le stockage local du navigateur. Ne la mets jamais dans le dépôt GitHub. Le dépôt ne contient ni jeton ni donnée personnelle.
