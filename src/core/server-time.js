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
    if (!encodingsM3u8) {
        return null;
    }
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
