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
