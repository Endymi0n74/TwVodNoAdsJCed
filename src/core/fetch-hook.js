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
    window.fetch = function (url, init, ...args) {
        if (typeof url === 'string') {
            if (url.includes('gql')) {
                let deviceId = init.headers['X-Device-Id'];
                if (typeof deviceId !== 'string') {
                    deviceId = init.headers['Device-ID'];
                }
                if (typeof deviceId === 'string' && GQLDeviceID != deviceId) {
                    GQLDeviceID = deviceId;
                    postTwitchWorkerMessage('UpdateDeviceId', GQLDeviceID);
                }
                if (
                    typeof init.headers['Client-Version'] === 'string' &&
                    init.headers['Client-Version'] !== ClientVersion
                ) {
                    postTwitchWorkerMessage('UpdateClientVersion', (ClientVersion = init.headers['Client-Version']));
                }
                if (
                    typeof init.headers['Client-Session-Id'] === 'string' &&
                    init.headers['Client-Session-Id'] !== ClientSession
                ) {
                    postTwitchWorkerMessage('UpdateClientSession', (ClientSession = init.headers['Client-Session-Id']));
                }
                if (
                    typeof init.headers['Client-Integrity'] === 'string' &&
                    init.headers['Client-Integrity'] !== ClientIntegrityHeader
                ) {
                    postTwitchWorkerMessage(
                        'UpdateClientIntegrityHeader',
                        (ClientIntegrityHeader = init.headers['Client-Integrity'])
                    );
                }
                if (
                    typeof init.headers['Authorization'] === 'string' &&
                    init.headers['Authorization'] !== AuthorizationHeader
                ) {
                    postTwitchWorkerMessage(
                        'UpdateAuthorizationHeader',
                        (AuthorizationHeader = init.headers['Authorization'])
                    );
                }
                // Get rid of mini player above chat - TODO: Reject this locally instead of having server reject it
                if (
                    init &&
                    typeof init.body === 'string' &&
                    init.body.includes('PlaybackAccessToken') &&
                    init.body.includes('picture-by-picture')
                ) {
                    init.body = '';
                }
                if (
                    tnsAdsEnabled &&
                    ForceAccessTokenPlayerType &&
                    typeof init.body === 'string' &&
                    init.body.includes('PlaybackAccessToken')
                ) {
                    let replacedPlayerType = '';
                    const newBody = JSON.parse(init.body);
                    if (Array.isArray(newBody)) {
                        for (let i = 0; i < newBody.length; i++) {
                            if (
                                newBody[i]?.variables?.playerType &&
                                newBody[i]?.variables?.playerType !== ForceAccessTokenPlayerType
                            ) {
                                replacedPlayerType = newBody[i].variables.playerType;
                                newBody[i].variables.playerType = ForceAccessTokenPlayerType;
                            }
                        }
                    } else {
                        if (
                            newBody?.variables?.playerType &&
                            newBody?.variables?.playerType !== ForceAccessTokenPlayerType
                        ) {
                            replacedPlayerType = newBody.variables.playerType;
                            newBody.variables.playerType = ForceAccessTokenPlayerType;
                        }
                    }
                    if (replacedPlayerType) {
                        console.log(
                            `Replaced '${replacedPlayerType}' player type with '${ForceAccessTokenPlayerType}' player type`
                        );
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
        worker.postMessage({ key: key, value: value });
    });
}
