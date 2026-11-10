/* globals document, console, tnsAdsEnabled, tnsVodsEnabled, stats, toggleEnabled,
         applyFeatureFlag, isEnabled */

/**
 * Injecte le style CSS des boutons header et du panneau stats.
 * Le style n'est injecté qu'une seule fois (gardé par l'ID `tns-hbtn-style`).
 *
 * @returns {void}
 */
function injectStyles() {
    if (document.getElementById("tns-hbtn-style")) {
        return;
    }
    try {
        const style = document.createElement("style");
        style.id = "tns-hbtn-style";
        style.textContent = ".tns-hbtn{display:inline-flex;align-items:center;gap:5px;height:26px;margin-right:8px;padding:0 10px;border:none;border-radius:6px;background:#26262c;color:#efeff1;font:600 12px/1 system-ui;cursor:pointer;transition:background .15s}" +
            ".tns-hbtn:hover{background:#3a3a3d}" +
            ".tns-hbtn.off{background:#3a2430;color:#ff7b72}" +
            ".tns-panel{position:fixed;z-index:999999;min-width:235px;background:#1e222d;border:1px solid #3a4150;border-radius:10px;padding:12px;box-shadow:0 8px 24px rgba(0,0,0,.5);font:13px/1.6 system-ui;color:#efeff1}" +
            ".tns-p-title{font-weight:700;color:#9146FF;margin-bottom:8px}" +
            ".tns-p-stats{display:flex;justify-content:space-between;align-items:center;padding:2px 0}" +
            ".tns-p-sep{height:1px;background:#3a4150;margin:8px 0}" +
            ".tns-p-row{display:flex;justify-content:space-between;align-items:center;padding:4px 6px;margin:0 -6px;cursor:pointer;border-radius:6px}" +
            ".tns-p-row:hover{background:#26262c}" +
            ".tns-p-pill{width:40px;height:20px;border-radius:10px;background:#3a3a3d;position:relative;flex:none;transition:background .15s}" +
            ".tns-p-pill::after{content:'';position:absolute;top:2px;left:2px;width:16px;height:16px;border-radius:50%;background:#efeff1;transition:left .15s}" +
            ".tns-p-pill.on{background:#9146FF}" +
            ".tns-p-pill.on::after{left:22px}";
        document.head.appendChild(style);
        document.addEventListener("click", function(e) {
            const panel = document.getElementById("tns-panel");
            const inside = e.target.closest ? !!e.target.closest("#tns-panel") : false;
            if (panel && !inside && e.target.id !== "tns-hstats") {
                panel.remove();
            }
        }, true);
    } catch (err) {
        console.log('[TwVodNoAdsJCed] Erreur injectStyles: ' + err);
    }
}

/**
 * Ouvre/ferme le panneau déroulant des stats et toggles.
 * Positionné sous le bouton 📊 Stats.
 *
 * @returns {void}
 */
function toggleStatsPanel() {
    const existing = document.getElementById("tns-panel");
    if (existing) {
        existing.remove();
        return;
    }
    const statsBtn = document.getElementById("tns-hstats");
    if (!statsBtn) {
        return;
    }
    const panel = document.createElement("div");
    panel.id = "tns-panel";
    panel.className = "tns-panel";
    panel.innerHTML =
        '<div class="tns-p-title">📊 TwitchNoSub+Ads</div>' +
        '<div class="tns-p-stats"><span>Pubs bloquées</span><b>' + stats.adsBlocked + '</b></div>' +
        '<div class="tns-p-stats"><span>VODs débloquées</span><b>' + stats.vodsUnlocked + '</b></div>' +
        '<div class="tns-p-sep"></div>' +
        '<div class="tns-p-row" data-flag="twitchnosub-ads" data-on="' + tnsAdsEnabled + '"><span>📺 Blocage pubs</span><span class="tns-p-pill' + (tnsAdsEnabled ? " on" : " off") + '"></span></div>' +
        '<div class="tns-p-row" data-flag="twitchnosub-vods" data-on="' + tnsVodsEnabled + '"><span>🎬 VODs sub-only</span><span class="tns-p-pill' + (tnsVodsEnabled ? " on" : " off") + '"></span></div>';
    panel.addEventListener("click", function(e) {
        const row = e.target.closest ? e.target.closest(".tns-p-row") : null;
        if (!row) {
            return;
        }
        const flag = row.getAttribute("data-flag");
        const next = row.getAttribute("data-on") !== "true";
        localStorage.setItem(flag, next ? "true" : "false");
        applyFeatureFlag(flag, next);
        row.setAttribute("data-on", next);
        const pill = row.querySelector(".tns-p-pill");
        if (pill) {
            pill.className = "tns-p-pill" + (next ? " on" : " off");
        }
    });
    document.body.appendChild(panel);
    const r = statsBtn.getBoundingClientRect();
    panel.style.top = (r.bottom + 6) + "px";
    panel.style.left = r.left + "px";
}

