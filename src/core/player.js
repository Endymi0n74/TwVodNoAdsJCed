/* globals document, console, Date, localStorage, localStorageHookFailed,
         tnsAdsEnabled, PlayerBufferingFix, PlayerBufferingDelay,
         PlayerBufferingSameStateCount, PlayerBufferingMinRepeatDelay,
         PlayerBufferingDangerZone, PlayerBufferingDoPlayerReload,
         PlayerBufferingPrerollCheckEnabled, PlayerBufferingPrerollCheckOffset,
         updateAdblockBanner, postTwitchWorkerMessage, playerBufferState,
         monitorPlayerBuffering, isActivelyStrippingAds, doTwitchPlayerTask,
         playerForMonitoringBuffering */

/**
 * Récupère l'instance du player Twitch et son état React en parcourant l'arbre React.
 *
 * ⚠️ Cette fonction accède à des propriétés internes de React
 * (`_reactRootContainer._internalRoot.current`, `__reactContainer`) qui
 * peuvent changer à toute mise à jour de Twitch.
 *
 * @returns {{player: Object, state: Object}|null} Le player et son état, ou null
 */
function getPlayerAndState() {
    function findReactNode(root, constraint) {
        if (root.stateNode && constraint(root.stateNode)) {
            return root.stateNode;
        }
        let node = root.child;
        while (node) {
            const result = findReactNode(node, constraint);
            if (result) {
                return result;
            }
            node = node.sibling;
        }
        return null;
    }
    function findReactRootNode() {
        let reactRootNode = null;
        const rootNode = document.querySelector('#root');
        if (rootNode && rootNode._reactRootContainer && rootNode._reactRootContainer._internalRoot && rootNode._reactRootContainer._internalRoot.current) {
            reactRootNode = rootNode._reactRootContainer._internalRoot.current;
        }
        if (reactRootNode == null && rootNode != null) {
            const containerName = Object.keys(rootNode).find(x => x.startsWith('__reactContainer'));
            if (containerName != null) {
                reactRootNode = rootNode[containerName];
            }
        }
        return reactRootNode;
    }
    const reactRootNode = findReactRootNode();
    if (!reactRootNode) {
        return null;
    }
    let player = findReactNode(reactRootNode, node => node.setPlayerActive && node.props && node.props.mediaPlayerInstance);
    player = player && player.props && player.props.mediaPlayerInstance ? player.props.mediaPlayerInstance : null;
    if (player?.playerInstance) {
        player = player.playerInstance;
    }
    const playerState = findReactNode(reactRootNode, node => node.setSrc && node.setInitialPlaybackSettings);
    return {
        player: player,
        state: playerState
    };
}

/**
 * Effectue une action sur le player Twitch (pause/play ou reload).
 *
 * Préserve la qualité, le mute et le volume dans localStorage pendant le reload
 * (utilisé quand le hook localStorage a échoué, ex. Firefox).
 *
 * @param {boolean} isPausePlay - Si true, fait pause puis play
 * @param {boolean} isReload - Si true, recharge le player (setSrc)
 * @returns {boolean} true si l'action a été effectuée, false sinon
 */
function doTwitchPlayerTask(isPausePlay, isReload) {
    const playerAndState = getPlayerAndState();
    if (!playerAndState) {
        console.log('Could not find react root');
        return false;
    }
    const player = playerAndState.player;
    const playerState = playerAndState.state;
    if (!player) {
        console.log('Could not find player');
        return false;
    }
    if (!playerState) {
        console.log('Could not find player state');
        return false;
    }
    if (player.isPaused() || player.core?.paused) {
        return false;
    }
    playerBufferState.lastFixTime = Date.now();
    playerBufferState.numSame = 0;
    if (isPausePlay) {
        player.pause();
        player.play();
        return true;
    }
    if (isReload) {
        const lsKeyQuality = 'video-quality';
        const lsKeyMuted = 'video-muted';
        const lsKeyVolume = 'volume';
        let currentQualityLS = null;
        let currentMutedLS = null;
        let currentVolumeLS = null;
        try {
            currentQualityLS = localStorage.getItem(lsKeyQuality);
            currentMutedLS = localStorage.getItem(lsKeyMuted);
            currentVolumeLS = localStorage.getItem(lsKeyVolume);
            if (localStorageHookFailed && player?.core?.state) {
                localStorage.setItem(lsKeyMuted, JSON.stringify({default:player.core.state.muted}));
                localStorage.setItem(lsKeyVolume, player.core.state.volume);
            }
            if (localStorageHookFailed && player?.core?.state?.quality?.group) {
                localStorage.setItem(lsKeyQuality, JSON.stringify({default:player.core.state.quality.group}));
            }
        } catch {}
        console.log('Reloading Twitch player');
        playerState.setSrc({ isNewMediaPlayerInstance: true, refreshAccessToken: true });
        postTwitchWorkerMessage('TriggeredPlayerReload');
        player.play();
        if (localStorageHookFailed && (currentQualityLS || currentMutedLS || currentVolumeLS)) {
            setTimeout(() => {
                try {
                    if (currentQualityLS) {
                        localStorage.setItem(lsKeyQuality, currentQualityLS);
                    }
                    if (currentMutedLS) {
                        localStorage.setItem(lsKeyMuted, currentMutedLS);
                    }
                    if (currentVolumeLS) {
                        localStorage.setItem(lsKeyVolume, currentVolumeLS);
                    }
                } catch {}
            }, 3000);
        }
        return true;
    }
}

