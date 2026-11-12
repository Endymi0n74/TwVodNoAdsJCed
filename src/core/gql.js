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
        Authorization: AuthorizationHeader,
        ...(ClientIntegrityHeader && { 'Client-Integrity': ClientIntegrityHeader }),
        ...(ClientVersion && { 'Client-Version': ClientVersion }),
        ...(ClientSession && { 'Client-Session-Id': ClientSession })
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
    return gqlRequest(body, playerType).catch(function (err) {
        if (attempt < GQL_MAX_RETRIES - 1) {
            var delay = GQL_BASE_DELAY * Math.pow(2, attempt);
            console.log('GQL retry ' + (attempt + 1) + '/' + GQL_MAX_RETRIES + ': ' + err.message);
            return new Promise(function (r) {
                setTimeout(r, delay);
            }).then(function () {
                return gqlRequestWithRetry(body, playerType, attempt + 1);
            });
        }
        console.error('GQL failed after ' + GQL_MAX_RETRIES + ' attempts: ' + err.message);
        throw err;
    });
}
