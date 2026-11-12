# 📋 MEMORY — TwVodNoAdsJCed (version modulaire locale)

**Règle immuable :** MEMORY.md MUST be updated after every code change — no exceptions.

## État actuel

- **Répertoire de travail :** `D:\codex\TwVodNoAdsJCed`
- **Version :** 1.1.5 (équivalente au repo GitHub `Endymi0n74/TwVodNoAdsJCed`)
- **Statut :** build modulaire opérationnel, tous les tests OK

## Structure (modulaire)

```
D:\codex\TwVodNoAdsJCed/
├── .gitignore
├── .eslintrc.json
├── .prettierrc
├── package.json
├── build.js                    # Concatène src/ → combined/twitch-combined.user.js
├── combined/
│   ├── twitch-combined.user.js # Généré par build.js (à installer dans Tampermonkey)
│   ├── test-buildVodPlaylist.js # Harness de test Node (110 assertions)
│   └── test-unit.js             # Tests unitaires (stripAdSegments, parseAttributes, hookFetch — 18 assertions)
├── src/
│   ├── core/
│   │   ├── globals.js          # TOUTES les variables globales partagées (déclarées en premier, TDZ-safe)
│   │   ├── declareOptions.js   # Options par défaut (scope page + worker)
├── .github/
│   └── workflows/
│       ├── ci.yml               # CI sur push/PR master : lint, format, check, tests
│       └── release.yml          # Release auto sur tag v* : vérifie version, build, release GH
├── src/
│   ├── core/
│   │   ├── declareOptions.js    # Options par défaut (scope page + worker)
│   │   ├── server-time.js       # getServerTimeFromM3u8 / replaceServerTimeInM3u8
│   │   ├── attributes.js        # parseAttributes (m3u8)
│   │   ├── vod.js               # buildVodPlaylist, isValidQuality, createServingID
│   │   ├── gql.js               # gqlRequest, gqlRequestWithRetry (retry 1s/2s/4s)
│   │   ├── access-token.js      # getAccessToken (PlaybackAccessToken)
│   │   ├── fetch-worker.js      # hookWorkerFetch (hook fetch dans le worker)
│   │   ├── worker-utils.js      # hookWindowWorker (injection Worker blob)
│   │   ├── ads.js               # stripAdSegments, processM3U8, getStreamUrlForResolution
│   │   ├── player.js            # getPlayerAndState, doTwitchPlayerTask, monitorPlayerBuffering
│   │   ├── fetch-hook.js        # hookFetch (contexte page), handleWorkerFetchRequest
│   │   └── storage.js           # stats, saveStats, logStats, kill-switches, applyFeatureFlag
│   ├── ui.js                    # Boutons header, panneau stats, CSS (MutationObserver)
│   └── main.js                  # Orchestration, onContentLoaded, assemble final
└── MEMORY.md
```

## Commandes

| Commande | Rôle |
|----------|------|
| `node build.js` | Regénère `combined/twitch-combined.user.js` depuis `src/` |
| `node --check combined/twitch-combined.user.js` | Vérification syntaxe JS |
| `node combined/test-buildVodPlaylist.js` | Tests du bypass VOD + portes pubs/VODs (110 assertions) |
| `node combined/test-unit.js` | Tests unitaires (stripAdSegments, parseAttributes, hookFetch — 18 assertions) |
| `npm run lint` | ESLint sur `src/` et `build.js` |
| `npm run format` | Prettier sur `src/` et `build.js` |

## Améliorations 1→5 déjà appliquées

1. **XMLHttpRequest synchrone** (`worker-utils.js`) : `getWasmWorkerJs` garde la lecture synchrone (nécessaire dans le constructeur `new Worker()` synchrone de Twitch) mais avec gestion d'erreur propre (try/catch, vérification HTTP status, console.error). Ajout de `getWasmWorkerJsAsync` (fetch) pour usages futurs.
2. **setInterval → MutationObserver** (`ui.js`) : `injectHeaderButtons` utilise maintenant un `MutationObserver` sur `document.documentElement` qui se déconnecte après la première injection réussie, avec timeout de sécurité 10s. Plus de polling toutes les 2s.
3. **Tests unitaires** (`combined/test-unit.js`) : couverture de `stripAdSegments` (cache, compteur, PREFETCH, AllSegmentsAreAdSegments), `parseAttributes` (CODECS, RESOLUTION, BANDWIDTH, FRAME-RATE), `hookFetch` (picture-by-picture, UpdateDeviceId, passthrough non-GQL).
4. **CI GitHub Actions** : `.github/workflows/ci.yml` (lint + format + check + 2 harness sur push/PR) et `.github/workflows/release.yml` (vérifie `@version` == tag, build, tests, release GH avec pièce jointe).
5. **JSDoc** : toutes les fonctions publiques des 14 modules `src/` ont des JSDoc complets (@param, @returns, @example, @type).

