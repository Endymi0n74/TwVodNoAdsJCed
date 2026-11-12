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
const stats = { adsBlocked: 0, vodsUnlocked: 0 };

/**
 * Ensemble des IDs de VOD déjà débloquées (session en cours).
 * @type {Set<string>}
 */
const seenVodIds = new Set();

/**
 * Kill-switch pour le blocage de pubs.
 * @type {boolean}
 */
let tnsAdsEnabled = localStorage.getItem('twitchnosub-ads') !== 'false';

/**
 * Kill-switch pour le bypass VOD sub-only.
 * @type {boolean}
 */
let tnsVodsEnabled = localStorage.getItem('twitchnosub-vods') !== 'false';

/**
 * État global du script (ON/OFF via le bouton header).
 * @type {boolean}
 */
let isEnabled = localStorage.getItem('twitchnosub-enabled') !== 'false';

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
