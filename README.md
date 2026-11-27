# PulsePC

PulsePC suit plusieurs PC Linux depuis Windows et Android avec la même interface. Chaque agent Debian mesure le CPU, la RAM, le stockage et les capteurs disponibles toutes les cinq secondes. Il conserve les 500 derniers changements d'état et expose jusqu’à sept jours de mesures pour les graphiques 1 h, 24 h et 7 j. Les mesures et les événements sont enregistrés sur le PC et partagés entre les clients. La collecte commence à l’installation de l’agent v3.

## Debian

Depuis le dossier source, lancer `sudo sh install-debian.sh`. Pour autoriser l'arrêt et le redémarrage lors de la première configuration, ajouter `--enable-power`. Un fichier existant `/etc/pulsepc/actions.json` est conservé. Contrôler que `tailscale serve status` affiche un point d'entrée HTTPS **tailnet only** vers `http://127.0.0.1:8765`. Sur une machine sans autre configuration Tailscale Serve, on peut créer ce point d'entrée avec `sudo tailscale serve --bg http://127.0.0.1:8765`.

Générer le jeton d’appairage sur Debian avec `sudo python3 /opt/pulsepc/pair.py https://debian.example.ts.net`, en utilisant l’adresse réelle de Tailscale Serve. Dans PulsePC, saisir le nom du PC et coller le jeton complet. Sur Windows, saisir aussi l’adresse SSH (par exemple `alex@debian-machine`) si elle diffère de l’adresse proposée par défaut. Le jeton inclut le suivi et le contrôle. Ajouter `--read-only` à la commande pour un jeton réservé au suivi. Les PC déjà ajoutés gardent leur configuration.
Sous Windows, le bouton **Se connecter** lance OpenSSH et exécute `su -` sur Debian. Ouvrir la session SSH avec ses identifiants habituels, puis saisir le mot de passe root dans le terminal. PulsePC lance `tailscale up` au démarrage de Windows si Tailscale est installé à l'emplacement habituel. Sous Android, connecter Tailscale à la même tailnet avant d'ouvrir PulsePC.

### Wake-on-LAN

Configurer le réveil dans le BIOS et la carte réseau. Dans `/etc/pulsepc/actions.json` de l'agent relais, indiquer la cible avec un nom, son adresse MAC et son adresse de diffusion sur le LAN. Par exemple :

```json
{"power":true,"wake":{"pc-bureau":{"mac":"00:11:22:33:44:55","broadcast":"192.168.1.255"}}}
```

Le relais doit rester allumé sur le même réseau physique que la machine à réveiller. Ajouter le relais dans PulsePC avec son jeton de commande. Dans les paramètres du PC cible, sélectionner ce relais et saisir `pc-bureau`.

### Programmes pilotables

Chaque PC démarre avec une liste vide. Dans **Tableau de bord → Programmes**, **Ajouter un programme** accepte un service systemd ou un conteneur Docker. Indique le nom local, par exemple `mon-service.service` ou `mon-conteneur`. Un jeton de commande est requis pour modifier la liste ou basculer l’état.

**Exporter** produit un fichier JSON avec les programmes cochés. Sur l’autre PC, **Importer** permet de les vérifier et de sélectionner ceux à ajouter. Les entrées déjà présentes sont décochées au départ. Les jetons et les scripts restent sur leurs machines.

#### Commandes et dossiers personnalisés

Pour utiliser des commandes spécifiques, définis les profils dans `/etc/pulsepc/program-commands.json`, fichier réservé à l’administrateur Debian. Un profil associe une action (`start`, `stop` ou `status`), une liste d’arguments `argv` dont le premier est un chemin absolu, un dossier de travail `cwd` et un utilisateur local sans privilège root. Le profil d’état doit être en lecture seule et retourner 0 pour ON ou 1 pour OFF.

```json
{
  "mon-app-on": {
    "name": "Démarrer mon application",
    "operation": "start",
    "argv": ["/opt/mon-app/start.sh"],
    "cwd": "/opt/mon-app",
    "user": "mon-utilisateur"
  }
}
```

Crée également les profils `stop` et `status`, puis sélectionne les trois profils dans les **Options avancées**. Sur un autre Debian, les mêmes identifiants peuvent pointer vers ses propres scripts et dossiers. Un profil absent rend l’entrée indisponible.

Le fichier `/etc/pulsepc/programs.json` sert de liste initiale. Dès la première modification depuis PulsePC, la liste est enregistrée dans le répertoire d’état de l’agent.
Sur un PC où Tailscale Serve est configuré, `sudo python3 /opt/pulsepc/pair.py` retrouve automatiquement l’adresse HTTPS privée.

La charge système et le GPU ont leurs propres graphiques. La courbe GPU apparaît lorsque le pilote expose son utilisation. Les mesures de ces deux graphiques sont collectées à partir de l’agent v4.

## Builds et mises à jour

- Android avec JDK 17, Gradle 8.9 et SDK 35 : configurer `PULSEPC_KEYSTORE` et `PULSEPC_KEYPASS`, puis lancer `gradle -p android assembleRelease`. Publier l'APK signé sous le nom `PulsePC-Android.apk`. Conserver la même clé de signature à chaque version et incrémenter `versionCode`. L'ancienne APK de débogage peut nécessiter une désinstallation, qui efface notamment la liste locale des PC.
- Windows x64 : copier `index.html`, `app.css`, `app.js`, `manifest.webmanifest` et les icônes PNG dans `desktop/ui`, puis lancer `npm ci` et `npm run dist` depuis `desktop`. L'installateur NSIS et ses métadonnées sont dans `desktop/dist`.
- Pour distribuer une mise à jour, créer une GitHub Release publique taguée `vMAJEUR.MINEUR.CORRECTIF` sur `alex141877/pulse-pc` avec l'APK, l'EXE, `latest.yml` et le fichier `.blockmap` s'il est produit. Windows télécharge la mise à jour et l'installe à la fermeture. Android vérifie les versions au lancement, télécharge automatiquement les APK plus récents et laisse Android confirmer l'installation.
