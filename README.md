# TwVodNoAdsJCed

[![Install with Tampermonkey](https://img.shields.io/badge/Install%20with-Tampermonkey-9146FF?style=for-the-badge)](https://raw.githubusercontent.com/Endymi0n74/TwVodNoAdsJCed/master/combined/twitch-combined.user.js)

Userscript Tampermonkey qui **bloque les pubs Twitch**, **débloque les VODs sub-only** et **dé-mute les VODs**.

Basé sur [pixeltris/TwitchAdSolutions](https://github.com/pixeltris/TwitchAdSolutions) (script `vaft`) et sur la méthode de bypass VOD de [besuper/TwitchNoSub](https://github.com/besuper/TwitchNoSub).

## ✨ Fonctionnalités

- **Blocage des pubs** — hook du Worker Twitch (méthode vaft) : récupère un stream propre, supprime les segments pub si nécessaire, corrige le buffering
- **VODs sub-only** — bypass usher : quand `usher.ttvnw.net/vod/` renvoie un **403** (VOD réservée aux abonnés), le script construit un playlist CDN direct à partir des métadonnées GQL (`seekPreviewsURL`) → la vidéo se lance
- **Dé-mute des VODs** — réécriture `-unmuted` → `-muted` dans les playlists cloudfront (récupère les segments avec le son d'origine)
- **Boutons dans le header Twitch** — `📊 Stats` (toast avec les compteurs) et `⏻ ON/OFF` (activation/désactivation du script)
- **Stats en console** — compteurs persistants (localStorage) : pubs bloquées / VODs débloquées

## 📦 Installation

1. Installer [Tampermonkey](https://www.tampermonkey.net/) (sur Chrome : activer « Allow user scripts » dans les paramètres de l'extension)
2. Ouvrir l'URL d'installation : <https://raw.githubusercontent.com/Endymi0n74/TwVodNoAdsJCed/master/combined/twitch-combined.user.js>
3. Cliquer sur « Installer »

## 🚀 Utilisation

- Sur une chaîne Twitch, deux boutons apparaissent **à gauche de la barre viewers/durée** du header :
  - **📊 Stats** — affiche un toast avec `Pubs bloquées` / `VODs débloquées`
  - **⏻ ON/OFF** — désactive ou réactive le script (recharge la page ; le bouton reste accessible en OFF pour réactiver)
- **Console (F12)** : résumé des stats au chargement, puis un log à chaque pub bloquée (`📺 Pub bloquée`) et à chaque VOD débloquée (`🎬 VOD sub-only débloquée`)

## ⚠️ Attention

- **Ne pas combiner avec d'autres bloqueurs de pubs Twitch** (vaft, TTV LOL PRO, TwitchNoSub, Purple AdBlock…) — les scripts se marchent dessus (double hook des Workers).
- Testé sur Chrome + Tampermonkey.

## 🏗️ Architecture

`combined/twitch-combined.user.js` — script unique (~1 400 lignes), dérivé de vaft :

| Bloc | Rôle |
|------|------|
| `hookWindowWorker()` | Intercepte le Worker blob de Twitch et y injecte le hook fetch |
| `hookWorkerFetch()` | Dans le worker : m3u8 (pubs), `channel/hls` (encodings live), `usher.ttvnw.net/vod/` (VODs) |
| `buildVodPlaylist()` | Bypass usher 403 → playlist CDN direct (qualités vérifiées, codec détecté) |
| `-unmuted → -muted` | Dé-mute les playlists cloudfront |
| `removeRestrictions()` | Nettoyage d'overlays résiduels (sélecteurs historiques) |
| Boutons header + stats | UI minimale (toast stats, toggle on/off) + logs console |

## 📂 Contenu du repo

- `combined/twitch-combined.user.js` — **le script** (à installer)
- `vaft/`, `video-swap-new/` — scripts upstream d'origine (le combiné en dérive)
- `MEMORY.md` — mémoire de développement (règles, bugs connus, backlog)
- `CHANGELOG.md` — historique des versions
- `issues.md` — problèmes connus de la base vaft / video-swap-new
- `LICENSE` — MIT

## ⚖️ Licence

MIT — Copyright (c) TwitchAdSolutions Contributors. Voir [LICENSE](LICENSE).
