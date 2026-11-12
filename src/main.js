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
if (
    typeof window.twitchAdSolutionsVersion !== 'undefined' &&
    window.twitchAdSolutionsVersion >= ourTwitchAdSolutionsVersion
) {
    console.log(
        "skipping vaft as there's another script active. ourVersion:" +
            ourTwitchAdSolutionsVersion +
            ' activeVersion:' +
            window.twitchAdSolutionsVersion
    );
    window.twitchAdSolutionsVersion = ourTwitchAdSolutionsVersion;
    return;
}
window.twitchAdSolutionsVersion = ourTwitchAdSolutionsVersion;

/**
 * Sélecteurs de restrictions (TwitchNoSub) à nettoyer dans le DOM.
 * @type {ReadonlyArray<string>}
 */
const RESTRICTION_SELECTORS = [
    '.video-preview-card-restriction',
    '.video-preview-card__banner--sub-only',
    '.pulse-card__card--restricted',
    '[data-a-target="sub-only-badge"]',
    '.video-player__mandatory-login'
];

/**
 * Supprime les overlays de restriction du DOM.
 *
 * @param {Element|Document} [root=document] - Racine de recherche (défaut: document)
 * @returns {void}
 */
function removeRestrictions(root) {
    RESTRICTION_SELECTORS.forEach(function (sel) {
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
    new MutationObserver(function (muts) {
        if (db) cancelAnimationFrame(db);
        db = requestAnimationFrame(function () {
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
    const block = (e) => {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
    };
    let wasVideoPlaying = true;
    const visibilityChange = (e) => {
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
        const keysToCache = ['video-quality', 'video-muted', 'volume', 'lowLatencyModeEnabled', 'persistenceEnabled'];
        const cachedValues = new Map();
        for (let i = 0; i < keysToCache.length; i++) {
            cachedValues.set(keysToCache[i], localStorage.getItem(keysToCache[i]));
        }
        const realSetItem = localStorage.setItem;
        localStorage.setItem = function (key, value) {
            if (cachedValues.has(key)) {
                cachedValues.set(key, value);
            }
            realSetItem.apply(this, arguments);
        };
        const realGetItem = localStorage.getItem;
        localStorage.getItem = function (key) {
            if (cachedValues.has(key)) {
                return cachedValues.get(key);
            }
            return realGetItem.apply(this, arguments);
        };
        if (!localStorage.getItem.toString().includes(Object.keys({ cachedValues })[0])) {
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
    console.log('TwitchNoSub+Ads disabled');
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

if (document.readyState === 'complete' || document.readyState === 'loaded' || document.readyState === 'interactive') {
    onContentLoaded();
} else {
    window.addEventListener('DOMContentLoaded', function () {
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