## Points d'attention (régressions à éviter)

1. **Ordre de concaténation dans build.js** : les fonctions déclarées avec `function` sont hissées, mais l'ordre doit rester logique.
2. **Blob Worker** : `hookWorkerFetch` et `hookWindowWorker` construisent un blob qui fait `${maFonction.toString()}`. Toute fonction appelée depuis le blob doit être déclarée dans un module concaténé.
3. **Variables globales du worker** : `GQLDeviceID`, `AuthorizationHeader`, `ClientVersion`, `ClientSession`, `ClientIntegrityHeader`, `tnsAdsEnabled`, `tnsVodsEnabled` sont injectées dans le blob à sa construction.
4. **`isActivelyStrippingAds`** : variable partagée entre le handler de message du worker et `monitorPlayerBuffering`.
5. **Pas de `try/catch {}` vide** : ajouter au moins un `console.warn` dans les blocs catch (règle ESLint `no-empty` avec `allowEmptyCatch: false`).
6. **Taille du .user.js** : les JSDoc sont inclus dans le fichier généré (95.4 Ko). Acceptable pour Tampermonkey.

## Correctifs récents

- **Blocage des midroll ads (processM3U8, src/core/ads.js)** : le `return textStr` précoce quand `streamInfo.Urls[url]` est absent (cas des midrolls, dont l'URL m3u8 n'est pas dans la map des résolutions du live) empêchait tout stripping/backup-player → le midroll fuyait. Le stripping (`stripAdSegments`, détection par `AdSignifier`) s'applique maintenant même sans `currentResolution` ; seul le backup player (qui nécessite `currentResolution`) reste conditionné. Les midrolls sont de nouveau bloqués.

- **Midrolls dont l'URL n'est pas enregistrée (processM3U8, src/core/ads.js)** : quand `StreamInfosByUrl[url]` est undefined (midroll jamais vu via `/channel/hls/`), la fonction retournait `textStr` brut sans aucun stripping. Elle crée maintenant un `streamInfo` minimal temporaire (`IsTemporary: true`), **persisté** dans `StreamInfosByUrl[url]` pour que `IsShowingAd` survive aux refreshs du playlist (évite le spam de « Pub bloquée »), et supprimé en fin de pub. Le cache `AdSegmentCache` partagé assure la déduplication.

- **`updateAdblockBanner` manquante (src/core/player.js)** : perdue lors du refactor modulaire (appelée par `worker-utils.js` et `player.js`, jamais définie) → `ReferenceError` à chaque `UpdateAdBlockBanner`. Réimplémentée d'après vaft : overlay `.adblock-overlay` dans `.video-player`, texte « Blocking [midroll] ads (stripping) », met à jour `isActivelyStrippingAds`.

- **Coquille `EncodingsM3u8` (src/core/fetch-worker.js)** : la condition testait `EncodingsM3U8` (majuscule) mais appelait `.match` sur `EncodingsM3u8` (minuscule, inexistant) → `TypeError: Cannot read properties of undefined (reading 'match')` à chaque requête `/channel/hls/`. Corrigé (bonne casse + match nul géré). `getServerTimeFromM3u8` retourne aussi `null` si le playlist est absent/falsy.

## Fichiers à ne jamais toucher sans raison

- `combined/test-buildVodPlaylist.js` — harness de test, doit rester synchronisé avec `src/`
- `combined/test-unit.js` — tests unitaires, doit rester synchronisé avec `src/`

## Backlog restant (après améliorations 1→5)

- [ ] Remplacer définitivement le XHR synchrone dans `getWasmWorkerJs` (nécessite restructuration du constructeur Worker)
- [ ] Ajouter des tests pour `getPlayerAndState`, `doTwitchPlayerTask`
- [ ] Mettre à jour le repo GitHub avec cette version modulaire
