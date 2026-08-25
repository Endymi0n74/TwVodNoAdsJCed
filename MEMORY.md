# 📋 IMMUTABLE RULES

1. **MEMORY.md MUST be updated after every code change** — no exceptions, no shortcuts
2. **No regression** — every bug fix is documented and must never be reintroduced
3. **Read MEMORY.md first** at the start of every session before any action
4. **PHASE DE TEST EN COURS** — Pas de modifications de code sans accord explicite de l'utilisateur. Seule la mémoire peut être mise à jour.
5. **RELEASE CHECKLIST** — Avant chaque release : (a) Vérifier que README.md est à jour (features, architecture, backlog), (b) Vérifier que MEMORY.md reflète l'état actuel, (c) Nettoyer les fichiers temporaires, (d) Tester l'exe release

---

## 🧠 PROJECT CONTEXT — TwVodNoAdsJCed

**Repo original :** [pixeltris/TwitchAdSolutions](https://github.com/pixeltris/TwitchAdSolutions) (archived 2026-03-05)
**Repo :** [Endymi0n74/TwVodNoAdsJCed](https://github.com/Endymi0n74/TwVodNoAdsJCed)
**Build locale :** `D:\codex\TwVodNoAdsJCed`

**Ce que fait le projet :** Fournit des userscripts pour bloquer les pubs Twitch. Le script hook le constructeur Worker pour intercepter les requêtes fetch et manipuler les playlists m3u8.

### Architecture

```
vaft/
  ├── vaft.user.js           — Userscript principal (recommandé)
  └── vaft-ublock-origin.js  — Version uBlock Origin

video-swap-new/
  ├── video-swap-new.user.js           — Alternative (pas recommandé)
  └── video-swap-new-ublock-origin.js  — Version uBlock Origin

strip/
  └── strip.user.js          — Script basique (marqué "BAD, DON'T USE")
```

### Bugs connus (issues du repo original)

| Issue | Description |
|-------|-------------|
| #506 | Black screen overlay while trying to block twitch ads |
| #499 | Web player structure has changed |
| #497 | Ads need revisit due to Twitch side updates |
| #493 | "Failed to load module" and core-error overlay |
| #477 | Streams sometimes go "offline" when ads occur |
| #355 | Error #1000 / #2000 very often |
| #329 | Volume state changing after ad |
| #447 | Decode error 3000 on Brave |

### ⚠️ PROBLÈME CRITIQUE — Conflit avec TwitchNoSub

Les scripts contiennent une logique de détection de conflit avec TwitchNoSub :

```javascript
const workerStringConflicts = ['twitch', 'isVariantA']; // TwitchNoSub
const workerStringReinsert = [
  'isVariantA',  // TwitchNoSub (prior to 0.9)
  'besuper/',    // TwitchNoSub (0.9)
  '${patch_url}' // TwitchNoSub (0.9.1)
];
```

**Problème :** Si TwitchNoSub ET TwVodNoAdsJCed sont installés ensemble, ils entrent en conflit. Le script essaie de "re-insérer" les workers de TwitchNoSub, mais ça peut créer des boucles infinies ou des crashes.

### Améliorations possibles

#### 🔴 Critiques

1. **Conflit TwitchNoSub** — La logique de reinsert est fragile. Si TwitchNoSub change son code, la détection casse.
2. **Strip script marqué "BAD"** — Le fichier `strip/strip.user.js` est toujours présent mais ne devrait pas être utilisé. Le supprimer ou le marquer clairement.
3. **@updateURL pointing to pixeltris** — Les URLs de mise à jour pointent vers `pixeltris/TwitchAdSolutions` (archivé), pas vers le fork Endymi0n74.
4. **@namespace pointing to pixeltris** — Même problème.
5. **Pas de version bump** — Le `ourTwitchAdSolutionsVersion` est à 24 dans vaft mais le `@version` du userscript est 37.0.0. Incohérent.

#### 🟡 Importants

6. **Pas de gestion d'erreurs pour GQLDeviceID** — Si le device ID n'est pas trouvé, le script génère un ID aléatoire. Ça peut être détecté par Twitch.
7. **localStorage hook fragile** — Le script essaie de hook `localStorage.setItem/getItem` pour préserver la qualité/volume. Firefox bloque ça, Chrome non. Le fallback est mal documenté.
8. **Pas de debouncing sur monitorPlayerBuffering** — La fonction tourne toutes les 600ms (`PlayerBufferingDelay`). Ça consomme du CPU inutilement.
9. **Hardcoded ClientID** — `kimne78kx3ncx6brgo4mv6wki5h1ko` est le ClientID public de Twitch. Si Twitch le révoque, tout casse.
10. **Pas de fallback si fetch échoue** — Si la requête GQL échoue, le script ne tente pas de retry.

#### 🟢 Mineures

11. **Pas de tests** — Aucun test unitaire ou d'intégration.
12. **Pas de linting** — Pas de ESLint/Prettier configuré.
13. **Pas de .gitignore** — Le repo n'en a pas.
14. **Pas de CHANGELOG** — Pas de documentation des changements.
15. **CI/CD basique** — Le workflow release.yml utilise `actions/create-release@v1` (déprécié).

### Files à ne jamais toucher sans raison

- `vaft/vaft-ublock-origin.js` — généré à partir de vaft.user.js
- `video-swap-new/video-swap-new-ublock-origin.js` — généré à partir de video-swap-new.user.js

### Backlog / améliorations restantes

- [ ] Résoudre le conflit TwitchNoSub proprement (utiliser un namespace commun ?)
- [ ] Supprimer ou isoler le script strip
- [ ] Mettre à jour les @updateURL/@namespace pour pointer vers ce fork
- [ ] Ajouter un mécanisme de retry pour les requêtes GQL
- [ ] Optimiser monitorPlayerBuffering (debounce, throttle)
- [ ] Ajouter des tests
- [ ] Configurer ESLint + Prettier
- [ ] Ajouter .gitignore
- [ ] Ajouter CHANGELOG.md
- [ ] Mettre à jour le workflow CI/CD

### Changelog v1.0.0 (25 août 2026)

- **Script combiné créé** — `combined/twitch-combined.user.js` (61 KB)
- Base = vaft.user.js (ad blocking) + TwitchNoSub restriction remover
- Metadata corrigée → @namespace, @updateURL pointent vers ce fork
- RestrictionRemover ajouté (5 sélecteurs CSS + debounce RAF)
- Conflit TwitchNoSub résolu (plus de logique de reinsert)

### Bug fix v1.0.1 - Closing metadata tag missing
- Issue:  was missing the trailing  (should be )
- Tampermonkey rejected the script as invalid
- Fix: added the missing  to line 13

### v1.0.0 — Améliorations fonctionnelles complètes

**Fiabilité :**
- Version synchronisée (@version 1.0.0 = ourTwitchAdSolutionsVersion = 1)
- GQL retry: 3 tentatives, exponential backoff (1s, 2s, 4s)
- Fetch filter: early return pour les URLs non-vidéo (réduit le CPU)

**Fonctionnalités :**
- Channel whitelist: `localStorage["twitchnosub-whitelist"]` = array de noms
- Stats counter: `localStorage["twitchnosub-stats"]` = {adsBlocked, vodsUnlocked}
- Toggle enable/disable: `localStorage["twitchnosub-enabled"]`
- Settings panel: Ctrl+Shift+T pour ouvrir le panneau de configuration
- Toast notifications: popup bottom-right quand les pubs sont bloquées/terminées

**Fichiers :**
- `combined/twitch-combined.user.js` — script principal (1208 lignes)
- `combined/build.js` — script de build (obsolète, **supprimé en v1.1.0**)

### Bug fix v1.0.1 - Midroll ad freeze
- Issue: stream freezes during midroll ads
- Cause: showToast() and stats.adsBlocked++ were called inside processM3U8 which runs in Worker context. Worker has no access to document/showToast/stats/saveStats → silent error breaks the ad stripping flow
- Fix: moved stats tracking and toast notifications to page-context message handler (UpdateAdBlockBanner event)

### Bug fix v1.0.2 - Error 3000 decoder
- Issue: Error 3000 (decoder error) during midroll ads
- Cause: aggressive fetch filter blocked legitimate non-video URLs that the player needs
- Fix: removed fetch filter entirely, hookFetch now works like original
- Note: fetch filter optimization deferred to future version with proper URL allowlist

### Bug fix v1.0.3 - Error 3000 (gqlRequestWithRetry missing in Worker)
- Issue: Error 3000 decoder error persists after v1.0.2
- Cause: gqlRequestWithRetry() was defined in page context but called by getAccessToken() inside Worker blob. Worker had no access to this function → ReferenceError → access token request fails → player cannot decode video
- Fix: added gqlRequestWithRetry.toString() to worker blob construction alongside gqlRequest
- Lesson: any function called from Worker blob must be included in the blob stringification

### Toast fix v1.0.4
- Issue: toast notifications not showing
- Cause 1: condition was too strict (only midroll), changed to trigger on all ad types
- Cause 2: "Ads finished" toast was in Worker context (processM3U8), moved to page context
- Now shows: "Ad blocked" / "Midroll ad blocked" when ads detected, "Ads finished" when ads end

### UI v1.0.5 - Side panel settings
- Replaced toast notifications with floating button + collapsible side panel
- Button: bottom-right, purple circle with gear icon, opens/closes panel
- Panel: right side, slides in with animation, dark Twitch theme
- Features: toggle switches for adBlocking/restrictionRemoval/bufferingFix, stats display, disable button
- Toggle switches use custom CSS (no external dependencies)

### UI v1.0.6 - Cleaner panel (v2)
- Replaced inline-style panel with a single injected `<style>` tag (`.tns-*` classes) — maintenable, plus léger
- Floating button → pill `⚙ Settings` (hover scale + color), remplace le rond icône-only
- Panel : header (titre + bouton ✕), sections `Settings` / `Stats`, footer avec bouton disable
- Toggles mis à jour **en place** (classList.toggle) — plus de re-render complet du panel → plus de flicker
- Stats en cartes grid 2 colonnes (Ads blocked / VODs unlocked)
- Fermeture du panel avec la touche **Échap**
- Fond #0e0e10, accents #9146FF, thème sombre Twitch
- Aucun changement de comportement (settings/stats/toggleEnabled identiques)

### v1.0.7 - Panneau abandonné + fix VODs sub-only (cause racine)

**Panneau d'options SUPPRIMÉ** (demande utilisateur) :
- Retiré : settings (adBlocking/restrictionRemoval/bufferingFix), toggleEnabled, bouton flottant, menu déroulant, tout le CSS `.tns-*`
- Le kill-switch `twitchnosub-enabled` (localStorage) est conservé — désactiver manuellement via la console si besoin
- Stats `adsBlocked/vodsUnlocked` conservées (sans UI)

**Cause racine du bug « les VODs sub-only n'affichent pas » :**
- Twitch ne joue plus la vidéo derrière le paywall : **usher renvoie un 403 serveur** pour `usher.ttvnw.net/vod/{id}.m3u8` sur les VODs sub-only
- Le RestrictionRemover (suppression d'overlays CSS) ne peut plus rien — la vidéo ne charge jamais
- Les 5 sélecteurs CSS dataient d'avant la migration IVS

**Fix v1.0.7 — Bypass VOD dans le hook Worker (méthode TwitchNoSub actuelle) :**
- Nouvelle branche dans `hookWorkerFetch` : si `usher.ttvnw.net/vod/` répond autre chose que 200 → `buildVodPlaylist()`
- `buildVodPlaylist` : requête GQL `video(id)` → `seekPreviewsURL` donne le chemin CDN → construit un playlist m3u8 direct (`{domain}/{vodSpecialID}/{quality}/index-dvr.m3u8`)
- Qualités vérifiées une à une (`isValidQuality`, codec avc/h265 détecté via init-0.mp4), fallback 403 si aucune
- Gère `highlight`, `upload` (>7j), et usher v1/v2 (IVS-NAME/IVS-VARIANT-SOURCE)
- Fonctions ajoutées au blob Worker : `buildVodPlaylist`, `isValidQuality`, `createServingID`
- VODs normales (200) : pass-through inchangé — aucun risque de régression
- Leçon : TwitchNoSub = patch worker Amazon IVS (importScripts) en extension ; en userscript on intègre le bypass directement dans le hook vaft existant
- Non fait : le trick audio `-unmuted → -muted` de TwitchNoSub (VODs mutées) — à tester

### v1.0.8 - Trick audio : dé-muter les VODs (TwitchNoSub)
- Ajouté dans la branche m3u8 de `hookWorkerFetch` : pour les playlists **cloudfront** (CDN VOD), remplacement `-unmuted` → `-muted`
- Explication : Twitch sert les segments mutés sous des noms `-unmuted` ; les segments avec le son d'origine existent sous `-muted` — le swap les récupère
- Appliqué AVANT `processM3U8` → pas de conflit avec le stripping de pubs des lives (hostnames `*.hls.ttvnw.net` ne matchent pas `cloudfront`, et pas de `-unmuted` dans les lives)
- Mirroir exact de la transformation de besuper/TwitchNoSub (testée en production)

### v1.0.9 - Stats en console (au lieu du panneau)
- `logStats()` : résumé au chargement (Pubs bloquées / VODs débloquées) avec style %c violet
- Log direct à chaque événement : `📺 Pub bloquée — total : N` (handler UpdateAdBlockBanner) et `🎬 VOD sub-only débloquée — total : N`
- Le worker envoie `postMessage({key:'VodBypassed'})` après un bypass réussi → le contexte page incrémente `stats.vodsUnlocked` (qui n'était jamais incrémenté avant !)
- Stats persistées dans `twitchnosub-stats` (localStorage), comme avant

### v1.1.0 - Deux boutons dans la barre d'actions de la chaîne
- **📊 Stats** : affiche un toast (3s) avec Pubs bloquées / VODs débloquées
- **⏻ ON/OFF** : active/désactive le script (`twitchnosub-enabled`) + reload ; état OFF affiché en rouge
- Injection **à gauche de la barre du bas du header** (celle avec viewers/durée/partage/⋮) — au niveau de la flèche utilisateur : ancrage `[data-a-target="channel-actions"]` (⋮) ou `share-button`, fallback gift-button parent
- Les 2 boutons côte à côte, prepend dans le container (ordre : 📊 Stats, ⏻ ON)
- `MutationObserver` : ré-injection si le header est re-rendu (navigation SPA)
- Si le script est désactivé : seul le bouton ⏻ OFF est injecté (pour réactiver) — le reste du script ne tourne pas
- `toggleEnabled()` réintroduit (avait été supprimé avec le panneau)

### Release v1.1.0 - Renommage + publication GitHub
- Dossier renommé `twitchadsjcedition` → `TwVodNoAdsJCed`
- Header userscript mis à jour : `@name` = TwVodNoAdsJCed, `@namespace`/`@updateURL`/`@downloadURL` → `Endymi0n74/TwVodNoAdsJCed`, `@version` 1.1.0
- Nettoyage : `combined/build.js` (cassé) et `strip/` (BAD) supprimés ; la Copie avait déjà disparu
- Fichiers du repo : `combined/twitch-combined.user.js`, README.md (réécrit), CHANGELOG.md (nouveau), MEMORY.md, issues.md, LICENSE (MIT)
- `vaft/` et `video-swap-new/` conservés (scripts upstream d'origine, le combiné en dérive)
- Poussé sur GitHub : [Endymi0n74/TwVodNoAdsJCed](https://github.com/Endymi0n74/TwVodNoAdsJCed)
