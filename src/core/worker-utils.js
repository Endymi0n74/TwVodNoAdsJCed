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
    'isVariantA' // TwitchNoSub
];

/**
 * Sélecteurs de chaînes à détecter pour réinsérer les couches de prototype TwitchNoSub.
 * @type {ReadonlyArray<string>}
 */
const workerStringReinsert = [
    'isVariantA', // TwitchNoSub (prior to 0.9)
    'besuper/' // TwitchNoSub (0.9)
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
    return (
        !workerStringConflicts.some((x) => workerString.includes(x)) ||
        workerStringReinsert.some((x) => workerString.includes(x))
    );
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
    req.overrideMimeType('text/javascript');
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
                const workerString = getWasmWorkerJs('${twitchBlobUrl.replaceAll("'", '%27')}');
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
                        if (seenVodIds.has(e.data.vodId)) {
                            return;
                        }
                        seenVodIds.add(e.data.vodId);
                    }
                    stats.vodsUnlocked++;
                    saveStats();
                    console.log('%c🎬 VOD sub-only débloquée', 'color:#9146FF', '— total : ' + stats.vodsUnlocked);
                } else if (e.data.key == 'FeatureFlagsAck') {
                    console.log(
                        '%c✅ Flags appliqués dans le worker: pubs=' +
                            (e.data.value.adsEnabled ? 'ON' : 'OFF') +
                            ' · VODs=' +
                            (e.data.value.vodsEnabled ? 'ON' : 'OFF'),
                        'color:#9146FF'
                    );
                } else if (e.data.key == 'PauseResumePlayer') {
                    doTwitchPlayerTask(true, false);
                } else if (e.data.key == 'ReloadPlayer') {
                    doTwitchPlayerTask(false, true);
                }
            });
            this.addEventListener('message', async (event) => {
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
        get: function () {
            return workerInstance;
        },
        set: function (value) {
            if (isValidWorker(value)) {
                workerInstance = value;
            } else {
                console.log('Attempt to set twitch worker denied');
            }
        }
    });
}
