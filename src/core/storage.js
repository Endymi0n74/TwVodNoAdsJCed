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
    Object.assign(stats, JSON.parse(localStorage.getItem('twitchnosub-stats') || '{}'));
} catch (e) {}

/**
 * Persiste les stats dans localStorage.
 *
 * @returns {void}
 */
function saveStats() {
    try {
        localStorage.setItem('twitchnosub-stats', JSON.stringify(stats));
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
    const next = localStorage.getItem('twitchnosub-enabled') === 'false';
    localStorage.setItem('twitchnosub-enabled', next);
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
    if (flag === 'twitchnosub-ads') {
        tnsAdsEnabled = enabled;
        if (enabled && PlayerBufferingFix) {
            monitorPlayerBuffering();
        }
    } else if (flag === 'twitchnosub-vods') {
        tnsVodsEnabled = enabled;
    }
    console.log(
        '%c🎛️ Pubs: ' +
            (tnsAdsEnabled ? 'ON' : 'OFF') +
            ' · VODs: ' +
            (tnsVodsEnabled ? 'ON' : 'OFF') +
            ' — flags envoyés à ' +
            twitchWorkers.length +
            ' worker(s)',
        'color:#9146FF'
    );
    postTwitchWorkerMessage('UpdateFeatureFlags', { adsEnabled: tnsAdsEnabled, vodsEnabled: tnsVodsEnabled });
    setTimeout(function () {
        try {
            const reloaded = doTwitchPlayerTask(false, true);
            if (!reloaded) {
                console.log(
                    '%c🔄 Reload du player impossible — rechargement de la page pour appliquer',
                    'color:#ff7b72'
                );
                location.reload();
            }
        } catch (err) {
            console.log(
                '%c🔄 Reload du player en erreur (' + err.message + ') — rechargement de la page pour appliquer',
                'color:#ff7b72'
            );
            location.reload();
        }
    }, 150);
}