/**
 * Trouve le conteneur de la barre d'actions de la chaîne
 * (viewers / durée / partage / ⋮).
 *
 * Stratégie d'ancrage :
 * - `share-button` ([data-a-target="share-button"]) est unique à la barre de la chaîne.
 * - `channel-actions` ([data-a-target="channel-actions"]) existe aussi dans la nav
 *   du haut → on prend le DERNIER match.
 * - On remonte depuis `share-button` jusqu'au conteneur commun qui contient aussi `⋮`.
 * - Fallbacks : parent de `share-button`, parent de `⋮`, parent du bouton cadeau.
 *
 * @returns {HTMLElement|null} Le conteneur DOM, ou null s'il n'est pas trouvé
 */
function findContainer() {
    try {
        const shareBtn = document.querySelector('[data-a-target="share-button"]');
        const dotsList = document.querySelectorAll('[data-a-target="channel-actions"]');
        const dots = dotsList.length ? dotsList[dotsList.length - 1] : null;
        /** @type {HTMLElement|null} */
        let container = null;
        if (shareBtn && dots) {
            let p = shareBtn.parentElement;
            while (p && p !== document.body && !p.contains(dots)) {
                p = p.parentElement;
            }
            if (p && p !== document.body) {
                container = p;
            }
        }
        if (!container && shareBtn) {
            container = shareBtn.parentElement;
        }
        if (!container && dots) {
            container = dots.parentElement;
        }
        if (!container) {
            const giftBtn = document.querySelector('[data-a-target="gift-button"]');
            if (giftBtn) {
                container = giftBtn.parentElement;
            }
        }
        if (container) {
            console.log('[TwVodNoAdsJCed] Conteneur header trouvé');
        }
        return container;
    } catch (err) {
        console.log('[TwVodNoAdsJCed] Erreur findContainer: ' + err);
        return null;
    }
}

/**
 * Injecte les boutons 📊 Stats et ⏻ ON/OFF dans le header de la chaîne.
 *
 * Utilise un setInterval (2s) comme l'original pour garantir l'injection
 * dès que le header Twitch est rendu (le DOM n'est pas prêt à document-start).
 * S'arrête dès que les boutons sont injectés.
 *
 * @param {boolean} disabledOnly - si true, injecte uniquement le bouton ON/OFF
 * @returns {void}
 */
function injectHeaderButtons(disabledOnly) {
    injectStyles();

    /**
     * Tente l'injection une fois. Retourne true si déjà injecté ou injection réussie.
     * @returns {boolean}
     */
    const tryInject = function() {
        if (document.getElementById("tns-hstats") || document.getElementById("tns-htoggle")) {
            return true;
        }
        const container = findContainer();
        if (!container) {
            return false;
        }
        const toggleBtn = document.createElement("button");
        toggleBtn.id = "tns-htoggle";
        toggleBtn.className = "tns-hbtn" + (isEnabled ? "" : " off");
        toggleBtn.textContent = isEnabled ? "⏻ ON" : "⏻ OFF";
        toggleBtn.title = "Activer / désactiver le script";
        toggleBtn.onclick = toggleEnabled;
        if (disabledOnly) {
            container.prepend(toggleBtn);
        } else {
            const statsBtn = document.createElement("button");
            statsBtn.id = "tns-hstats";
            statsBtn.className = "tns-hbtn";
            statsBtn.textContent = "📊 Stats";
            statsBtn.title = "Afficher les stats";
            statsBtn.onclick = toggleStatsPanel;
            container.prepend(toggleBtn);
            container.prepend(statsBtn);
        }
        console.log('%c🔘 Boutons TwVodNoAdsJCed injectés', 'color:#9146FF');
        return true;
    };

    // Tentative immédiate
    tryInject();

    // Re-tente toutes les 2s jusqu'à succès (comme l'original qui fonctionnait)
    let attempts = 0;
    const pollInterval = setInterval(function() {
        attempts++;
        if (tryInject()) {
            clearInterval(pollInterval);
            console.log('[TwVodNoAdsJCed] Injection terminée après ' + attempts + ' tentative(s)');
        } else if (attempts > 150) { // 5 min max
            clearInterval(pollInterval);
            console.log('[TwVodNoAdsJCed] Échec injection après 150 tentatives — conteneur introuvable');
        }
    }, 2000);
}
