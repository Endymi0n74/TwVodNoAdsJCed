/* globals StreamInfosByUrl, streamInfo, HasTriggeredPlayerReload, postMessage,
         SimulatedAdsDepth, IsAdStrippingEnabled, SkipPlayerReloadOnHevc,
         AlwaysReloadPlayerOnAd, AdSignifier, PlayerReloadMinimalRequestsTime,
         PlayerReloadMinimalRequestsPlayerIndex, BackupPlayerTypes, FallbackPlayerType,
         ForceAccessTokenPlayerType, V2API, getAccessToken, realFetch, gqlRequestWithRetry,
         parseAttributes, getServerTimeFromM3u8, replaceServerTimeInM3u8, AdSegmentCache,
         AllSegmentsAreAdSegments */

/**
 * Supprime les segments publicitaires d'un playlist m3u8.
 *
 * ⚠️ Cette fonction ne retire pas physiquement les lignes de segments du texte
 * retourné. Elle ajoute les URLs des segments pubs à AdSegmentCache et incrémente
 * le compteur. La suppression effective est faite par le hook fetch (qui retourne
 * une réponse vidéo vide pour les URLs en cache).
 *
 * @param {string} textStr - Contenu du playlist m3u8
 * @param {boolean} stripAllSegments - Si true, tous les segments sont considérés comme pubs
 * @param {Object} streamInfo - Informations du stream (compteurs, flags)
 * @returns {string} Le playlist m3u8 (lignes PREFETCH vidées si des pubs détectées)
 */
function stripAdSegments(textStr, stripAllSegments, streamInfo) {
    let hasStrippedAdSegments = false;
    const lines = textStr.replaceAll('\r', '').split('\n');
    const newAdUrl = 'https://twitch.tv';
    for (let i = 0; i < lines.length; i++) {
        let line = lines[i];
        line = line
            .replaceAll(/(X-TV-TWITCH-AD-URL=")(?:[^"]*)(")/g, `$1${newAdUrl}$2`)
            .replaceAll(/(X-TV-TWITCH-AD-CLICK-TRACKING-URL=")(?:[^"]*)(")/g, `$1${newAdUrl}$2`);
        if (
            i < lines.length - 1 &&
            line.startsWith('#EXTINF') &&
            (!line.includes(',live') || stripAllSegments || AllSegmentsAreAdSegments)
        ) {
            const segmentUrl = lines[i + 1];
            if (!AdSegmentCache.has(segmentUrl)) {
                streamInfo.NumStrippedAdSegments++;
            }
            AdSegmentCache.set(segmentUrl, Date.now());
            hasStrippedAdSegments = true;
        }
        if (line.includes(AdSignifier)) {
            hasStrippedAdSegments = true;
        }
    }
    if (hasStrippedAdSegments) {
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith('#EXT-X-TWITCH-PREFETCH:')) {
                lines[i] = '';
            }
        }
    } else {
        streamInfo.NumStrippedAdSegments = 0;
    }
    streamInfo.IsStrippingAdSegments = hasStrippedAdSegments;
    AdSegmentCache.forEach((value, key, map) => {
        if (value < Date.now() - 120000) {
            map.delete(key);
        }
    });
    return lines.join('\n');
}

/**
 * Trouve l'URL du stream pour une résolution donnée dans un playlist d'encodages.
 *
 * @param {string} encodingsM3u8 - Contenu du playlist d'encodages m3u8
 * @param {Object} resolutionInfo - { Resolution, FrameRate, Codecs, Url }
 * @returns {string|null} URL du stream correspondant, ou null
 */
function getStreamUrlForResolution(encodingsM3u8, resolutionInfo) {
    const encodingsLines = encodingsM3u8.replaceAll('\r', '').split('\n');
    const [targetWidth, targetHeight] = resolutionInfo.Resolution.split('x').map(Number);
    let matchedResolutionUrl = null;
    let matchedFrameRate = false;
    let closestResolutionUrl = null;
    let closestResolutionDifference = Infinity;
    for (let i = 0; i < encodingsLines.length - 1; i++) {
        if (encodingsLines[i].startsWith('#EXT-X-STREAM-INF') && encodingsLines[i + 1].includes('.m3u8')) {
            const attributes = parseAttributes(encodingsLines[i]);
            const resolution = attributes['RESOLUTION'];
            const frameRate = attributes['FRAME-RATE'];
            if (resolution) {
                if (
                    resolution == resolutionInfo.Resolution &&
                    (!matchedResolutionUrl || (!matchedFrameRate && frameRate == resolutionInfo.FrameRate))
                ) {
                    matchedResolutionUrl = encodingsLines[i + 1];
                    matchedFrameRate = frameRate == resolutionInfo.FrameRate;
                    if (matchedFrameRate) {
                        return matchedResolutionUrl;
                    }
                }
                const [width, height] = resolution.split('x').map(Number);
                const difference = Math.abs(width * height - targetWidth * targetHeight);
                if (difference < closestResolutionDifference) {
                    closestResolutionUrl = encodingsLines[i + 1];
                    closestResolutionDifference = difference;
                }
            }
        }
    }
    return closestResolutionUrl;
}

