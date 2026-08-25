# Changelog

## v1.1.1 (2026-08-25)
- **Fix double comptage `vodsUnlocked`** : le worker envoie maintenant le `vodId` avec `VodBypassed`, le contexte page dédoublonne via un `Set` de session → les re-fetch du player (switch de qualité, retries) ne comptent plus la même VOD plusieurs fois
- **Retry GQL dans `buildVodPlaylist`** : la requête de métadonnées VOD passe par `gqlRequestWithRetry` (backoff 1s/2s/4s, 3 tentatives) au lieu d'un fetch brut à un seul essai
- **Fix boutons absents sur la page chaîne** : `share-button` devient l'ancrage principal (unique à la barre), le ⋮ prend le dernier match (la nav du haut en a un aussi), et l'injection est ré-essayée toutes les 2s → plus de boutons perdus au re-render du header
- **Panneau Stats** : le bouton 📊 ouvre un menu déroulant (stats + toggles), le toast est supprimé
- **Toggles indépendants pubs / VODs** : `twitchnosub-ads` / `twitchnosub-vods` (localStorage) → on peut garder le blocage des pubs tout en désactivant le bypass VOD (ou l'inverse), portes branchées dans le worker (usher/m3u8/channel-hls) et la page (token, bannière, buffering)
- **Application à chaud (sans reload)** : les toggles envoient `UpdateFeatureFlags` aux workers via postMessage, les flags page sont mutables, le pill se met à jour instantanément — seul le bouton maître ⏻ ON/OFF recharge encore la page

## v1.1.0 (2026-08-25)
- Renommage du projet en **TwVodNoAdsJCed** + publication GitHub
- Header userscript mis à jour : `@name` = TwVodNoAdsJCed, `@namespace` / `@updateURL` / `@downloadURL` → `Endymi0n74/TwVodNoAdsJCed`, `@version` 1.1.0
- Boutons **📊 Stats** et **⏻ ON/OFF** placés dans la barre du bas du header (à gauche, au niveau viewers/durée)
- Nettoyage : `combined/build.js` (cassé) et `strip/` (marqué BAD) supprimés

## v1.0.9 (2026-08-25)
- Stats en console au chargement + logs en direct (`📺 Pub bloquée`, `🎬 VOD sub-only débloquée`)
- Le compteur `vodsUnlocked` est enfin incrémenté : le worker envoie `VodBypassed` au contexte page après un bypass réussi

## v1.0.8 (2026-08-25)
- **Trick audio** : dé-mute des VODs — remplacement `-unmuted` → `-muted` dans les playlists cloudfront (méthode TwitchNoSub)

## v1.0.7 (2026-08-25)
- **Fix VODs sub-only (cause racine)** : Twitch renvoie un 403 serveur sur `usher.ttvnw.net/vod/` → le script construit un playlist CDN direct depuis les métadonnées GQL (`seekPreviewsURL`), qualité par qualité
- Panneau d'options supprimé (demande utilisateur) — le kill-switch `twitchnosub-enabled` est conservé

## v1.0.6 (2026-08-25)
- UI v2 : styles centralisés, toggles sans re-render, stats en cartes (abandonné en v1.0.7)

## v1.0.5 (2026-08-25)
- UI : panneau latéral coulissant (bouton flottant + toggles + stats + bouton disable)

## v1.0.4 (2026-08-25)
- Toasts corrigés — déclenchés sur tous les types de pub

## v1.0.3 (2026-08-25)
- Error 3000 : `gqlRequestWithRetry` ajouté au blob Worker (appelé par `getAccessToken` dans le worker)

## v1.0.2 (2026-08-25)
- Error 3000 : fetch filter agressif retiré (bloquait des URLs légitimes)

## v1.0.1 (2026-08-25)
- Freeze midroll : stats/toasts déplacés du contexte Worker vers le contexte page

## v1.0.0 (2026-08-25)
- Script combiné : `vaft` (ad blocking) + RestrictionRemover (VODs sub-only)
- GQL retry (3 tentatives, backoff exponentiel), whitelist, stats, settings, toasts
- Métadonnées corrigées (@namespace/@updateURL → ce fork)
