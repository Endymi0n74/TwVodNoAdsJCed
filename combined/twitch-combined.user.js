// ==UserScript==
// @name         TwVodNoAdsJCed
// @namespace    https://github.com/Endymi0n74/TwVodNoAdsJCed
// @version      1.1.4
// @description  Block Twitch ads + watch sub-only VODs (with unmute)
// @updateURL    https://raw.githubusercontent.com/Endymi0n74/TwVodNoAdsJCed/master/combined/twitch-combined.user.js
// @downloadURL  https://raw.githubusercontent.com/Endymi0n74/TwVodNoAdsJCed/master/combined/twitch-combined.user.js
// @author       Endymi0n74
// @match        *://*.twitch.tv/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==
(function() {
    'use strict';


// === core/globals.js ===

/* globals window, document, localStorage, location, console */

/**
 * Variables globales partagées entre tous les modules.
 * Déclarées en premier pour éviter les erreurs de référence temporelle (TDZ)
 * liées à l'ordre de concaténation des modules.
 */

/** @type {Array<Function>} Liste des workers Twitch interceptés. */
const twitchWorkers = [];

/**
 * État du stripping de publicités (mis à jour par le worker via UpdateAdBlockBanner).
 * @type {boolean}
 */
let isActivelyStrippingAds = false;

/**
 * Indique si le hook localStorage a échoué (Firefox).
 * @type {boolean}
 */
let localStorageHookFailed = false;

/**
 * Statistiques persistantes (pubs bloquées / VODs débloquées).
 * @type {{adsBlocked: number, vodsUnlocked: number}}
 */
const stats = {adsBlocked: 0, vodsUnlocked: 0};

/**
 * Ensemble des IDs de VOD déjà débloquées (session en cours).
 * @type {Set<string>}
 */
const seenVodIds = new Set();

/**
 * Kill-switch pour le blocage de pubs.
 * @type {boolean}
 */
let tnsAdsEnabled = localStorage.getItem("twitchnosub-ads") !== "false";

/**
 * Kill-switch pour le bypass VOD sub-only.
 * @type {boolean}
 */
let tnsVodsEnabled = localStorage.getItem("twitchnosub-vods") !== "false";

/**
 * État global du script (ON/OFF via le bouton header).
 * @type {boolean}
 */
let isEnabled = localStorage.getItem("twitchnosub-enabled") !== "false";

/**
 * Référence au player pour la surveillance du buffering.
 * @type {Object|null}
 */
let playerForMonitoringBuffering = null;

/**
 * État du buffering du player.
 * @type {Object}
 */
const playerBufferState = {
    channelName: null,
    hasStreamStarted: false,
    position: 0,
    bufferedPosition: 0,
    bufferDuration: 0,
    numSame: 0,
    lastFixTime: 0,
    isLive: true
};


// === fin core/globals.js ===


// === core/declareOptions.js ===

/**
 * Déclare les options par défaut du script dans le scope donné (page ou worker).
 *
 * Ces options configurent le comportement du blocage de pubs, du buffering,
 * du choix des joueurs de secours, et les en-têtes GQL.
 *
 * @param {Object} scope - Objet cible (window pour le contexte page, self pour le worker)
 * @returns {void}
 *
 * @example
 * declareOptions(window);
 * declareOptions(self); // dans le worker
 */
function declareOptions(scope) {
    /** @type {string} Marqueur identifiant les segments publicitaires dans les m3u8 */
    scope.AdSignifier = 'stitched';
    /** @type {string} Client ID public de l'API Twitch */
    scope.ClientID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
    /** @type {Array<string>} Types de joueurs utilisés comme source de secours pendant les pubs */
    scope.BackupPlayerTypes = [
        'embed',//Source
        'popout',//Source
        'autoplay',//360p
        //'picture-by-picture-CACHED'//360p (-CACHED is an internal suffix and is removed)
    ];
    /** @type {string} Type de joueur de fallback quand aucun backup n'est disponible */
    scope.FallbackPlayerType = 'embed';
    /** @type {string} Type de joueur forcé pour les tokens d'accès */
    scope.ForceAccessTokenPlayerType = 'popout';
    /** @type {boolean} Si true, saute le reload du player sur les streams HEVC (2k/4k) */
    scope.SkipPlayerReloadOnHevc = false;
    /** @type {boolean} Si true, fait pause/play à chaque entrée/sortie de pub */
    scope.AlwaysReloadPlayerOnAd = false;
    /** @type {boolean} Si true, reload le player après la fin des pubs au lieu de pause/play */
    scope.ReloadPlayerAfterAd = true;
    /** @type {number} Délai minimal (ms) entre deux requêtes de reload du player */
    scope.PlayerReloadMinimalRequestsTime = 1500;
    /** @type {number} Index du joueur utilisé pour les requêtes minimales pendant le reload */
    scope.PlayerReloadMinimalRequestsPlayerIndex = 2;//autoplay
    /** @type {boolean} Si true, le reload du player a déjà été déclenché */
    scope.HasTriggeredPlayerReload = false;
    /** @type {Array} Infos des streams (indexé par nom de chaîne) */
    scope.StreamInfos = [];
    /** @type {Array} Infos des streams (indexé par URL m3u8) */
    scope.StreamInfosByUrl = [];
    /** @type {string|null} ID de périphérique GQL généré ou récupéré */
    scope.GQLDeviceID = null;
    /** @type {string|null} Version du client Twitch */
    scope.ClientVersion = null;
    /** @type {string|null} Session client Twitch */
    scope.ClientSession = null;
    /** @type {string|null} En-tête d'intégrité client Twitch */
    scope.ClientIntegrityHeader = null;
    /** @type {string|undefined} En-tête d'autorisation Twitch */
    scope.AuthorizationHeader = undefined;
    /** @type {number} Profondeur de pubs simulées (0 = aucune) */
    scope.SimulatedAdsDepth = 0;
    /** @type {boolean} Active la correction de buffering du player */
    scope.PlayerBufferingFix = true;
    /** @type {number} Fréquence de vérification du buffering (ms) */
    scope.PlayerBufferingDelay = 600;
    /** @type {number} Nombre d'états identiques avant déclenchement du fix */
    scope.PlayerBufferingSameStateCount = 3;
    /** @type {number} Délai de buffer restant (s) sous lequel on ignore la position */
    scope.PlayerBufferingDangerZone = 1;
    /** @type {boolean} Si true, fait un reload du player au lieu de pause/play pour le buffering */
    scope.PlayerBufferingDoPlayerReload = false;
    /** @type {number} Délai minimal (ms) entre deux pause/play de buffering */
    scope.PlayerBufferingMinRepeatDelay = 8000;
    /** @type {boolean} Active la vérification de pré-roll pour le buffering */
    scope.PlayerBufferingPrerollCheckEnabled = false;
    /** @type {number} Position minimale (s) avant vérification de pré-roll */
    scope.PlayerBufferingPrerollCheckOffset = 5;
    /** @type {boolean} Utilise l'API v2 pour les requêtes usher */
    scope.V2API = false;
    /** @type {boolean} Active le stripping de segments publicitaires */
    scope.IsAdStrippingEnabled = true;
    /** @type {Map<string, number>} Cache des URLs de segments publicitaires (URL → timestamp) */
    scope.AdSegmentCache = new Map();
    /** @type {boolean} Si true, tous les segments sont considérés comme des pubs */
    scope.AllSegmentsAreAdSegments = false;
}


// === fin core/declareOptions.js ===


// === core/server-time.js ===

/**
 * Extrait l'heure du serveur depuis un playlist m3u8 d'encodages.
 *
 * Selon la version de l'API (V2API), le format est soit
 * `#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE="..."` (v2),
 * soit `SERVER-TIME="..."` (v1).
 *
 * @param {string} encodingsM3u8 - Contenu du playlist d'encodages m3u8
 * @returns {string|null} L'heure du serveur, ou null si non trouvée
 */
function getServerTimeFromM3u8(encodingsM3u8) {
    if (V2API) {
        const matches = encodingsM3u8.match(/#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE="([^"]+)"/);
        return matches.length > 1 ? matches[1] : null;
    }
    const matches = encodingsM3u8.match('SERVER-TIME="([0-9.]+)"');
    return matches.length > 1 ? matches[1] : null;
}

/**
 * Remplace l'heure du serveur dans un playlist m3u8.
 *
 * @param {string} encodingsM3u8 - Contenu du playlist m3u8
 * @param {string|null} newServerTime - Nouvelle heure du serveur, ou null pour ne pas modifier
 * @returns {string} Le playlist avec l'heure du serveur remplacée
 */
function replaceServerTimeInM3u8(encodingsM3u8, newServerTime) {
    if (V2API) {
        return newServerTime ? encodingsM3u8.replace(/(#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE=")[^"]+(")/, `$1${newServerTime}$2`) : encodingsM3u8;
    }
    return newServerTime ? encodingsM3u8.replace(new RegExp('(SERVER-TIME=")[0-9.]+"'), `SERVER-TIME="${newServerTime}"`) : encodingsM3u8;
}


// === fin core/server-time.js ===


// === core/attributes.js ===

/**
 * Parse les attributs d'une ligne #EXT-X-STREAM-INF d'un playlist m3u8.
 *
 * Supporte les formats :
 * - `CODECS="avc1.4D001E,mp4a.40.2"` (valeur entre guillemets)
 * - `BANDWIDTH=8534030` (valeur non quotée, convertie en nombre si possible)
 * - `AUTOSELECT=YES` (valeur non quotée, laissée en chaîne)
 *
 * @param {string} str - Chaîne d'attributs (après les deux-points du #EXT-X-STREAM-INF)
 * @returns {Object} Dictionnaire clé → valeur (les valeurs numériques sont converties en Number)
 *
 * @example
 * parseAttributes('CODECS="avc1.4D001E",RESOLUTION="1920x1080",BANDWIDTH=1000')
 * // → { CODECS: 'avc1.4D001E', RESOLUTION: '1920x1080', BANDWIDTH: 1000 }
 */
function parseAttributes(str) {
    return Object.fromEntries(
        str.split(/(?:^|,)((?:[^=]*)=(?:"[^"]*"|[^,]*))/)
        .filter(Boolean)
        .map(x => {
            const idx = x.indexOf('=');
            const key = x.substring(0, idx);
            const value = x.substring(idx + 1);
            const num = Number(value);
            return [key, Number.isNaN(num) ? value.startsWith('"') ? JSON.parse(value) : value : num];
        }));
}


// === fin core/attributes.js ===


// === core/vod.js ===

/**
 * Crée un Serving-ID aléatoire de 32 caractères alphanumériques.
 *
 * Utilisé pour simuler l'en-tête #EXT-X-TWITCH-INFO des playlists VOD.
 *
 * @returns {string} Serving-ID de 32 caractères
 */
function createServingID() {
    const w = '0123456789abcdefghijklmnopqrstuvwxyz'.split('');
    let id = '';
    for (let i = 0; i < 32; i++) {
        id += w[Math.floor(Math.random() * w.length)];
    }
    return id;
}

/**
 * Vérifie qu'une qualité de playlist VOD est valide sur le CDN et détecte le codec.
 *
 * Récupère le playlist, puis s'il contient des segments .ts → codec avc1.
 * S'il contient des segments .mp4 → récupère init-0.mp4 pour détecter hev1 ou avc1.
 *
 * @param {string} playlistUrl - URL du playlist qualité sur le CDN
 * @param {Function} realFetch - Fonction fetch du contexte worker
 * @returns {Promise<{codec: string}|null>} Objet { codec } si valide, null sinon
 */
function isValidQuality(playlistUrl, realFetch) {
    return realFetch(playlistUrl, { cache: 'force-cache' }).then(function(response) {
        if (!response.ok) { return null; }
        return response.text().then(function(data) {
            if (data.includes('.ts')) {
                return { codec: 'avc1.4D001E' };
            }
            if (data.includes('.mp4')) {
                return realFetch(playlistUrl.replace('index-dvr.m3u8', 'init-0.mp4'), { cache: 'force-cache' }).then(function(mp4Request) {
                    if (mp4Request.ok) {
                        return mp4Request.text().then(function(content) {
                            return { codec: content.includes('hev1') ? 'hev1.1.6.L93.B0' : 'avc1.4D001E' };
                        });
                    }
                    return { codec: 'hev1.1.6.L93.B0' };
                });
            }
            return null;
        });
    });
}

/**
 * Bypass usher 403 pour les VODs sub-only.
 *
 * Quand usher.ttvnw.net/vod/ répond 403 (VOD réservée aux abonnés),
 * construit un playlist CDN direct à partir des métadonnées GQL
 * (seekPreviewsURL révèle le chemin CDN). Méthode basée sur TwitchNoSub.
 *
 * Gère les trois types de broadcast :
 * - highlight : `{domain}/{vodSpecialID}/{quality}/highlight-{vodId}.m3u8`
 * - upload (>7j) : `{domain}/{owner}/{vodId}/{vodSpecialID}/{quality}/index-dvr.m3u8`
 * - standard : `{domain}/{vodSpecialID}/{quality}/index-dvr.m3u8`
 *
 * @param {string} url - URL usher du VOD (ex: usher.ttvnw.net/vod/{id}.m3u8)
 * @param {Function} realFetch - Fonction fetch du contexte worker
 * @returns {Promise<Response>} Playlist m3u8 généré (status 200) ou erreur (status 403)
 *
 * @example
 * const resp = await buildVodPlaylist('https://usher.ttvnw.net/vod/123456789.m3u8', fetch);
 * // status 200 avec un playlist #EXTM3U contenant les variantes de qualité
 */
function buildVodPlaylist(url, realFetch) {
    return (async function() {
        const vodId = (new URL(url)).pathname.split('/').pop().replace(/\.m3u8.*$/, '');
        const isUsherV2 = url.includes('/vod/v2');
        console.log('Building bypass playlist for VOD ' + vodId);
        let gqlData;
        try {
            const gqlResp = await gqlRequestWithRetry({
                query: 'query { video(id: "' + vodId + '") { broadcastType, createdAt, seekPreviewsURL, owner { login } } }'
            }, 'site');
            gqlData = await gqlResp.json();
        } catch (err) {
            console.log('VOD bypass: GQL failed after retries: ' + err.message);
            return new Response('VOD bypass: GQL failed', { status: 403 });
        }
        const vodData = gqlData && gqlData.data && gqlData.data.video;
        if (!vodData || !vodData.seekPreviewsURL) {
            console.log('VOD bypass: missing metadata for ' + vodId);
            return new Response('Missing VOD metadata', { status: 403 });
        }
        const seekUrl = new URL(vodData.seekPreviewsURL);
        const domain = seekUrl.host;
        const paths = seekUrl.pathname.split('/');
        const vodSpecialID = paths[paths.findIndex(function(p) { return p.includes('storyboards'); }) - 1];
        const broadcastType = vodData.broadcastType.toLowerCase();
        const created = new Date(vodData.createdAt);
        const daysSince = (new Date('2023-02-10').getTime() - created.getTime()) / (1000 * 3600 * 24);
        const defaultResolutions = {
            '160p30': { name: '160p', resolution: '284x160', frameRate: 30 },
            '360p30': { name: '360p', resolution: '640x360', frameRate: 30 },
            '480p30': { name: '480p', resolution: '854x480', frameRate: 30 },
            '720p60': { name: '720p60', resolution: '1280x720', frameRate: 60 },
            '1080p60': { name: '1080p60', resolution: '1920x1080', frameRate: 60 },
            '1440p60': { name: '1440p60', resolution: '2560x1440', frameRate: 60 },
            'chunked': { name: 'chunked', resolution: 'chunked', frameRate: 60 }
        };
        let fakePlaylist = '#EXTM3U\n#EXT-X-TWITCH-INFO:ORIGIN="s3",B="false",REGION="EU",USER-IP="127.0.0.1",SERVING-ID="' + createServingID() + '",CLUSTER="cloudfront_vod",USER-COUNTRY="BE",MANIFEST-CLUSTER="cloudfront_vod"';
        let bitrate = 8534030;
        const resKeys = ['chunked', '1440p60', '1080p60', '720p60', '480p30', '360p30', '160p30'];
        for (let i = 0; i < resKeys.length; i++) {
            const resKey = resKeys[i];
            let playlistUrl;
            if (broadcastType === 'highlight') {
                playlistUrl = 'https://' + domain + '/' + vodSpecialID + '/' + resKey + '/highlight-' + vodId + '.m3u8';
            } else if (broadcastType === 'upload' && daysSince > 7) {
                playlistUrl = 'https://' + domain + '/' + vodData.owner.login + '/' + vodId + '/' + vodSpecialID + '/' + resKey + '/index-dvr.m3u8';
            } else {
                playlistUrl = 'https://' + domain + '/' + vodSpecialID + '/' + resKey + '/index-dvr.m3u8';
            }
            const quality = await isValidQuality(playlistUrl, realFetch);
            if (quality) {
                const resValue = defaultResolutions[resKey];
                if (isUsherV2) {
                    const variantSource = resKey == 'chunked' ? 'source' : 'transcode';
                    fakePlaylist += '\n#EXT-X-STREAM-INF:BANDWIDTH=' + bitrate + ',CODECS="' + quality.codec + ',mp4a.40.2",RESOLUTION=' + resValue.resolution + ',FRAME-RATE=' + resValue.frameRate + ',STABLE-VARIANT-ID="' + resKey + '",IVS-NAME="' + resValue.name + '",IVS-VARIANT-SOURCE="' + variantSource + '"\n' + playlistUrl;
                } else {
                    const enabled = resKey == 'chunked' ? 'YES' : 'NO';
                    fakePlaylist += '\n#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="' + resKey + '",NAME="' + resKey + '",AUTOSELECT=' + enabled + ',DEFAULT=' + enabled + '\n#EXT-X-STREAM-INF:BANDWIDTH=' + bitrate + ',CODECS="' + quality.codec + ',mp4a.40.2",RESOLUTION=' + resValue.resolution + ',VIDEO="' + resValue.name + '",FRAME-RATE=' + resValue.frameRate + '\n' + playlistUrl;
                }
                bitrate -= 100;
            }
        }
        if (!fakePlaylist.includes('#EXT-X-STREAM-INF')) {
            console.log('VOD bypass: no valid quality found for ' + vodId);
            return new Response('No valid quality found', { status: 403 });
        }
        console.log('VOD bypass: serving generated playlist for ' + vodId);
        postMessage({ key: 'VodBypassed', vodId: vodId });
        return new Response(fakePlaylist, { status: 200, headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
    })();
}


// === fin core/vod.js ===


// === core/gql.js ===

/* globals ClientID, GQLDeviceID, AuthorizationHeader, ClientIntegrityHeader,
         ClientVersion, ClientSession, postTwitchWorkerMessage, pendingFetchRequests,
         gqlRequestWithRetry */

/** @type {number} Nombre maximum de tentatives pour les requêtes GQL. */
const GQL_MAX_RETRIES = 3;

/** @type {number} Délai de base (ms) pour le backoff exponentiel des requêtes GQL. */
const GQL_BASE_DELAY = 1000;

/**
 * Construit et envoie une requête GQL via le round-trip worker <-> page.
 *
 * La requête est envoyée au contexte page via postMessage (FetchRequest),
 * qui l'exécute avec window.realFetch et retourne la réponse via FetchResponse.
 * Cela permet de garder les cookies et en-têtes du navigateur.
 *
 * Génère un GQLDeviceID aléatoire si aucun n'est défini.
 *
 * @param {Object} body - Corps de la requête GQL (query, variables, extensions)
 * @param {string} playerType - Type de joueur (contexte, non utilisé directement ici)
 * @returns {Promise<Response>} Réponse GQL simulée (status, body JSON)
 * @throws {Error} Si la requête échoue après toutes les tentatives (via gqlRequestWithRetry)
 */
function gqlRequest(body, playerType) {
    if (!GQLDeviceID) {
        GQLDeviceID = '';
        const dcharacters = 'abcdefghijklmnopqrstuvwxyz0123456789';
        const dcharactersLength = dcharacters.length;
        for (let i = 0; i < 32; i++) {
            GQLDeviceID += dcharacters.charAt(Math.floor(Math.random() * dcharactersLength));
        }
    }
    let headers = {
        'Client-ID': ClientID,
        'X-Device-Id': GQLDeviceID,
        'Authorization': AuthorizationHeader,
        ...(ClientIntegrityHeader && {'Client-Integrity': ClientIntegrityHeader}),
        ...(ClientVersion && {'Client-Version': ClientVersion}),
        ...(ClientSession && {'Client-Session-Id': ClientSession})
    };
    return new Promise((resolve, reject) => {
        const requestId = Math.random().toString(36).substring(2, 15);
        const fetchRequest = {
            id: requestId,
            url: 'https://gql.twitch.tv/gql',
            options: {
                method: 'POST',
                body: JSON.stringify(body),
                headers
            }
        };
        pendingFetchRequests.set(requestId, {
            resolve,
            reject
        });
        postMessage({
            key: 'FetchRequest',
            value: fetchRequest
        });
    });
}

/**
 * Requête GQL avec retry (backoff exponentiel 1s/2s/4s, 3 tentatives).
 *
 * @param {Object} body - Corps de la requête GQL
 * @param {string} playerType - Type de joueur
 * @param {number} [attempt=0] - Numéro de la tentative en cours
 * @returns {Promise<Response>} Réponse GQL
 * @throws {Error} Si la requête échoue après toutes les tentatives
 */
function gqlRequestWithRetry(body, playerType, attempt) {
    attempt = attempt || 0;
    return gqlRequest(body, playerType).catch(function(err) {
        if (attempt < GQL_MAX_RETRIES - 1) {
            var delay = GQL_BASE_DELAY * Math.pow(2, attempt);
            console.log("GQL retry " + (attempt+1) + "/" + GQL_MAX_RETRIES + ": " + err.message);
            return new Promise(function(r) { setTimeout(r, delay); }).then(function() {
                return gqlRequestWithRetry(body, playerType, attempt + 1);
            });
        }
        console.error("GQL failed after " + GQL_MAX_RETRIES + " attempts: " + err.message);
        throw err;
    });
}


// === fin core/gql.js ===


// === core/access-token.js ===

/* globals gqlRequestWithRetry */

/**
 * Récupère le token d'accès pour la lecture d'un stream Twitch.
 *
 * Utilise la requête GQL persistée PlaybackAccessToken avec le hash
 * SHA256 connu. Le platform est 'android' pour le player 'autoplay',
 * 'web' pour les autres.
 *
 * @param {string} channelName - Nom de la chaîne Twitch
 * @param {string} playerType - Type de joueur (embed, popout, autoplay, etc.)
 * @returns {Promise<Response>} Réponse GQL contenant le token d'accès
 *
 * @example
 * const resp = await getAccessToken('nomchain', 'popout');
 * const token = await resp.json();
 * // token.data.streamPlaybackAccessToken.value
 */
function getAccessToken(channelName, playerType) {
    const body = {
        operationName: 'PlaybackAccessToken',
        variables: {
            isLive: true,
            login: channelName,
            isVod: false,
            vodID: "",
            playerType: playerType,
            platform: playerType == 'autoplay' ? 'android' : 'web'
        },
        extensions: {
            persistedQuery: {
                version:1,
                sha256Hash:"ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9"
            }
        }
    };
    return gqlRequestWithRetry(body, playerType);
}


// === fin core/access-token.js ===


// === core/fetch-worker.js ===

/* globals AdSegmentCache, tnsVodsEnabled, buildVodPlaylist, processM3U8, AdSignifier,
         StreamInfos, StreamInfosByUrl, V2API, ForceAccessTokenPlayerType, parseAttributes,
         getServerTimeFromM3u8, replaceServerTimeInM3u8, AlwaysReloadPlayerOnAd,
         SkipPlayerReloadOnHevc, PlayerReloadMinimalRequestsTime,
         PlayerReloadMinimalRequestsPlayerIndex, BackupPlayerTypes, FallbackPlayerType,
         getAccessToken, gqlRequestWithRetry, postMessage, HasTriggeredPlayerReload,
         ReloadPlayerAfterAd, streamInfo, IsAdStrippingEnabled, AllSegmentsAreAdSegments,
         SimulatedAdsDepth */

/**
 * Hook du fetch à l'intérieur du Worker Twitch.
 *
 * Intercepte les requêtes m3u8, usher (VODs) et channel/hls (encodages live)
 * pour appliquer :
 * - le blocage de pubs (stripping des segments, backup player)
 * - le bypass VOD sub-only (quand usher répond 403)
 * - le dé-mute des VODs (-unmuted → -muted sur cloudfront)
 *
 * Dérivé de vaft (pixeltris/TwitchAdSolutions).
 *
 * Le hook remplace `fetch` dans le scope du worker. Les requêtes sont traitées
 * comme suit :
 *
 * 1. Segments dans AdSegmentCache → réponse vidéo vide (pub bloquée)
 * 2. usher.ttvnw.net/vod/ → si 403 et tnsVodsEnabled, buildVodPlaylist() ; sinon passthrough
 * 3. .m3u8 sur cloudfront et tnsVodsEnabled → remplace -unmuted par -muted (dé-mute)
 * 4. .m3u8 (autres) → si tnsAdsEnabled, processM3U8() (stripping pubs) ; sinon passthrough
 * 5. /channel/hls/ (hors picture-by-picture) → si tnsAdsEnabled, build des infos de stream,
 *    recherche d'un backup player sans pubs, remplacement des codecs HEVC si nécessaire
 *
 * @returns {void} Remplace window.fetch dans le scope du worker
 */
function hookWorkerFetch() {
    console.log('hookWorkerFetch (vaft)');
    const realFetch = fetch;
    fetch = async function(url, options) {
        if (typeof url === 'string') {
            if (AdSegmentCache.has(url)) {
                return new Promise(function(resolve, reject) {
                    const send = function() {
                        return realFetch('data:video/mp4;base64,AAAAKGZ0eXBtcDQyAAAAAWlzb21tcDQyZGFzaGF2YzFpc282aGxzZgAABEltb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAYagAAAAAAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAABqHRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAURtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAALuAAAAAAFXEAAAAAAAtaGRscgAAAAAAAAAAc291bgAAAAAAAAAAAAAAAFNvdW5kSGFuZGxlcgAAAADvbWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAACzc3RibAAAAGdzdHNkAAAAAAAAAAEAAABXbXA0YQAAAAAAAAABAAAAAAAAAAAAAgAQAAAAALuAAAAAAAAzZXNkcwAAAAADgICAIgABAASAgIAUQBUAAAAAAAAAAAAAAAWAgIACEZAGgICAAQIAAAAQc3R0cwAAAAAAAAAAAAAAEHN0c2MAAAAAAAAAAAAAABRzdHN6AAAAAAAAAAAAAAAAAAAAEHN0Y28AAAAAAAAAAAAAAeV0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAoAAAAFoAAAAAAGBbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAA9CQAAAAABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABLG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAOxzdGJsAAAAoHN0c2QAAAAAAAAAAQAAAJBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAoABaABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAOmF2Y0MBTUAe/+EAI2dNQB6WUoFAX/LgLUBAQFAAAD6AAA6mDgAAHoQAA9CW7y4KAQAEaOuPIAAAABBzdHRzAAAAAAAAAAAAAAAQc3RzYwAAAAAAAAAAAAAAFHN0c3oAAAAAAAAAAAAAAAAAAAAQc3RjbwAAAAAAAAAAAAAASG12ZXgAAAAgdHJleAAAAAAAAAABAAAAAQAAAC4AAAAAAoAAAAAAACB0cmV4AAAAAAAAAAIAAAABAACCNQAAAAACQAAA', options).then(function(response) {
                            resolve(response);
                        })['catch'](function(err) {
                            reject(err);
                        });
                    };
                    send();
                });
            }
            url = url.trimEnd();
            if (url.includes('usher.ttvnw.net/vod/')) {
                // VOD playlist: usher returns 403 for sub-only VODs, build a direct CDN playlist instead
                return new Promise(function(resolve, reject) {
                    const processAfter = async function(response) {
                        if (response.status === 200 || !tnsVodsEnabled) {
                            // VODs désactivées : on laisse Twitch gérer (pas de bypass)
                            resolve(response);
                        } else {
                            console.log('Usher VOD request failed (' + response.status + ') — building bypass playlist');
                            resolve(await buildVodPlaylist(url, realFetch));
                        }
                    };
                    const send = function() {
                        return realFetch(url, options).then(function(response) {
                            processAfter(response);
                        })['catch'](function(err) {
                            reject(err);
                        });
                    };
                    send();
                });
            }
            if (url.endsWith('m3u8')) {
                return new Promise(function(resolve, reject) {
                    const processAfter = async function(response) {
                        if (response.status === 200) {
                            let m3u8Text = await response.text();
                            if (url.includes('cloudfront') && tnsVodsEnabled) {
                                // TwitchNoSub trick: muted VOD segments are served under '-unmuted' names,
                                // the original-audio versions exist as '-muted' — swap to unmute VODs
                                m3u8Text = m3u8Text.replace(/-unmuted/g, '-muted');
                            }
                            // Pubs désactivées : on renvoie le m3u8 brut, sans stripping
                            resolve(new Response(tnsAdsEnabled ? await processM3U8(url, m3u8Text, realFetch) : m3u8Text));
                        } else {
                            resolve(response);
                        }
                    };
                    const send = function() {
                        return realFetch(url, options).then(function(response) {
                            processAfter(response);
                        })['catch'](function(err) {
                            reject(err);
                        });
                    };
                    send();
                });
            } else if (url.includes('/channel/hls/') && !url.includes('picture-by-picture')) {
                if (!tnsAdsEnabled) {
                    // Pubs désactivées : pas de hook, Twitch joue les pubs normalement
                    return realFetch(url, options);
                }
                V2API = url.includes('/api/v2/');
                const channelName = (new URL(url)).pathname.match(/([^\/]+)(?=\.\w+$)/)[0];
                if (ForceAccessTokenPlayerType) {
                    // parent_domains is used to determine if the player is embeded and stripping it gets rid of fake ads
                    const tempUrl = new URL(url);
                    tempUrl.searchParams.delete('parent_domains');
                    url = tempUrl.toString();
                }
                return new Promise(function(resolve, reject) {
                    const processAfter = async function(response) {
                        if (response.status == 200) {
                            const encodingsM3u8 = await response.text();
                            const serverTime = getServerTimeFromM3u8(encodingsM3u8);
                            let streamInfo = StreamInfos[channelName];
                            if (streamInfo != null && streamInfo.EncodingsM3U8 != null && (await realFetch(streamInfo.EncodingsM3u8.match(/^https:.*\.m3u8$/m)[0])).status !== 200) {
                                // The cached encodings are dead (the stream probably restarted)
                                streamInfo = null;
                            }
                            if (streamInfo == null || streamInfo.EncodingsM3U8 == null) {
                                StreamInfos[channelName] = streamInfo = {
                                    ChannelName: channelName,
                                    IsShowingAd: false,
                                    LastPlayerReload: 0,
                                    EncodingsM3U8: encodingsM3u8,
                                    ModifiedM3U8: null,
                                    IsUsingModifiedM3U8: false,
                                    UsherParams: (new URL(url)).search,
                                    RequestedAds: new Set(),
                                    Urls: [],// xxx.m3u8 -> { Resolution: "284x160", FrameRate: 30.0 }
                                    ResolutionList: [],
                                    BackupEncodingsM3U8Cache: [],
                                    ActiveBackupPlayerType: null,
                                    IsMidroll: false,
                                    IsStrippingAdSegments: false,
                                    NumStrippedAdSegments: 0
                                };
                                const lines = encodingsM3u8.replaceAll('\r', '').split('\n');
                                for (let i = 0; i < lines.length - 1; i++) {
                                    if (lines[i].startsWith('#EXT-X-STREAM-INF') && lines[i + 1].includes('.m3u8')) {
                                        const attributes = parseAttributes(lines[i]);
                                        const resolution = attributes['RESOLUTION'];
                                        if (resolution) {
                                            const resolutionInfo = {
                                                Resolution: resolution,
                                                FrameRate: attributes['FRAME-RATE'],
                                                Codecs: attributes['CODECS'],
                                                Url: lines[i + 1]
                                            };
                                            streamInfo.Urls[lines[i + 1]] = resolutionInfo;
                                            streamInfo.ResolutionList.push(resolutionInfo);
                                        }
                                        StreamInfosByUrl[lines[i + 1]] = streamInfo;
                                    }
                                }
                                const nonHevcResolutionList = streamInfo.ResolutionList.filter((element) => element.Codecs.startsWith('avc') || element.Codecs.startsWith('av0'));
                                if (AlwaysReloadPlayerOnAd || (nonHevcResolutionList.length > 0 && streamInfo.ResolutionList.some((element) => element.Codecs.startsWith('hev') || element.Codecs.startsWith('hvc')) && !SkipPlayerReloadOnHevc)) {
                                    if (nonHevcResolutionList.length > 0) {
                                        for (let i = 0; i < lines.length - 1; i++) {
                                            if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
                                                const resSettings = parseAttributes(lines[i].substring(lines[i].indexOf(':') + 1));
                                                const codecsKey = 'CODECS';
                                                if (resSettings[codecsKey].startsWith('hev') || resSettings[codecsKey].startsWith('hvc')) {
                                                    const oldResolution = resSettings['RESOLUTION'];
                                                    const [targetWidth, targetHeight] = oldResolution.split('x').map(Number);
                                                    const newResolutionInfo = nonHevcResolutionList.sort((a, b) => {
                                                        // TODO: Take into account 'Frame-Rate' when sorting (i.e. 1080p60 vs 1080p30)
                                                        const [streamWidthA, streamHeightA] = a.Resolution.split('x').map(Number);
                                                        const [streamWidthB, streamHeightB] = b.Resolution.split('x').map(Number);
                                                        return Math.abs((streamWidthA * streamHeightA) - (targetWidth * targetHeight)) - Math.abs((streamWidthB * streamHeightB) - (targetWidth * targetHeight));
                                                    })[0];
                                                    console.log('ModifiedM3U8 swap ' + resSettings[codecsKey] + ' to ' + newResolutionInfo.Codecs + ' oldRes:' + oldResolution + ' newRes:' + newResolutionInfo.Resolution);
                                                    lines[i] = lines[i].replace(/CODECS="[^"]+"/, `CODECS="${newResolutionInfo.Codecs}"`);
                                                    lines[i + 1] = newResolutionInfo.Url + ' '.repeat(i + 1);// The stream doesn't load unless each url line is unique
                                                }
                                            }
                                        }
                                    }
                                    if (nonHevcResolutionList.length > 0 || AlwaysReloadPlayerOnAd) {
                                        streamInfo.ModifiedM3U8 = lines.join('\n');
                                    }
                                }
                            }
                            streamInfo.LastPlayerReload = Date.now();
                            resolve(new Response(replaceServerTimeInM3u8(streamInfo.IsUsingModifiedM3U8 ? streamInfo.ModifiedM3U8 : streamInfo.EncodingsM3U8, serverTime)));
                        } else {
                            resolve(response);
                        }
                    };
                    const send = function() {
                        return realFetch(url, options).then(function(response) {
                            processAfter(response);
                        })['catch'](function(err) {
                            reject(err);
                        });
                    };
                    send();
                });
            }
        }
        return realFetch.apply(this, arguments);
    };
}


// === fin core/fetch-worker.js ===


// === core/worker-utils.js ===

/* globals declareOptions, getAccessToken, gqlRequest, gqlRequestWithRetry, parseAttributes,
         getServerTimeFromM3u8, replaceServerTimeInM3u8, buildVodPlaylist, isValidQuality,
         createServingID, postMessage, hookWorkerFetch, streamInfo, StreamInfos, StreamInfosByUrl,
         HasTriggeredPlayerReload, V2API, SimulatedAdsDepth, AllSegmentsAreAdSegments,
         GQLDeviceID, ClientID, AuthorizationHeader, ClientIntegrityHeader, ClientVersion,
         ClientSession, tnsAdsEnabled, tnsVodsEnabled, AdSegmentCache, AdSignifier,
         IsAdStrippingEnabled, SkipPlayerReloadOnHevc, AlwaysReloadPlayerOnAd,
         PlayerReloadMinimalRequestsTime, PlayerReloadMinimalRequestsPlayerIndex,
         ForceAccessTokenPlayerType, FallbackPlayerType, BackupPlayerTypes */

/**
 * Sélecteurs de chaînes à détecter dans le source d'un Worker pour identifier les conflits.
 * @type {ReadonlyArray<string>}
 */
const workerStringConflicts = [
    'twitch',
    'isVariantA'// TwitchNoSub
];

/**
 * Sélecteurs de chaînes à détecter pour réinsérer les couches de prototype TwitchNoSub.
 * @type {ReadonlyArray<string>}
 */
const workerStringReinsert = [
    'isVariantA',// TwitchNoSub (prior to 0.9)
    'besuper/'// TwitchNoSub (0.9)
];

/**
 * Nettoie le prototype du Worker Twitch en supprimant les couches en conflit
 * (ex. TwitchNoSub) et en retournant la racine saine.
 *
 * Parcourt la chaîne de prototypes du Worker. Lorsqu'une couche contient un
 * marqueur de conflit, on la "saute" en reliant directement son parent à son
 * propre prototype. Les couches saines sont conservées.
 *
 * @param {Function} worker - Constructeur Worker à nettoyer
 * @returns {Function|null} Le prototype racine sain, ou null si aucun
 */
function getCleanWorker(worker) {
    /** @type {Function|null} */
    let root = null;
    /** @type {Function|null} */
    let parent = null;
    let proto = worker;
    while (proto) {
        const workerString = proto.toString();
        if (workerStringConflicts.some((x) => workerString.includes(x))) {
            if (parent !== null) {
                Object.setPrototypeOf(parent, Object.getPrototypeOf(proto));
            }
        } else {
            if (root === null) {
                root = proto;
            }
            parent = proto;
        }
        proto = Object.getPrototypeOf(proto);
    }
    return root;
}

/**
 * Retourne les couches de prototype du Worker à réinsérer (TwitchNoSub).
 *
 * @param {Function} worker - Constructeur Worker à inspecter
 * @returns {Array<Function>} Couches de prototype à réinsérer
 */
function getWorkersForReinsert(worker) {
    /** @type {Array<Function>} */
    const result = [];
    let proto = worker;
    while (proto) {
        const workerString = proto.toString();
        if (workerStringReinsert.some((x) => workerString.includes(x))) {
            result.push(proto);
        }
        proto = Object.getPrototypeOf(proto);
    }
    return result;
}

/**
 * Réinsère les couches de prototype dans l'ordre donné.
 *
 * @param {Function} worker - Constructeur Worker de base
 * @param {Array<Function>} reinsert - Couches à réinsérer, dans l'ordre
 * @returns {Function} Le dernier prototype de la chaîne réinsérée
 */
function reinsertWorkers(worker, reinsert) {
    /** @type {Function} */
    let parent = worker;
    for (let i = 0; i < reinsert.length; i++) {
        Object.setPrototypeOf(reinsert[i], parent);
        parent = reinsert[i];
    }
    return parent;
}

/**
 * Vérifie si un Worker est valide (pas en conflit irrémédiable).
 *
 * Un Worker est considéré comme invalide s'il contient un marqueur de conflit
 * ET qu'il ne contient pas de marqueur de réinsertion (ce qui signifierait
 * qu'il s'agit d'une couche TwitchNoSub qu'on doit conserver).
 *
 * @param {Function} worker - Constructeur Worker à valider
 * @returns {boolean} true si le Worker est valide
 */
function isValidWorker(worker) {
    const workerString = worker.toString();
    return !workerStringConflicts.some((x) => workerString.includes(x))
        || workerStringReinsert.some((x) => workerString.includes(x));
}

/**
 * Lit de manière synchrone le source du worker blob Twitch.
 *
 * ⚠️ Cette fonction est synchrone car elle est appelée depuis le constructeur
 * `new Worker()` de Twitch, qui est lui-même synchrone. Remplacer par `fetch`
 * asynchrone n'est pas possible ici sans restructurer profondément l'interception
 * du constructeur Worker.
 *
 * @param {string} twitchBlobUrl - URL blob du worker Twitch
 * @returns {string} Le code source JavaScript du worker
 * @throws {Error} Si la requête XHR échoue
 */
function getWasmWorkerJs(twitchBlobUrl) {
    const req = new XMLHttpRequest();
    req.open('GET', twitchBlobUrl, false);
    req.overrideMimeType("text/javascript");
    try {
        req.send();
    } catch (err) {
        throw new Error(`Impossible de charger le worker Twitch ${twitchBlobUrl}: ${err.message}`);
    }
    if (req.status !== 200) {
        throw new Error(`Échec du chargement du worker Twitch ${twitchBlobUrl}: HTTP ${req.status}`);
    }
    return req.responseText;
}

/**
 * Version asynchrone de getWasmWorkerJs utilisant fetch.
 * Disponible pour les usages futurs en dehors du constructeur Worker synchrone.
 *
 * @param {string} twitchBlobUrl - URL blob du worker Twitch
 * @returns {Promise<string>} Le code source JavaScript du worker
 */
async function getWasmWorkerJsAsync(twitchBlobUrl) {
    const res = await fetch(twitchBlobUrl);
    if (!res.ok) {
        throw new Error(`Impossible de charger le worker Twitch ${twitchBlobUrl}: ${res.status}`);
    }
    return res.text();
}

/**
 * Intercepte le constructeur window.Worker de Twitch pour injecter le hook fetch
 * dans le blob du worker. Dérivé de vaft (pixeltris/TwitchAdSolutions).
 *
 * Le nouveau Worker :
 * 1. Détecte s'il s'agit d'un worker Twitch (origine *.twitch.tv)
 * 2. Construit un blob contenant tous les hooks (fetch, m3u8, VOD bypass, etc.)
 * 3. Remplace le worker original par ce blob injecté
 * 4. Relaye les messages entre le worker et le contexte page (stats, flags, reload)
 *
 * @returns {void}
 */
function hookWindowWorker() {
    const reinsert = getWorkersForReinsert(window.Worker);
    const NewWorker = class Worker extends getCleanWorker(window.Worker) {
        /**
         * @param {string} twitchBlobUrl - URL blob du worker Twitch
         * @param {any} options - Options passées au constructeur Worker
         */
        constructor(twitchBlobUrl, options) {
            let isTwitchWorker = false;
            try {
                isTwitchWorker = new URL(twitchBlobUrl).origin.endsWith('.twitch.tv');
            } catch {}
            if (!isTwitchWorker) {
                super(twitchBlobUrl, options);
                return;
            }
            const newBlobStr = `
                const pendingFetchRequests = new Map();
                ${stripAdSegments.toString()}
                ${getStreamUrlForResolution.toString()}
                ${processM3U8.toString()}
                ${hookWorkerFetch.toString()}
                ${declareOptions.toString()}
                ${getAccessToken.toString()}
                ${gqlRequest.toString()}
                ${gqlRequestWithRetry.toString()}
                ${parseAttributes.toString()}
                ${getWasmWorkerJs.toString()}
                ${getServerTimeFromM3u8.toString()}
                ${replaceServerTimeInM3u8.toString()}
                ${buildVodPlaylist.toString()}
                ${isValidQuality.toString()}
                ${createServingID.toString()}
                const workerString = getWasmWorkerJs('${twitchBlobUrl.replaceAll("'", "%27")}');
                declareOptions(self);
                GQLDeviceID = ${GQLDeviceID ? "'" + GQLDeviceID + "'" : null};
                AuthorizationHeader = ${AuthorizationHeader ? "'" + AuthorizationHeader + "'" : undefined};
                ClientIntegrityHeader = ${ClientIntegrityHeader ? "'" + ClientIntegrityHeader + "'" : null};
                ClientVersion = ${ClientVersion ? "'" + ClientVersion + "'" : null};
                ClientSession = ${ClientSession ? "'" + ClientSession + "'" : null};
                let tnsAdsEnabled = ${tnsAdsEnabled};
                let tnsVodsEnabled = ${tnsVodsEnabled};
                self.addEventListener('message', function(e) {
                    if (e.data.key == 'UpdateClientVersion') {
                        ClientVersion = e.data.value;
                    } else if (e.data.key == 'UpdateClientSession') {
                        ClientSession = e.data.value;
                    } else if (e.data.key == 'UpdateClientId') {
                        ClientID = e.data.value;
                    } else if (e.data.key == 'UpdateDeviceId') {
                        GQLDeviceID = e.data.value;
                    } else if (e.data.key == 'UpdateClientIntegrityHeader') {
                        ClientIntegrityHeader = e.data.value;
                    } else if (e.data.key == 'UpdateAuthorizationHeader') {
                        AuthorizationHeader = e.data.value;
                    } else if (e.data.key == 'FetchResponse') {
                        const responseData = e.data.value;
                        if (pendingFetchRequests.has(responseData.id)) {
                            const { resolve, reject } = pendingFetchRequests.get(responseData.id);
                            pendingFetchRequests.delete(responseData.id);
                            if (responseData.error) {
                                reject(new Error(responseData.error));
                            } else {
                                const response = new Response(responseData.body, {
                                    status: responseData.status,
                                    statusText: responseData.statusText,
                                    headers: responseData.headers
                                });
                                resolve(response);
                            }
                        }
                    } else if (e.data.key == 'TriggeredPlayerReload') {
                        HasTriggeredPlayerReload = true;
                    } else if (e.data.key == 'UpdateFeatureFlags') {
                        if (e.data.value && typeof e.data.value.adsEnabled === 'boolean') { tnsAdsEnabled = e.data.value.adsEnabled; }
                        if (e.data.value && typeof e.data.value.vodsEnabled === 'boolean') { tnsVodsEnabled = e.data.value.vodsEnabled; }
                        console.log('tns flags à chaud: ads=' + tnsAdsEnabled + ' vods=' + tnsVodsEnabled);
                        postMessage({ key: 'FeatureFlagsAck', value: { adsEnabled: tnsAdsEnabled, vodsEnabled: tnsVodsEnabled } });
                    } else if (e.data.key == 'SimulateAds') {
                        SimulatedAdsDepth = e.data.value;
                        console.log('SimulatedAdsDepth: ' + SimulatedAdsDepth);
                    } else if (e.data.key == 'AllSegmentsAreAdSegments') {
                        AllSegmentsAreAdSegments = !AllSegmentsAreAdSegments;
                        console.log('AllSegmentsAreAdSegments: ' + AllSegmentsAreAdSegments);
                    }
                });
                hookWorkerFetch();
                eval(workerString);
            `;
            super(URL.createObjectURL(new Blob([newBlobStr])), options);
            twitchWorkers.push(this);
            this.addEventListener('message', (e) => {
                if (e.data.key == 'UpdateAdBlockBanner') {
                    if (e.data.hasAds && !e.data.isStrippingAdSegments) {
                        stats.adsBlocked++;
                        saveStats();
                        console.log('%c📺 Pub bloquée', 'color:#9146FF', '— total : ' + stats.adsBlocked);
                    }
                    updateAdblockBanner(e.data);
                } else if (e.data.key == 'VodBypassed') {
                    if (e.data.vodId) {
                        if (seenVodIds.has(e.data.vodId)) { return; }
                        seenVodIds.add(e.data.vodId);
                    }
                    stats.vodsUnlocked++;
                    saveStats();
                    console.log('%c🎬 VOD sub-only débloquée', 'color:#9146FF', '— total : ' + stats.vodsUnlocked);
                } else if (e.data.key == 'FeatureFlagsAck') {
                    console.log('%c✅ Flags appliqués dans le worker: pubs=' + (e.data.value.adsEnabled ? 'ON' : 'OFF') + ' · VODs=' + (e.data.value.vodsEnabled ? 'ON' : 'OFF'), 'color:#9146FF');
                } else if (e.data.key == 'PauseResumePlayer') {
                    doTwitchPlayerTask(true, false);
                } else if (e.data.key == 'ReloadPlayer') {
                    doTwitchPlayerTask(false, true);
                }
            });
            this.addEventListener('message', async event => {
                if (event.data.key == 'FetchRequest') {
                    const fetchRequest = event.data.value;
                    const responseData = await handleWorkerFetchRequest(fetchRequest);
                    this.postMessage({
                        key: 'FetchResponse',
                        value: responseData
                    });
                }
            });
        }
    };
    let workerInstance = reinsertWorkers(NewWorker, reinsert);
    Object.defineProperty(window, 'Worker', {
        get: function() {
            return workerInstance;
        },
        set: function(value) {
            if (isValidWorker(value)) {
                workerInstance = value;
            } else {
                console.log('Attempt to set twitch worker denied');
            }
        }
    });
}


// === fin core/worker-utils.js ===


// === core/ads.js ===

/* globals StreamInfosByUrl, streamInfo, HasTriggeredPlayerReload, postMessage,
         SimulatedAdsDepth, IsAdStrippingEnabled, SkipPlayerReloadOnHevc,
         AlwaysReloadPlayerOnAd, AdSignifier, PlayerReloadMinimalRequestsTime,
         PlayerReloadMinimalRequestsPlayerIndex, BackupPlayerTypes, FallbackPlayerType,
         ForceAccessTokenPlayerType, V2API, getAccessToken, realFetch, gqlRequestWithRetry,
         parseAttributes, getServerTimeFromM3u8, replaceServerTimeInM3u8, AdSegmentCache,
         AllSegmentsAreAdSegments */

/**
 * Supprime les segments publicitaires d'un playlist m3u8.
 *
 * ⚠️ Cette fonction ne retire pas physiquement les lignes de segments du texte
 * retourné. Elle ajoute les URLs des segments pubs à AdSegmentCache et incrémente
 * le compteur. La suppression effective est faite par le hook fetch (qui retourne
 * une réponse vidéo vide pour les URLs en cache).
 *
 * @param {string} textStr - Contenu du playlist m3u8
 * @param {boolean} stripAllSegments - Si true, tous les segments sont considérés comme pubs
 * @param {Object} streamInfo - Informations du stream (compteurs, flags)
 * @returns {string} Le playlist m3u8 (lignes PREFETCH vidées si des pubs détectées)
 */
function stripAdSegments(textStr, stripAllSegments, streamInfo) {
    let hasStrippedAdSegments = false;
    const lines = textStr.replaceAll('\r', '').split('\n');
    const newAdUrl = 'https://twitch.tv';
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        line = line
            .replaceAll(/(X-TV-TWITCH-AD-URL=")(?:[^"]*)(")/g, `$1${newAdUrl}$2`)
            .replaceAll(/(X-TV-TWITCH-AD-CLICK-TRACKING-URL=")(?:[^"]*)(")/g, `$1${newAdUrl}$2`);
        if (i < lines.length - 1 && line.startsWith('#EXTINF') && (!line.includes(',live') || stripAllSegments || AllSegmentsAreAdSegments)) {
            const segmentUrl = lines[i + 1];
            if (!AdSegmentCache.has(segmentUrl)) {
                streamInfo.NumStrippedAdSegments++;
            }
            AdSegmentCache.set(segmentUrl, Date.now());
            hasStrippedAdSegments = true;
        }
        if (line.includes(AdSignifier)) {
            hasStrippedAdSegments = true;
        }
    }
    if (hasStrippedAdSegments) {
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('#EXT-X-TWITCH-PREFETCH:')) {
                lines[i] = '';
            }
        }
    } else {
        streamInfo.NumStrippedAdSegments = 0;
    }
    streamInfo.IsStrippingAdSegments = hasStrippedAdSegments;
    AdSegmentCache.forEach((value, key, map) => {
        if (value < Date.now() - 120000) {
            map.delete(key);
        }
    });
    return lines.join('\n');
}

/**
 * Trouve l'URL du stream pour une résolution donnée dans un playlist d'encodages.
 *
 * @param {string} encodingsM3u8 - Contenu du playlist d'encodages m3u8
 * @param {Object} resolutionInfo - { Resolution, FrameRate, Codecs, Url }
 * @returns {string|null} URL du stream correspondant, ou null
 */
function getStreamUrlForResolution(encodingsM3u8, resolutionInfo) {
    const encodingsLines = encodingsM3u8.replaceAll('\r', '').split('\n');
    const [targetWidth, targetHeight] = resolutionInfo.Resolution.split('x').map(Number);
    let matchedResolutionUrl = null;
    let matchedFrameRate = false;
    let closestResolutionUrl = null;
    let closestResolutionDifference = Infinity;
    for (let i = 0; i < encodingsLines.length - 1; i++) {
        if (encodingsLines[i].startsWith('#EXT-X-STREAM-INF') && encodingsLines[i + 1].includes('.m3u8')) {
            const attributes = parseAttributes(encodingsLines[i]);
            const resolution = attributes['RESOLUTION'];
            const frameRate = attributes['FRAME-RATE'];
            if (resolution) {
                if (resolution == resolutionInfo.Resolution && (!matchedResolutionUrl || (!matchedFrameRate && frameRate == resolutionInfo.FrameRate))) {
                    matchedResolutionUrl = encodingsLines[i + 1];
                    matchedFrameRate = frameRate == resolutionInfo.FrameRate;
                    if (matchedFrameRate) {
                        return matchedResolutionUrl;
                    }
                }
                const [width, height] = resolution.split('x').map(Number);
                const difference = Math.abs((width * height) - (targetWidth * targetHeight));
                if (difference < closestResolutionDifference) {
                    closestResolutionUrl = encodingsLines[i + 1];
                    closestResolutionDifference = difference;
                }
            }
        }
    }
    return closestResolutionUrl;
}

/**
 * Traite un playlist m3u8 : détection des pubs, switching vers un backup player,
 * stripping des segments publicitaires.
 *
 * Appelé par hookWorkerFetch pour chaque requête .m3u8 quand tnsAdsEnabled est true.
 *
 * @param {string} url - URL du m3u8
 * @param {string} textStr - Contenu du m3u8
 * @param {Function} realFetch - Fonction fetch du contexte worker
 * @returns {Promise<string>} Le m3u8 traité (backup player ou stripping appliqué)
 */
async function processM3U8(url, textStr, realFetch) {
    const streamInfo = StreamInfosByUrl[url];
    if (!streamInfo) {
        return textStr;
    }
    if (HasTriggeredPlayerReload) {
        HasTriggeredPlayerReload = false;
        streamInfo.LastPlayerReload = Date.now();
    }
    const haveAdTags = textStr.includes(AdSignifier) || SimulatedAdsDepth > 0;
    if (haveAdTags) {
        streamInfo.IsMidroll = textStr.includes('"MIDROLL"') || textStr.includes('"midroll"');
        if (!streamInfo.IsShowingAd) {
            streamInfo.IsShowingAd = true;
            postMessage({
                key: 'UpdateAdBlockBanner',
                isMidroll: streamInfo.IsMidroll,
                hasAds: streamInfo.IsShowingAd,
                isStrippingAdSegments: false
            });
        }
        if (!streamInfo.IsMidroll) {
            const lines = textStr.replaceAll('\r', '').split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.startsWith('#EXTINF') && lines.length > i + 1) {
                    if (!line.includes(',live') && !streamInfo.RequestedAds.has(lines[i + 1])) {
                        streamInfo.RequestedAds.add(lines[i + 1]);
                        fetch(lines[i + 1]).then((response)=>{response.blob()});
                        break;
                    }
                }
            }
        }
        const currentResolution = streamInfo.Urls[url];
        if (!currentResolution) {
            console.log('Ads will leak due to missing resolution info for ' + url);
            return textStr;
        }
        const isHevc = currentResolution.Codecs.startsWith('hev') || currentResolution.Codecs.startsWith('hvc');
        if (((isHevc && !SkipPlayerReloadOnHevc) || AlwaysReloadPlayerOnAd) && streamInfo.ModifiedM3U8 && !streamInfo.IsUsingModifiedM3U8) {
            streamInfo.IsUsingModifiedM3U8 = true;
            streamInfo.LastPlayerReload = Date.now();
            postMessage({
                key: 'ReloadPlayer'
            });
        }
        let backupPlayerType = null;
        let backupM3u8 = null;
        let fallbackM3u8 = null;
        let startIndex = 0;
        let isDoingMinimalRequests = false;
        if (streamInfo.LastPlayerReload > Date.now() - PlayerReloadMinimalRequestsTime) {
            startIndex = PlayerReloadMinimalRequestsPlayerIndex;
            isDoingMinimalRequests = true;
        }
        for (let playerTypeIndex = startIndex; !backupM3u8 && playerTypeIndex < BackupPlayerTypes.length; playerTypeIndex++) {
            const playerType = BackupPlayerTypes[playerTypeIndex];
            const realPlayerType = playerType.replace('-CACHED', '');
            const isFullyCachedPlayerType = playerType != realPlayerType;
            for (let i = 0; i < 2; i++) {
                let isFreshM3u8 = false;
                let encodingsM3u8 = streamInfo.BackupEncodingsM3U8Cache[playerType];
                if (!encodingsM3u8) {
                    isFreshM3u8 = true;
                    try {
                        const accessTokenResponse = await getAccessToken(streamInfo.ChannelName, realPlayerType);
                        if (accessTokenResponse.status === 200) {
                            const accessToken = await accessTokenResponse.json();
                            const urlInfo = new URL('https://usher.ttvnw.net/api/' + (V2API ? 'v2/' : '') + 'channel/hls/' + streamInfo.ChannelName + '.m3u8' + streamInfo.UsherParams);
                            urlInfo.searchParams.set('sig', accessToken.data.streamPlaybackAccessToken.signature);
                            urlInfo.searchParams.set('token', accessToken.data.streamPlaybackAccessToken.value);
                            const encodingsM3u8Response = await realFetch(urlInfo.href);
                            if (encodingsM3u8Response.status === 200) {
                                encodingsM3u8 = streamInfo.BackupEncodingsM3U8Cache[playerType] = await encodingsM3u8Response.text();
                            }
                        }
                    } catch (err) {}
                }
                if (encodingsM3u8) {
                    try {
                        const streamM3u8Url = getStreamUrlForResolution(encodingsM3u8, currentResolution);
                        const streamM3u8Response = await realFetch(streamM3u8Url);
                        if (streamM3u8Response.status == 200) {
                            const m3u8Text = await streamM3u8Response.text();
                            if (m3u8Text) {
                                if (playerType == FallbackPlayerType) {
                                    fallbackM3u8 = m3u8Text;
                                }
                                if ((!m3u8Text.includes(AdSignifier) && (SimulatedAdsDepth == 0 || playerTypeIndex >= SimulatedAdsDepth - 1)) || (!fallbackM3u8 && playerTypeIndex >= BackupPlayerTypes.length - 1)) {
                                    backupPlayerType = playerType;
                                    backupM3u8 = m3u8Text;
                                    break;
                                }
                                if (isFullyCachedPlayerType) {
                                    break;
                                }
                                if (isDoingMinimalRequests) {
                                    backupPlayerType = playerType;
                                    backupM3u8 = m3u8Text;
                                    break;
                                }
                            }
                        }
                    } catch (err) {}
                }
                streamInfo.BackupEncodingsM3U8Cache[playerType] = null;
                if (isFreshM3u8) {
                    break;
                }
            }
        }
        if (!backupM3u8 && fallbackM3u8) {
            backupPlayerType = FallbackPlayerType;
            backupM3u8 = fallbackM3u8;
        }
        if (backupM3u8) {
            textStr = backupM3u8;
            if (streamInfo.ActiveBackupPlayerType != backupPlayerType) {
                streamInfo.ActiveBackupPlayerType = backupPlayerType;
                console.log(`Blocking${(streamInfo.IsMidroll ? ' midroll ' : ' ')}ads (${backupPlayerType})`);
            }
        }
        const stripHevc = isHevc && streamInfo.ModifiedM3U8;
        if (IsAdStrippingEnabled || stripHevc) {
            textStr = stripAdSegments(textStr, stripHevc, streamInfo);
        }
    } else if (streamInfo.IsShowingAd) {
        console.log('Finished blocking ads');
        streamInfo.IsShowingAd = false;
        streamInfo.IsStrippingAdSegments = false;
        streamInfo.NumStrippedAdSegments = 0;
        streamInfo.ActiveBackupPlayerType = null;
        if (streamInfo.IsUsingModifiedM3U8 || ReloadPlayerAfterAd) {
            streamInfo.IsUsingModifiedM3U8 = false;
            streamInfo.LastPlayerReload = Date.now();
            postMessage({
                key: 'ReloadPlayer'
            });
        } else {
            postMessage({
                key: 'PauseResumePlayer'
            });
        }
    }
    postMessage({
        key: 'UpdateAdBlockBanner',
        isMidroll: streamInfo.IsMidroll,
        hasAds: streamInfo.IsShowingAd,
        isStrippingAdSegments: streamInfo.IsStrippingAdSegments,
        numStrippedAdSegments: streamInfo.NumStrippedAdSegments
    });
    return textStr;
}


// === fin core/ads.js ===


// === core/player.js ===

/* globals document, console, Date, localStorage, localStorageHookFailed,
         tnsAdsEnabled, PlayerBufferingFix, PlayerBufferingDelay,
         PlayerBufferingSameStateCount, PlayerBufferingMinRepeatDelay,
         PlayerBufferingDangerZone, PlayerBufferingDoPlayerReload,
         PlayerBufferingPrerollCheckEnabled, PlayerBufferingPrerollCheckOffset,
         updateAdblockBanner, postTwitchWorkerMessage, playerBufferState,
         monitorPlayerBuffering, isActivelyStrippingAds, doTwitchPlayerTask,
         playerForMonitoringBuffering */

/**
 * Récupère l'instance du player Twitch et son état React en parcourant l'arbre React.
 *
 * ⚠️ Cette fonction accède à des propriétés internes de React
 * (`_reactRootContainer._internalRoot.current`, `__reactContainer`) qui
 * peuvent changer à toute mise à jour de Twitch.
 *
 * @returns {{player: Object, state: Object}|null} Le player et son état, ou null
 */
function getPlayerAndState() {
    function findReactNode(root, constraint) {
        if (root.stateNode && constraint(root.stateNode)) {
            return root.stateNode;
        }
        let node = root.child;
        while (node) {
            const result = findReactNode(node, constraint);
            if (result) {
                return result;
            }
            node = node.sibling;
        }
        return null;
    }
    function findReactRootNode() {
        let reactRootNode = null;
        const rootNode = document.querySelector('#root');
        if (rootNode && rootNode._reactRootContainer && rootNode._reactRootContainer._internalRoot && rootNode._reactRootContainer._internalRoot.current) {
            reactRootNode = rootNode._reactRootContainer._internalRoot.current;
        }
        if (reactRootNode == null && rootNode != null) {
            const containerName = Object.keys(rootNode).find(x => x.startsWith('__reactContainer'));
            if (containerName != null) {
                reactRootNode = rootNode[containerName];
            }
        }
        return reactRootNode;
    }
    const reactRootNode = findReactRootNode();
    if (!reactRootNode) {
        return null;
    }
    let player = findReactNode(reactRootNode, node => node.setPlayerActive && node.props && node.props.mediaPlayerInstance);
    player = player && player.props && player.props.mediaPlayerInstance ? player.props.mediaPlayerInstance : null;
    if (player?.playerInstance) {
        player = player.playerInstance;
    }
    const playerState = findReactNode(reactRootNode, node => node.setSrc && node.setInitialPlaybackSettings);
    return {
        player: player,
        state: playerState
    };
}

/**
 * Effectue une action sur le player Twitch (pause/play ou reload).
 *
 * Préserve la qualité, le mute et le volume dans localStorage pendant le reload
 * (utilisé quand le hook localStorage a échoué, ex. Firefox).
 *
 * @param {boolean} isPausePlay - Si true, fait pause puis play
 * @param {boolean} isReload - Si true, recharge le player (setSrc)
 * @returns {boolean} true si l'action a été effectuée, false sinon
 */
function doTwitchPlayerTask(isPausePlay, isReload) {
    const playerAndState = getPlayerAndState();
    if (!playerAndState) {
        console.log('Could not find react root');
        return false;
    }
    const player = playerAndState.player;
    const playerState = playerAndState.state;
    if (!player) {
        console.log('Could not find player');
        return false;
    }
    if (!playerState) {
        console.log('Could not find player state');
        return false;
    }
    if (player.isPaused() || player.core?.paused) {
        return false;
    }
    playerBufferState.lastFixTime = Date.now();
    playerBufferState.numSame = 0;
    if (isPausePlay) {
        player.pause();
        player.play();
        return true;
    }
    if (isReload) {
        const lsKeyQuality = 'video-quality';
        const lsKeyMuted = 'video-muted';
        const lsKeyVolume = 'volume';
        let currentQualityLS = null;
        let currentMutedLS = null;
        let currentVolumeLS = null;
        try {
            currentQualityLS = localStorage.getItem(lsKeyQuality);
            currentMutedLS = localStorage.getItem(lsKeyMuted);
            currentVolumeLS = localStorage.getItem(lsKeyVolume);
            if (localStorageHookFailed && player?.core?.state) {
                localStorage.setItem(lsKeyMuted, JSON.stringify({default:player.core.state.muted}));
                localStorage.setItem(lsKeyVolume, player.core.state.volume);
            }
            if (localStorageHookFailed && player?.core?.state?.quality?.group) {
                localStorage.setItem(lsKeyQuality, JSON.stringify({default:player.core.state.quality.group}));
            }
        } catch {}
        console.log('Reloading Twitch player');
        playerState.setSrc({ isNewMediaPlayerInstance: true, refreshAccessToken: true });
        postTwitchWorkerMessage('TriggeredPlayerReload');
        player.play();
        if (localStorageHookFailed && (currentQualityLS || currentMutedLS || currentVolumeLS)) {
            setTimeout(() => {
                try {
                    if (currentQualityLS) {
                        localStorage.setItem(lsKeyQuality, currentQualityLS);
                    }
                    if (currentMutedLS) {
                        localStorage.setItem(lsKeyMuted, currentMutedLS);
                    }
                    if (currentVolumeLS) {
                        localStorage.setItem(lsKeyVolume, currentVolumeLS);
                    }
                } catch {}
            }, 3000);
        }
        return true;
    }
}

window.reloadTwitchPlayer = () => {
    doTwitchPlayerTask(false, true);
};

/**
 * Boucle de surveillance du buffering du player.
 *
 * Détecte quand le player est coincé (position et buffer qui n'évoluent plus)
 * et déclenche pause/play ou reload du player. La boucle s'arrête quand
 * tnsAdsEnabled est false et est relancée par applyFeatureFlag.
 *
 * @returns {void}
 */
function monitorPlayerBuffering() {
    if (!tnsAdsEnabled) { return; }
    if (playerForMonitoringBuffering) {
        try {
            const player = playerForMonitoringBuffering.player;
            const state = playerForMonitoringBuffering.state;
            if (!player.core) {
                playerForMonitoringBuffering = null;
            } else if (state.props?.content?.type === 'live' && !player.isPaused() && !player.getHTMLVideoElement()?.ended && playerBufferState.lastFixTime <= Date.now() - PlayerBufferingMinRepeatDelay && !isActivelyStrippingAds) {
                const m3u8Url = player.core?.state?.path;
                if (m3u8Url) {
                    const fileName = new URL(m3u8Url).pathname.split('/').pop();
                    if (fileName?.endsWith('.m3u8')) {
                        const channelName = fileName.slice(0, -5);
                        if (playerBufferState.channelName != channelName) {
                            playerBufferState.channelName = channelName;
                            playerBufferState.hasStreamStarted = false;
                            playerBufferState.numSame = 0;
                        }
                    }
                }
                if (player.getState() === 'Playing') {
                    playerBufferState.hasStreamStarted = true;
                }
                const position = player.core?.state?.position;
                const bufferedPosition = player.core?.state?.bufferedPosition;
                const bufferDuration = player.getBufferDuration();
                if (position !== undefined && bufferedPosition !== undefined) {
                    if (playerBufferState.hasStreamStarted &&
                        (!PlayerBufferingPrerollCheckEnabled || position > PlayerBufferingPrerollCheckOffset) &&
                        (playerBufferState.position == position || bufferDuration < PlayerBufferingDangerZone) &&
                        playerBufferState.bufferedPosition == bufferedPosition &&
                        playerBufferState.bufferDuration >= bufferDuration &&
                        (position != 0 || bufferedPosition != 0 || bufferDuration != 0)
                    ) {
                        playerBufferState.numSame++;
                        if (playerBufferState.numSame == PlayerBufferingSameStateCount) {
                            console.log('Attempt to fix buffering position:' + playerBufferState.position + ' bufferedPosition:' + playerBufferState.bufferedPosition + ' bufferDuration:' + playerBufferState.bufferDuration);
                            const isPausePlay = !PlayerBufferingDoPlayerReload;
                            const isReload = PlayerBufferingDoPlayerReload;
                            doTwitchPlayerTask(isPausePlay, isReload);
                            playerBufferState.lastFixTime = Date.now();
                            playerBufferState.numSame = 0;
                        }
                    } else {
                        playerBufferState.numSame = 0;
                    }
                    playerBufferState.position = position;
                    playerBufferState.bufferedPosition = bufferedPosition;
                    playerBufferState.bufferDuration = bufferDuration;
                } else {
                    playerBufferState.numSame = 0;
                }
            }
        } catch (err) {
            console.error('error when monitoring player for buffering: ' + err);
            playerForMonitoringBuffering = null;
        }
    }
    if (!playerForMonitoringBuffering) {
        const playerAndState = getPlayerAndState();
        if (playerAndState && playerAndState.player && playerAndState.state) {
            playerForMonitoringBuffering = {
                player: playerAndState.player,
                state: playerAndState.state
            };
        }
    }
    const isLive = playerForMonitoringBuffering?.state?.props?.content?.type === 'live';
    if (playerBufferState.isLive && !isLive) {
        updateAdblockBanner({
            hasAds: false
        });
    }
    playerBufferState.isLive = isLive;
    setTimeout(monitorPlayerBuffering, PlayerBufferingDelay);
}


// === fin core/player.js ===


// === core/fetch-hook.js ===

/* globals window, GQLDeviceID, ClientID, AuthorizationHeader, ClientIntegrityHeader,
         ClientVersion, ClientSession, tnsAdsEnabled, ForceAccessTokenPlayerType,
         postTwitchWorkerMessage, realFetch, twitchWorkers */

/**
 * Stocke la référence au fetch d'origine avant écrasement par le hook.
 * @type {Function}
 */
window.realFetch = window.fetch;

/**
 * Hook du fetch dans le contexte page.
 *
 * Encapsule l'assignation de window.fetch pour conserver la compatibilité
 * avec l'appel `hookFetch()` depuis main.js.
 *
 * @returns {void}
 */
function hookFetch() {
    window.fetch = function(url, init, ...args) {
        if (typeof url === "string") {
            if (url.includes('gql')) {
                let deviceId = init.headers['X-Device-Id'];
                if (typeof deviceId !== 'string') {
                    deviceId = init.headers['Device-ID'];
                }
                if (typeof deviceId === 'string' && GQLDeviceID != deviceId) {
                    GQLDeviceID = deviceId;
                    postTwitchWorkerMessage('UpdateDeviceId', GQLDeviceID);
                }
                if (typeof init.headers['Client-Version'] === 'string' && init.headers['Client-Version'] !== ClientVersion) {
                    postTwitchWorkerMessage('UpdateClientVersion', ClientVersion = init.headers['Client-Version']);
                }
                if (typeof init.headers['Client-Session-Id'] === 'string' && init.headers['Client-Session-Id'] !== ClientSession) {
                    postTwitchWorkerMessage('UpdateClientSession', ClientSession = init.headers['Client-Session-Id']);
                }
                if (typeof init.headers['Client-Integrity'] === 'string' && init.headers['Client-Integrity'] !== ClientIntegrityHeader) {
                    postTwitchWorkerMessage('UpdateClientIntegrityHeader', ClientIntegrityHeader = init.headers['Client-Integrity']);
                }
                if (typeof init.headers['Authorization'] === 'string' && init.headers['Authorization'] !== AuthorizationHeader) {
                    postTwitchWorkerMessage('UpdateAuthorizationHeader', AuthorizationHeader = init.headers['Authorization']);
                }
                // Get rid of mini player above chat - TODO: Reject this locally instead of having server reject it
                if (init && typeof init.body === 'string' && init.body.includes('PlaybackAccessToken') && init.body.includes('picture-by-picture')) {
                    init.body = '';
                }
                if (tnsAdsEnabled && ForceAccessTokenPlayerType && typeof init.body === 'string' && init.body.includes('PlaybackAccessToken')) {
                    let replacedPlayerType = '';
                    const newBody = JSON.parse(init.body);
                    if (Array.isArray(newBody)) {
                        for (let i = 0; i < newBody.length; i++) {
                            if (newBody[i]?.variables?.playerType && newBody[i]?.variables?.playerType !== ForceAccessTokenPlayerType) {
                                replacedPlayerType = newBody[i].variables.playerType;
                                newBody[i].variables.playerType = ForceAccessTokenPlayerType;
                            }
                        }
                    } else {
                        if (newBody?.variables?.playerType && newBody?.variables?.playerType !== ForceAccessTokenPlayerType) {
                            replacedPlayerType = newBody.variables.playerType;
                            newBody.variables.playerType = ForceAccessTokenPlayerType;
                        }
                    }
                    if (replacedPlayerType) {
                        console.log(`Replaced '${replacedPlayerType}' player type with '${ForceAccessTokenPlayerType}' player type`);
                        init.body = JSON.stringify(newBody);
                    }
                }
            }
        }
        return realFetch.apply(this, arguments);
    };
}

/**
 * Gère une requête fetch relayée depuis le worker (round-trip page -> worker).
 *
 * Le worker ne peut pas faire de fetch directement (CORS, cookies). Il envoie
 * donc une FetchRequest au contexte page, qui exécute le fetch avec
 * window.realFetch et retourne les données via FetchResponse.
 *
 * @param {Object} fetchRequest - { id, url, options }
 * @returns {Promise<Object>} { id, status, statusText, headers, body } ou { id, error }
 */
async function handleWorkerFetchRequest(fetchRequest) {
    try {
        const response = await window.realFetch(fetchRequest.url, fetchRequest.options);
        const responseBody = await response.text();
        const responseObject = {
            id: fetchRequest.id,
            status: response.status,
            statusText: response.statusText,
            headers: Object.fromEntries(response.headers.entries()),
            body: responseBody
        };
        return responseObject;
    } catch (error) {
        return {
            id: fetchRequest.id,
            error: error.message
        };
    }
}

/**
 * Envoie un message à tous les workers Twitch interceptés.
 *
 * @param {string} key - Clé du message (ex: 'UpdateFeatureFlags', 'SimulateAds')
 * @param {any} value - Valeur associée
 * @returns {void}
 */
function postTwitchWorkerMessage(key, value) {
    twitchWorkers.forEach((worker) => {
        worker.postMessage({key: key, value: value});
    });
}


// === fin core/fetch-hook.js ===


// === core/storage.js ===

/* globals localStorage, console, stats, seenVodIds, saveStats, logStats,
         tnsAdsEnabled, tnsVodsEnabled, isEnabled, applyFeatureFlag, toggleEnabled,
         postTwitchWorkerMessage, twitchWorkers, monitorPlayerBuffering,
         PlayerBufferingFix, doTwitchPlayerTask, location */

/**
 * Statistiques persistantes (pubs bloquées / VODs débloquées).
 * Les valeurs sont restaurées depuis localStorage au chargement et
 * persédées à chaque événement via saveStats().
 * Déclarées dans globals.js.
 */

/**
 * Ensemble des IDs de VOD déjà débloquées (session en cours).
 * Évite le sur-comptage quand le player re-fetche la même VOD
 * (switch de qualité, retries).
 * Déclarée dans globals.js.
 */

// Restaure les stats depuis localStorage au chargement
try {
    Object.assign(stats, JSON.parse(localStorage.getItem("twitchnosub-stats") || "{}"));
} catch (e) {}

/**
 * Persiste les stats dans localStorage.
 *
 * @returns {void}
 */
function saveStats() {
    try {
        localStorage.setItem("twitchnosub-stats", JSON.stringify(stats));
    } catch (e) {}
}

/**
 * Affiche le résumé des stats en console au chargement du script.
 *
 * @returns {void}
 */
function logStats() {
    console.log('%c📊 TwitchNoSub+Ads', 'color:#9146FF;font-weight:bold;font-size:13px');
    console.log('   📺 Pubs bloquées  : ' + stats.adsBlocked);
    console.log('   🎬 VODs débloquées : ' + stats.vodsUnlocked);
}

/**
 * Désactive/réactive le script entièrement et recharge la page.
 *
 * @returns {void}
 */
function toggleEnabled() {
    const next = localStorage.getItem("twitchnosub-enabled") === "false";
    localStorage.setItem("twitchnosub-enabled", next);
    location.reload();
}

/**
 * Applique un flag de feature à chaud dans tous les workers et recharge le player.
 *
 * Met à jour localStorage, les flags en mémoire, envoie UpdateFeatureFlags
 * à tous les workers via postMessage, puis tente un reload du player.
 * Si le reload du player échoue, fait un fallback location.reload().
 *
 * @param {string} flag - "twitchnosub-ads" ou "twitchnosub-vods"
 * @param {boolean} enabled - Nouvel état du flag
 * @returns {void}
 */
function applyFeatureFlag(flag, enabled) {
    if (flag === "twitchnosub-ads") {
        tnsAdsEnabled = enabled;
        if (enabled && PlayerBufferingFix) {
            monitorPlayerBuffering();
        }
    } else if (flag === "twitchnosub-vods") {
        tnsVodsEnabled = enabled;
    }
    console.log('%c🎛️ Pubs: ' + (tnsAdsEnabled ? 'ON' : 'OFF') + ' · VODs: ' + (tnsVodsEnabled ? 'ON' : 'OFF') + ' — flags envoyés à ' + twitchWorkers.length + ' worker(s)', 'color:#9146FF');
    postTwitchWorkerMessage('UpdateFeatureFlags', { adsEnabled: tnsAdsEnabled, vodsEnabled: tnsVodsEnabled });
    setTimeout(function() {
        try {
            const reloaded = doTwitchPlayerTask(false, true);
            if (!reloaded) {
                console.log('%c🔄 Reload du player impossible — rechargement de la page pour appliquer', 'color:#ff7b72');
                location.reload();
            }
        } catch (err) {
            console.log('%c🔄 Reload du player en erreur (' + err.message + ') — rechargement de la page pour appliquer', 'color:#ff7b72');
            location.reload();
        }
    }, 150);
}


// === fin core/storage.js ===


// === ui.js ===

/* globals document, console, tnsAdsEnabled, tnsVodsEnabled, stats, toggleEnabled,
         applyFeatureFlag, isEnabled */

/**
 * Injecte le style CSS des boutons header et du panneau stats.
 * Le style n'est injecté qu'une seule fois (gardé par l'ID `tns-hbtn-style`).
 *
 * @returns {void}
 */
function injectStyles() {
    if (document.getElementById("tns-hbtn-style")) {
        return;
    }
    try {
        const style = document.createElement("style");
        style.id = "tns-hbtn-style";
        style.textContent = ".tns-hbtn{display:inline-flex;align-items:center;gap:5px;height:26px;margin-right:8px;padding:0 10px;border:none;border-radius:6px;background:#26262c;color:#efeff1;font:600 12px/1 system-ui;cursor:pointer;transition:background .15s}" +
            ".tns-hbtn:hover{background:#3a3a3d}" +
            ".tns-hbtn.off{background:#3a2430;color:#ff7b72}" +
            ".tns-panel{position:fixed;z-index:999999;min-width:235px;background:#1e222d;border:1px solid #3a4150;border-radius:10px;padding:12px;box-shadow:0 8px 24px rgba(0,0,0,.5);font:13px/1.6 system-ui;color:#efeff1}" +
            ".tns-p-title{font-weight:700;color:#9146FF;margin-bottom:8px}" +
            ".tns-p-stats{display:flex;justify-content:space-between;align-items:center;padding:2px 0}" +
            ".tns-p-sep{height:1px;background:#3a4150;margin:8px 0}" +
            ".tns-p-row{display:flex;justify-content:space-between;align-items:center;padding:4px 6px;margin:0 -6px;cursor:pointer;border-radius:6px}" +
            ".tns-p-row:hover{background:#26262c}" +
            ".tns-p-pill{width:40px;height:20px;border-radius:10px;background:#3a3a3d;position:relative;flex:none;transition:background .15s}" +
            ".tns-p-pill::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#efeff1;transition:left .15s}" +
            ".tns-p-pill.on{background:#9146FF}" +
            ".tns-p-pill.on::after{left:22px}";
        document.head.appendChild(style);
        document.addEventListener("click", function(e) {
            const panel = document.getElementById("tns-panel");
            const inside = e.target.closest ? !!e.target.closest("#tns-panel") : false;
            if (panel && !inside && e.target.id !== "tns-hstats") {
                panel.remove();
            }
        }, true);
    } catch (err) {
        console.log('[TwVodNoAdsJCed] Erreur injectStyles: ' + err);
    }
}

/**
 * Ouvre/ferme le panneau déroulant des stats et toggles.
 * Positionné sous le bouton 📊 Stats.
 *
 * @returns {void}
 */
function toggleStatsPanel() {
    const existing = document.getElementById("tns-panel");
    if (existing) {
        existing.remove();
        return;
    }
    const statsBtn = document.getElementById("tns-hstats");
    if (!statsBtn) {
        return;
    }
    const panel = document.createElement("div");
    panel.id = "tns-panel";
    panel.className = "tns-panel";
    panel.innerHTML =
        '<div class="tns-p-title">📊 TwitchNoSub+Ads</div>' +
        '<div class="tns-p-stats"><span>Pubs bloquées</span><b>' + stats.adsBlocked + '</b></div>' +
        '<div class="tns-p-stats"><span>VODs débloquées</span><b>' + stats.vodsUnlocked + '</b></div>' +
        '<div class="tns-p-sep"></div>' +
        '<div class="tns-p-row" data-flag="twitchnosub-ads" data-on="' + tnsAdsEnabled + '"><span>📺 Blocage pubs</span><span class="tns-p-pill' + (tnsAdsEnabled ? " on" : " off") + '"></span></div>' +
        '<div class="tns-p-row" data-flag="twitchnosub-vods" data-on="' + tnsVodsEnabled + '"><span>🎬 VODs sub-only</span><span class="tns-p-pill' + (tnsVodsEnabled ? " on" : " off") + '"></span></div>';
    panel.addEventListener("click", function(e) {
        const row = e.target.closest ? e.target.closest(".tns-p-row") : null;
        if (!row) {
            return;
        }
        const flag = row.getAttribute("data-flag");
        const next = row.getAttribute("data-on") !== "true";
        localStorage.setItem(flag, next ? "true" : "false");
        applyFeatureFlag(flag, next);
        row.setAttribute("data-on", next);
        const pill = row.querySelector(".tns-p-pill");
        if (pill) {
            pill.className = "tns-p-pill" + (next ? " on" : " off");
        }
    });
    document.body.appendChild(panel);
    const r = statsBtn.getBoundingClientRect();
    panel.style.top = (r.bottom + 6) + "px";
    panel.style.left = r.left + "px";
}

/**
 * Trouve le conteneur de la barre d'actions de la chaîne
 * (viewers / durée / partage / ⋮).
 *
 * Stratégie d'ancrage :
 * - `share-button` ([data-a-target="share-button"]) est unique à la barre de la chaîne.
 * - `channel-actions` ([data-a-target="channel-actions"]) existe aussi dans la nav
 *   du haut → on prend le DERNIER match.
 * - On remonte depuis `share-button` jusqu'au conteneur commun qui contient aussi `⋮`.
 * - Fallbacks : parent de `share-button`, parent de `⋮`, parent du bouton cadeau.
 *
 * @returns {HTMLElement|null} Le conteneur DOM, ou null s'il n'est pas trouvé
 */
function findContainer() {
    try {
        const shareBtn = document.querySelector('[data-a-target="share-button"]');
        const dotsList = document.querySelectorAll('[data-a-target="channel-actions"]');
        const dots = dotsList.length ? dotsList[dotsList.length - 1] : null;
        /** @type {HTMLElement|null} */
        let container = null;
        if (shareBtn && dots) {
            let p = shareBtn.parentElement;
            while (p && p !== document.body && !p.contains(dots)) {
                p = p.parentElement;
            }
            if (p && p !== document.body) {
                container = p;
            }
        }
        if (!container && shareBtn) {
            container = shareBtn.parentElement;
        }
        if (!container && dots) {
            container = dots.parentElement;
        }
        if (!container) {
            const giftBtn = document.querySelector('[data-a-target="gift-button"]');
            if (giftBtn) {
                container = giftBtn.parentElement;
            }
        }
        if (container) {
            console.log('[TwVodNoAdsJCed] Conteneur header trouvé');
        }
        return container;
    } catch (err) {
        console.log('[TwVodNoAdsJCed] Erreur findContainer: ' + err);
        return null;
    }
}

/**
 * Injecte les boutons 📊 Stats et ⏻ ON/OFF dans le header de la chaîne.
 *
 * Utilise un setInterval (2s) comme l'original pour garantir l'injection
 * dès que le header Twitch est rendu (le DOM n'est pas prêt à document-start).
 * S'arrête dès que les boutons sont injectés.
 *
 * @param {boolean} disabledOnly - si true, injecte uniquement le bouton ON/OFF
 * @returns {void}
 */
function injectHeaderButtons(disabledOnly) {
    injectStyles();

    /**
     * Tente l'injection une fois. Retourne true si déjà injecté ou injection réussie.
     * @returns {boolean}
     */
    const tryInject = function() {
        if (document.getElementById("tns-hstats") || document.getElementById("tns-htoggle")) {
            return true;
        }
        const container = findContainer();
        if (!container) {
            return false;
        }
        const toggleBtn = document.createElement("button");
        toggleBtn.id = "tns-htoggle";
        toggleBtn.className = "tns-hbtn" + (isEnabled ? "" : " off");
        toggleBtn.textContent = isEnabled ? "⏻ ON" : "⏻ OFF";
        toggleBtn.title = "Activer / désactiver le script";
        toggleBtn.onclick = toggleEnabled;
        if (disabledOnly) {
            container.prepend(toggleBtn);
        } else {
            const statsBtn = document.createElement("button");
            statsBtn.id = "tns-hstats";
            statsBtn.className = "tns-hbtn";
            statsBtn.textContent = "📊 Stats";
            statsBtn.title = "Afficher les stats";
            statsBtn.onclick = toggleStatsPanel;
            container.prepend(toggleBtn);
            container.prepend(statsBtn);
        }
        console.log('%c🔘 Boutons TwVodNoAdsJCed injectés', 'color:#9146FF');
        return true;
    };

    // Tentative immédiate
    tryInject();

    // Re-tente toutes les 2s jusqu'à succès (comme l'original qui fonctionnait)
    let attempts = 0;
    const pollInterval = setInterval(function() {
        attempts++;
        if (tryInject()) {
            clearInterval(pollInterval);
            console.log('[TwVodNoAdsJCed] Injection terminée après ' + attempts + ' tentative(s)');
        } else if (attempts > 150) { // 5 min max
            clearInterval(pollInterval);
            console.log('[TwVodNoAdsJCed] Échec injection après 150 tentatives — conteneur introuvable');
        }
    }, 2000);
}


// === fin ui.js ===


// === main.js ===

/* globals window, document, console, localStorage, location, stats, seenVodIds,
         saveStats, logStats, tnsAdsEnabled, tnsVodsEnabled, isEnabled,
         declareOptions, hookWindowWorker, hookFetch, removeRestrictions, watchDOM,
         monitorPlayerBuffering, onContentLoaded, injectHeaderButtons, toggleEnabled,
         applyFeatureFlag, toggleStatsPanel, PlayerBufferingFix, ourTwitchAdSolutionsVersion */

/**
 * Détection de conflit avec une autre version du script.
 *
 * Si un autre userscript avec une version >= notre version est déjà actif,
 * on s'arrête pour éviter les conflits de hook de Worker.
 *
 * @type {number}
 */
const ourTwitchAdSolutionsVersion = 1;
if (typeof window.twitchAdSolutionsVersion !== 'undefined' && window.twitchAdSolutionsVersion >= ourTwitchAdSolutionsVersion) {
    console.log("skipping vaft as there's another script active. ourVersion:" + ourTwitchAdSolutionsVersion + " activeVersion:" + window.twitchAdSolutionsVersion);
    window.twitchAdSolutionsVersion = ourTwitchAdSolutionsVersion;
    return;
}
window.twitchAdSolutionsVersion = ourTwitchAdSolutionsVersion;

/**
 * Sélecteurs de restrictions (TwitchNoSub) à nettoyer dans le DOM.
 * @type {ReadonlyArray<string>}
 */
const RESTRICTION_SELECTORS = [
    ".video-preview-card-restriction",
    ".video-preview-card__banner--sub-only",
    ".pulse-card__card--restricted",
    '[data-a-target="sub-only-badge"]',
    ".video-player__mandatory-login"
];

/**
 * Supprime les overlays de restriction du DOM.
 *
 * @param {Element|Document} [root=document] - Racine de recherche (défaut: document)
 * @returns {void}
 */
function removeRestrictions(root) {
    RESTRICTION_SELECTORS.forEach(function(sel) {
        var els = (root || document).querySelectorAll(sel);
        for (var i = 0; i < els.length; i++) {
            els[i].remove();
        }
    });
}

/**
 * Observe le DOM pour supprimer les restrictions dès qu'elles apparaissent.
 *
 * Utilise un MutationObserver avec requestAnimationFrame pour éviter
 * de surcharger le thread principal lors de changements DOM fréquents.
 *
 * @returns {void}
 */
function watchDOM() {
    var db = null;
    new MutationObserver(function(muts) {
        if (db) cancelAnimationFrame(db);
        db = requestAnimationFrame(function() {
            for (var i = 0; i < muts.length; i++) {
                var ns = muts[i].addedNodes;
                for (var j = 0; j < ns.length; j++) {
                    if (ns[j].nodeType === 1) {
                        removeRestrictions(ns[j]);
                    }
                }
            }
        });
    }).observe(document.documentElement, { childList: true, subtree: true });
}

/**
 * Empêche Twitch de mettre le player en pause quand l'onglet est inactif.
 * Préserve aussi la lecture vidéo quand on revient sur l'onglet.
 *
 * @returns {void}
 */
function onContentLoaded() {
    try {
        Object.defineProperty(document, 'visibilityState', {
            get() {
                return 'visible';
            }
        });
    } catch {}
    let hidden = document.__lookupGetter__('hidden');
    let webkitHidden = document.__lookupGetter__('webkitHidden');
    try {
        Object.defineProperty(document, 'hidden', {
            get() {
                return false;
            }
        });
    } catch {}
    const block = e => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
    };
    let wasVideoPlaying = true;
    const visibilityChange = e => {
        const isChrome = typeof chrome !== 'undefined';
        const videos = document.getElementsByTagName('video');
        if (videos.length > 0) {
            if (hidden.apply(document) === true || (webkitHidden && webkitHidden.apply(document) === true)) {
                wasVideoPlaying = !videos[0].paused && !videos[0].ended;
            } else {
                if (!playerBufferState.hasStreamStarted) {
                    playerBufferState.hasStreamStarted = true;
                }
                if (isChrome && wasVideoPlaying && !videos[0].ended && videos[0].paused && videos[0].muted) {
                    videos[0].play();
                }
            }
        }
        block(e);
    };
    document.addEventListener('visibilitychange', visibilityChange, true);
    document.addEventListener('webkitvisibilitychange', visibilityChange, true);
    document.addEventListener('mozvisibilitychange', visibilityChange, true);
    document.addEventListener('hasFocus', block, true);
    try {
        if (/Firefox/.test(navigator.userAgent)) {
            Object.defineProperty(document, 'mozHidden', {
                get() {
                    return false;
                }
            });
        } else {
            Object.defineProperty(document, 'webkitHidden', {
                get() {
                    return false;
                }
            });
        }
    } catch {}
    // Hooks pour préserver volume / résolution lors d'un reload du player
    try {
        const keysToCache = [
            'video-quality',
            'video-muted',
            'volume',
            'lowLatencyModeEnabled',
            'persistenceEnabled'
        ];
        const cachedValues = new Map();
        for (let i = 0; i < keysToCache.length; i++) {
            cachedValues.set(keysToCache[i], localStorage.getItem(keysToCache[i]));
        }
        const realSetItem = localStorage.setItem;
        localStorage.setItem = function(key, value) {
            if (cachedValues.has(key)) {
                cachedValues.set(key, value);
            }
            realSetItem.apply(this, arguments);
        };
        const realGetItem = localStorage.getItem;
        localStorage.getItem = function(key) {
            if (cachedValues.has(key)) {
                return cachedValues.get(key);
            }
            return realGetItem.apply(this, arguments);
        };
        if (!localStorage.getItem.toString().includes(Object.keys({cachedValues})[0])) {
            localStorageHookFailed = true;
        }
    } catch (err) {
        console.log('localStorageHooks failed ' + err);
        localStorageHookFailed = true;
    }
}

// =====================================================================
// Assemblage final (équivalent du corps du userscript monolithique)
// =====================================================================

console.log('[TwVodNoAdsJCed] Démarrage du script (v' + ourTwitchAdSolutionsVersion + ')');

declareOptions(window);
console.log('[TwVodNoAdsJCed] declareOptions OK');
hookWindowWorker();
console.log('[TwVodNoAdsJCed] hookWindowWorker OK');
hookFetch();
console.log('[TwVodNoAdsJCed] hookFetch OK');
removeRestrictions();
console.log('[TwVodNoAdsJCed] removeRestrictions OK');
watchDOM();
console.log('[TwVodNoAdsJCed] watchDOM OK');

if (!isEnabled) {
    console.log("TwitchNoSub+Ads disabled");
    injectHeaderButtons(true);
    return;
}
logStats();
console.log('[TwVodNoAdsJCed] isEnabled=true, injection des boutons header');
injectHeaderButtons(false);
console.log('[TwVodNoAdsJCed] injectHeaderButtons appelé');

if (PlayerBufferingFix && tnsAdsEnabled) {
    monitorPlayerBuffering();
}

if (document.readyState === "complete" || document.readyState === "loaded" || document.readyState === "interactive") {
    onContentLoaded();
} else {
    window.addEventListener("DOMContentLoaded", function() {
        onContentLoaded();
    });
}

/**
 * Simule des pubs pour tester le blocage (console uniquement).
 *
 * @param {number} depth - 0 = aucune pub simulée, 1+ = utilise le backup player pour cette profondeur
 * @returns {void}
 */
window.simulateAds = (depth) => {
    if (depth === undefined || depth < 0) {
        console.log('Ad depth paramter required (0 = no simulated ad, 1+ = use backup player for given depth)');
        return;
    }
    postTwitchWorkerMessage('SimulateAds', depth);
};

/**
 * Marque tous les segments comme segments publicitaires (console uniquement).
 *
 * @returns {void}
 */
window.allSegmentsAreAdSegments = () => {
    postTwitchWorkerMessage('AllSegmentsAreAdSegments');
};


// === fin main.js ===


})();