/**
 * Traite un playlist m3u8 : détection des pubs, switching vers un backup player,
 * stripping des segments publicitaires.
 *
 * Appelé par hookWorkerFetch pour chaque requête .m3u8 quand tnsAdsEnabled est true.
 *
 * @param {string} url - URL du m3u8
 * @param {string} textStr - Contenu du m3u8
 * @param {Function} realFetch - Fonction fetch du contexte worker
 * @returns {Promise<string>} Le m3u8 traité (backup player ou stripping appliqué)
 */
async function processM3U8(url, textStr, realFetch) {
    let streamInfo = StreamInfosByUrl[url];
    if (!streamInfo) {
        // Midroll / playlist inconnue (URL pas encore enregistrée via /channel/hls/) :
        // on crée un contexte minimal pour permettre le stripping des segments pubs
        // même sans infos de résolution. L'objet n'est pas stocké (les tokens midroll
        // changent souvent) mais le stripping s'applique via AdSegmentCache partagé.
        streamInfo = {
            ChannelName: '',
            IsShowingAd: false,
            LastPlayerReload: 0,
            EncodingsM3U8: null,
            ModifiedM3U8: null,
            IsUsingModifiedM3U8: false,
            UsherParams: '',
            RequestedAds: new Set(),
            Urls: {},
            ResolutionList: [],
            BackupEncodingsM3U8Cache: {},
            ActiveBackupPlayerType: null,
            IsMidroll: false,
            IsStrippingAdSegments: false,
            NumStrippedAdSegments: 0,
            IsTemporary: true
        };
        // Persiste l'état pour ne pas re-poster « pub bloquée » à chaque refresh du playlist
        StreamInfosByUrl[url] = streamInfo;
    }
    if (HasTriggeredPlayerReload) {
        HasTriggeredPlayerReload = false;
        streamInfo.LastPlayerReload = Date.now();
    }
    const haveAdTags = textStr.includes(AdSignifier) || SimulatedAdsDepth > 0;
    if (haveAdTags) {
        streamInfo.IsMidroll = textStr.includes('"MIDROLL"') || textStr.includes('"midroll"');
        if (!streamInfo.IsShowingAd) {
            streamInfo.IsShowingAd = true;
            postMessage({
                key: 'UpdateAdBlockBanner',
                isMidroll: streamInfo.IsMidroll,
                hasAds: streamInfo.IsShowingAd,
                isStrippingAdSegments: false
            });
        }
        if (!streamInfo.IsMidroll) {
            const lines = textStr.replaceAll('\r', '').split('\n');
            for (let i = 0; i < lines.length; i++) {
                const line = lines[i];
                if (line.startsWith('#EXTINF') && lines.length > i + 1) {
                    if (!line.includes(',live') && !streamInfo.RequestedAds.has(lines[i + 1])) {
                        streamInfo.RequestedAds.add(lines[i + 1]);
                        fetch(lines[i + 1]).then((response) => {
                            response.blob();
                        });
                        break;
                    }
                }
            }
        }
        const currentResolution = streamInfo.Urls[url];
        let isHevc = false;
        if (currentResolution) {
            isHevc = currentResolution.Codecs.startsWith('hev') || currentResolution.Codecs.startsWith('hvc');
            if (
                ((isHevc && !SkipPlayerReloadOnHevc) || AlwaysReloadPlayerOnAd) &&
                streamInfo.ModifiedM3U8 &&
                !streamInfo.IsUsingModifiedM3U8
            ) {
                streamInfo.IsUsingModifiedM3U8 = true;
                streamInfo.LastPlayerReload = Date.now();
                postMessage({
                    key: 'ReloadPlayer'
                });
            }
            let backupPlayerType = null;
            let backupM3u8 = null;
            let fallbackM3u8 = null;
            let startIndex = 0;
            let isDoingMinimalRequests = false;
            if (streamInfo.LastPlayerReload > Date.now() - PlayerReloadMinimalRequestsTime) {
                startIndex = PlayerReloadMinimalRequestsPlayerIndex;
                isDoingMinimalRequests = true;
            }
            for (
                let playerTypeIndex = startIndex;
                !backupM3u8 && playerTypeIndex < BackupPlayerTypes.length;
                playerTypeIndex++
            ) {
                const playerType = BackupPlayerTypes[playerTypeIndex];
                const realPlayerType = playerType.replace('-CACHED', '');
                const isFullyCachedPlayerType = playerType != realPlayerType;
                for (let i = 0; i < 2; i++) {
                    let isFreshM3u8 = false;
                    let encodingsM3u8 = streamInfo.BackupEncodingsM3U8Cache[playerType];
                    if (!encodingsM3u8) {
                        isFreshM3u8 = true;
                        try {
                            const accessTokenResponse = await getAccessToken(streamInfo.ChannelName, realPlayerType);
                            if (accessTokenResponse.status === 200) {
                                const accessToken = await accessTokenResponse.json();
                                const urlInfo = new URL(
                                    'https://usher.ttvnw.net/api/' +
                                        (V2API ? 'v2/' : '') +
                                        'channel/hls/' +
                                        streamInfo.ChannelName +
                                        '.m3u8' +
                                        streamInfo.UsherParams
                                );
                                urlInfo.searchParams.set('sig', accessToken.data.streamPlaybackAccessToken.signature);
                                urlInfo.searchParams.set('token', accessToken.data.streamPlaybackAccessToken.value);
                                const encodingsM3u8Response = await realFetch(urlInfo.href);
                                if (encodingsM3u8Response.status === 200) {
                                    encodingsM3u8 = streamInfo.BackupEncodingsM3U8Cache[playerType] =
                                        await encodingsM3u8Response.text();
                                }
                            }
                        } catch (err) {}
                    }
                    if (encodingsM3u8) {
                        try {
                            const streamM3u8Url = getStreamUrlForResolution(encodingsM3u8, currentResolution);
                            const streamM3u8Response = await realFetch(streamM3u8Url);
                            if (streamM3u8Response.status == 200) {
                                const m3u8Text = await streamM3u8Response.text();
                                if (m3u8Text) {
                                    if (playerType == FallbackPlayerType) {
                                        fallbackM3u8 = m3u8Text;
                                    }
                                    if (
                                        (!m3u8Text.includes(AdSignifier) &&
                                            (SimulatedAdsDepth == 0 || playerTypeIndex >= SimulatedAdsDepth - 1)) ||
                                        (!fallbackM3u8 && playerTypeIndex >= BackupPlayerTypes.length - 1)
                                    ) {
                                        backupPlayerType = playerType;
                                        backupM3u8 = m3u8Text;
                                        break;
                                    }
                                    if (isFullyCachedPlayerType) {
                                        break;
                                    }
                                    if (isDoingMinimalRequests) {
                                        backupPlayerType = playerType;
                                        backupM3u8 = m3u8Text;
                                        break;
                                    }
                                }
                            }
                        } catch (err) {}
                    }
                    streamInfo.BackupEncodingsM3U8Cache[playerType] = null;
                    if (isFreshM3u8) {
                        break;
                    }
                }
            }
            if (!backupM3u8 && fallbackM3u8) {
                backupPlayerType = FallbackPlayerType;
                backupM3u8 = fallbackM3u8;
            }
            if (backupM3u8) {
                textStr = backupM3u8;
                if (streamInfo.ActiveBackupPlayerType != backupPlayerType) {
                    streamInfo.ActiveBackupPlayerType = backupPlayerType;
                    console.log(`Blocking${streamInfo.IsMidroll ? ' midroll ' : ' '}ads (${backupPlayerType})`);
                }
            }
        } else {
            console.log('Ads may leak due to missing resolution info for ' + url);
        }
        const stripHevc = isHevc && streamInfo.ModifiedM3U8;
        if (IsAdStrippingEnabled || stripHevc) {
            textStr = stripAdSegments(textStr, stripHevc, streamInfo);
        }
    } else if (streamInfo.IsShowingAd) {
        console.log('Finished blocking ads');
        streamInfo.IsShowingAd = false;
        streamInfo.IsStrippingAdSegments = false;
        streamInfo.NumStrippedAdSegments = 0;
        streamInfo.ActiveBackupPlayerType = null;
        if (streamInfo.IsUsingModifiedM3U8 || ReloadPlayerAfterAd) {
            streamInfo.IsUsingModifiedM3U8 = false;
            streamInfo.LastPlayerReload = Date.now();
            postMessage({
                key: 'ReloadPlayer'
            });
        } else {
            postMessage({
                key: 'PauseResumePlayer'
            });
        }
    }
    postMessage({
        key: 'UpdateAdBlockBanner',
        isMidroll: streamInfo.IsMidroll,
        hasAds: streamInfo.IsShowingAd,
        isStrippingAdSegments: streamInfo.IsStrippingAdSegments,
        numStrippedAdSegments: streamInfo.NumStrippedAdSegments
    });
    // Fin de pub sur un streamInfo temporaire : libère l'entrée (l'URL midroll ne resservira pas)
    if (streamInfo.IsTemporary && !streamInfo.IsShowingAd) {
        delete StreamInfosByUrl[url];
    }
    return textStr;
}