window.reloadTwitchPlayer = () => {
    doTwitchPlayerTask(false, true);
};

/**
 * Boucle de surveillance du buffering du player.
 *
 * Détecte quand le player est coincé (position et buffer qui n'évoluent plus)
 * et déclenche pause/play ou reload du player. La boucle s'arrête quand
 * tnsAdsEnabled est false et est relancée par applyFeatureFlag.
 *
 * @returns {void}
 */
function monitorPlayerBuffering() {
    if (!tnsAdsEnabled) { return; }
    if (playerForMonitoringBuffering) {
        try {
            const player = playerForMonitoringBuffering.player;
            const state = playerForMonitoringBuffering.state;
            if (!player.core) {
                playerForMonitoringBuffering = null;
            } else if (state.props?.content?.type === 'live' && !player.isPaused() && !player.getHTMLVideoElement()?.ended && playerBufferState.lastFixTime <= Date.now() - PlayerBufferingMinRepeatDelay && !isActivelyStrippingAds) {
                const m3u8Url = player.core?.state?.path;
                if (m3u8Url) {
                    const fileName = new URL(m3u8Url).pathname.split('/').pop();
                    if (fileName?.endsWith('.m3u8')) {
                        const channelName = fileName.slice(0, -5);
                        if (playerBufferState.channelName != channelName) {
                            playerBufferState.channelName = channelName;
                            playerBufferState.hasStreamStarted = false;
                            playerBufferState.numSame = 0;
                        }
                    }
                }
                if (player.getState() === 'Playing') {
                    playerBufferState.hasStreamStarted = true;
                }
                const position = player.core?.state?.position;
                const bufferedPosition = player.core?.state?.bufferedPosition;
                const bufferDuration = player.getBufferDuration();
                if (position !== undefined && bufferedPosition !== undefined) {
                    if (playerBufferState.hasStreamStarted &&
                        (!PlayerBufferingPrerollCheckEnabled || position > PlayerBufferingPrerollCheckOffset) &&
                        (playerBufferState.position == position || bufferDuration < PlayerBufferingDangerZone) &&
                        playerBufferState.bufferedPosition == bufferedPosition &&
                        playerBufferState.bufferDuration >= bufferDuration &&
                        (position != 0 || bufferedPosition != 0 || bufferDuration != 0)
                    ) {
                        playerBufferState.numSame++;
                        if (playerBufferState.numSame == PlayerBufferingSameStateCount) {
                            console.log('Attempt to fix buffering position:' + playerBufferState.position + ' bufferedPosition:' + playerBufferState.bufferedPosition + ' bufferDuration:' + playerBufferState.bufferDuration);
                            const isPausePlay = !PlayerBufferingDoPlayerReload;
                            const isReload = PlayerBufferingDoPlayerReload;
                            doTwitchPlayerTask(isPausePlay, isReload);
                            playerBufferState.lastFixTime = Date.now();
                            playerBufferState.numSame = 0;
                        }
                    } else {
                        playerBufferState.numSame = 0;
                    }
                    playerBufferState.position = position;
                    playerBufferState.bufferedPosition = bufferedPosition;
                    playerBufferState.bufferDuration = bufferDuration;
                } else {
                    playerBufferState.numSame = 0;
                }
            }
        } catch (err) {
            console.error('error when monitoring player for buffering: ' + err);
            playerForMonitoringBuffering = null;
        }
    }
    if (!playerForMonitoringBuffering) {
        const playerAndState = getPlayerAndState();
        if (playerAndState && playerAndState.player && playerAndState.state) {
            playerForMonitoringBuffering = {
                player: playerAndState.player,
                state: playerAndState.state
            };
        }
    }
    const isLive = playerForMonitoringBuffering?.state?.props?.content?.type === 'live';
    if (playerBufferState.isLive && !isLive) {
        updateAdblockBanner({
            hasAds: false
        });
    }
    playerBufferState.isLive = isLive;
    setTimeout(monitorPlayerBuffering, PlayerBufferingDelay);
}
