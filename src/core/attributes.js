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
        str
            .split(/(?:^|,)((?:[^=]*)=(?:"[^"]*"|[^,]*))/)
            .filter(Boolean)
            .map((x) => {
                const idx = x.indexOf('=');
                const key = x.substring(0, idx);
                const value = x.substring(idx + 1);
                const num = Number(value);
                return [key, Number.isNaN(num) ? (value.startsWith('"') ? JSON.parse(value) : value) : num];
            })
    );
}
