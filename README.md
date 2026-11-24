# PulsePC

PulsePC suit plusieurs PC Linux depuis Windows et Android avec la même interface. Chaque agent Debian mesure le CPU, la RAM, le stockage et les capteurs disponibles toutes les cinq secondes. Il conserve les 500 derniers changements d'état et expose les 15 dernières minutes de mesures pour les graphiques. L'historique des états est partagé entre les appareils. Les graphiques repartent à zéro après le redémarrage de l'agent.

## Debian

Depuis le dossier source, lancer `sudo sh install-debian.sh`. Pour autoriser l'arrêt et le redémarrage lors de la première configuration, ajouter `--enable-power`. Un fichier existant `/etc/pulsepc/actions.json` est conservé. Contrôler que `tailscale serve status` affiche un point d'entrée HTTPS **tailnet only** vers `http://127.0.0.1:8765`. Sur une machine sans autre configuration Tailscale Serve, on peut créer ce point d'entrée avec `sudo tailscale serve --bg http://127.0.0.1:8765`.

Dans PulsePC, ajouter le PC avec son adresse HTTPS et le jeton de suivi renvoyé par `sudo cat /etc/pulsepc/token`. Saisir les mêmes paramètres sur les deux appareils pour y suivre les mêmes PC. Pour les actions, ajouter séparément le jeton de commande renvoyé par `sudo cat /etc/pulsepc/control-token`. Ces jetons sont à conserver sur les appareils de confiance.

Sous Windows, le bouton **Se connecter** lance OpenSSH et exécute `su -` sur Debian. Ouvrir la session SSH avec ses identifiants habituels, puis saisir le mot de passe root dans le terminal. PulsePC lance `tailscale up` au démarrage de Windows si Tailscale est installé à l'emplacement habituel. Sous Android, connecter Tailscale à la même tailnet avant d'ouvrir PulsePC.

### Wake-on-LAN

Configurer le réveil dans le BIOS et la carte réseau. Dans `/etc/pulsepc/actions.json` de l'agent relais, indiquer la cible avec un nom, son adresse MAC et son adresse de diffusion sur le LAN. Par exemple :

```json
{"power":true,"wake":{"pc-bureau":{"mac":"00:11:22:33:44:55","broadcast":"192.168.1.255"}}}
```

Le relais doit rester allumé sur le même réseau physique que la machine à réveiller. Ajouter le relais dans PulsePC avec son jeton de commande. Dans les paramètres du PC cible, sélectionner ce relais et saisir `pc-bureau`.

## Builds et mises à jour

- Android avec JDK 17, Gradle 8.9 et SDK 35 : configurer `PULSEPC_KEYSTORE` et `PULSEPC_KEYPASS`, puis lancer `gradle -p android assembleRelease`. Publier l'APK signé sous le nom `PulsePC-Android.apk`. Conserver la même clé de signature à chaque version et incrémenter `versionCode`. L'ancienne APK de débogage peut nécessiter une désinstallation, qui efface notamment la liste locale des PC.
- Windows x64 : copier `index.html`, `app.css`, `app.js`, `manifest.webmanifest` et les icônes PNG dans `desktop/ui`, puis lancer `npm ci` et `npm run dist` depuis `desktop`. L'installateur NSIS et ses métadonnées sont dans `desktop/dist`.
- Pour distribuer une mise à jour, créer une GitHub Release publique taguée `vMAJEUR.MINEUR.CORRECTIF` sur `alex141877/pulse-pc` avec l'APK, l'EXE, `latest.yml` et le fichier `.blockmap` s'il est produit. Windows télécharge la mise à jour et l'installe à la fermeture. Android vérifie les versions au lancement, télécharge automatiquement les APK plus récents et laisse Android confirmer l'installation.
