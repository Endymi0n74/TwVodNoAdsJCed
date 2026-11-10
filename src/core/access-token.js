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
