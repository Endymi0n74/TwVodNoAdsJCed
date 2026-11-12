/* globals AdSegmentCache, tnsVodsEnabled, buildVodPlaylist, processM3U8, AdSignifier,
         StreamInfos, StreamInfosByUrl, V2API, ForceAccessTokenPlayerType, parseAttributes,
         getServerTimeFromM3u8, replaceServerTimeInM3u8, AlwaysReloadPlayerOnAd,
         SkipPlayerReloadOnHevc, PlayerReloadMinimalRequestsTime,
         PlayerReloadMinimalRequestsPlayerIndex, BackupPlayerTypes, FallbackPlayerType,
         getAccessToken, gqlRequestWithRetry, postMessage, HasTriggeredPlayerReload,
         ReloadPlayerAfterAd, streamInfo, IsAdStrippingEnabled, AllSegmentsAreAdSegments,
         SimulatedAdsDepth */

/**
 * Hook du fetch à l'intérieur du Worker Twitch.
 *
 * Intercepte les requêtes m3u8, usher (VODs) et channel/hls (encodages live)
 * pour appliquer :
 * - le blocage de pubs (stripping des segments, backup player)
 * - le bypass VOD sub-only (quand usher répond 403)
 * - le dé-mute des VODs (-unmuted → -muted sur cloudfront)
 *
 * Dérivé de vaft (pixeltris/TwitchAdSolutions).
 *
 * Le hook remplace `fetch` dans le scope du worker. Les requêtes sont traitées
 * comme suit :
 *
 * 1. Segments dans AdSegmentCache → réponse vidéo vide (pub bloquée)
 * 2. usher.ttvnw.net/vod/ → si 403 et tnsVodsEnabled, buildVodPlaylist() ; sinon passthrough
 * 3. .m3u8 sur cloudfront et tnsVodsEnabled → remplace -unmuted par -muted (dé-mute)
 * 4. .m3u8 (autres) → si tnsAdsEnabled, processM3U8() (stripping pubs) ; sinon passthrough
 * 5. /channel/hls/ (hors picture-by-picture) → si tnsAdsEnabled, build des infos de stream,
 *    recherche d'un backup player sans pubs, remplacement des codecs HEVC si nécessaire
 *
 * @returns {void} Remplace window.fetch dans le scope du worker
 */
function hookWorkerFetch() {
    console.log('hookWorkerFetch (vaft)');
    const realFetch = fetch;
    fetch = async function(url, options) {
        if (typeof url === 'string') {
            if (AdSegmentCache.has(url)) {
                return new Promise(function(resolve, reject) {
                    const send = function() {
                        return realFetch('data:video/mp4;base64,AAAAKGZ0eXBtcDQyAAAAAWlzb21tcDQyZGFzaGF2YzFpc282aGxzZgAABEltb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAYagAAAAAAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAABqHRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAURtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAALuAAAAAAFXEAAAAAAAtaGRscgAAAAAAAAAAc291bgAAAAAAAAAAAAAAAFNvdW5kSGFuZGxlcgAAAADvbWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAACzc3RibAAAAGdzdHNkAAAAAAAAAAEAAABXbXA0YQAAAAAAAAABAAAAAAAAAAAAAgAQAAAAALuAAAAAAAAzZXNkcwAAAAADgICAIgABAASAgIAUQBUAAAAAAAAAAAAAAAWAgIACEZAGgICAAQIAAAAQc3R0cwAAAAAAAAAAAAAAEHN0c2MAAAAAAAAAAAAAABRzdHN6AAAAAAAAAAAAAAAAAAAAEHN0Y28AAAAAAAAAAAAAAeV0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAoAAAAFoAAAAAAGBbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAA9CQAAAAABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABLG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAOxzdGJsAAAAoHN0c2QAAAAAAAAAAQAAAJBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAoABaABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAOmF2Y0MBTUAe/+EAI2dNQB6WUoFAX/LgLUBAQFAAAD6AAA6mDgAAHoQAA9CW7y4KAQAEaOuPIAAAABBzdHRzAAAAAAAAAAAAAAAQc3RzYwAAAAAAAAAAAAAAFHN0c3oAAAAAAAAAAAAAAAAAAAAQc3RjbwAAAAAAAAAAAAAASG12ZXgAAAAgdHJleAAAAAAAAAABAAAAAQAAAC4AAAAAAoAAAAAAACB0cmV4AAAAAAAAAAIAAAABAACCNQAAAAACQAAA', options).then(function(response) {
                            resolve(response);
                        })['catch'](function(err) {
                            reject(err);
                        });
                    };
                    send();
                });
            }
            url = url.trimEnd();
            if (url.includes('usher.ttvnw.net/vod/')) {
                // VOD playlist: usher returns 403 for sub-only VODs, build a direct CDN playlist instead
                return new Promise(function(resolve, reject) {
                    const processAfter = async function(response) {
                        if (response.status === 200 || !tnsVodsEnabled) {
                            // VODs désactivées : on laisse Twitch gérer (pas de bypass)
                            resolve(response);
                        } else {
                            console.log('Usher VOD request failed (' + response.status + ') — building bypass playlist');
                            resolve(await buildVodPlaylist(url, realFetch));
                        }
                    };
                    const send = function() {
                        return realFetch(url, options).then(function(response) {
                            processAfter(response);
                        })['catch'](function(err) {
                            reject(err);
                        });
                    };
                    send();
                });
            }
            if (url.endsWith('m3u8')) {
                return new Promise(function(resolve, reject) {
                    const processAfter = async function(response) {
                        if (response.status === 200) {
                            let m3u8Text = await response.text();
                            if (url.includes('cloudfront') && tnsVodsEnabled) {
                                // TwitchNoSub trick: muted VOD segments are served under '-unmuted' names,
                                // the original-audio versions exist as '-muted' — swap to unmute VODs
                                m3u8Text = m3u8Text.replace(/-unmuted/g, '-muted');
                            }
                            // Pubs désactivées : on renvoie le m3u8 brut, sans stripping
                            resolve(new Response(tnsAdsEnabled ? await processM3U8(url, m3u8Text, realFetch) : m3u8Text));
                        } else {
                            resolve(response);
                        }
                    };
                    const send = function() {
                        return realFetch(url, options).then(function(response) {
                            processAfter(response);
                        })['catch'](function(err) {
                            reject(err);
                        });
                    };
                    send();
                });
            } else if (url.includes('/channel/hls/') && !url.includes('picture-by-picture')) {
                if (!tnsAdsEnabled) {
                    // Pubs désactivées : pas de hook, Twitch joue les pubs normalement
                    return realFetch(url, options);
                }
                V2API = url.includes('/api/v2/');
                const channelName = (new URL(url)).pathname.match(/([^\/]+)(?=\.\w+$)/)[0];
                if (ForceAccessTokenPlayerType) {
                    // parent_domains is used to determine if the player is embeded and stripping it gets rid of fake ads
                    const tempUrl = new URL(url);
                    tempUrl.searchParams.delete('parent_domains');
                    url = tempUrl.toString();
                }
                return new Promise(function(resolve, reject) {
                    const processAfter = async function(response) {
                        if (response.status == 200) {
                            const encodingsM3u8 = await response.text();
                            const serverTime = getServerTimeFromM3u8(encodingsM3u8);
                            let streamInfo = StreamInfos[channelName];
                            const cachedEncodingUrl = streamInfo != null && streamInfo.EncodingsM3U8 != null ? streamInfo.EncodingsM3U8.match(/^https:.*\.m3u8$/m) : null;
                            if (streamInfo != null && streamInfo.EncodingsM3U8 != null && (!cachedEncodingUrl || (await realFetch(cachedEncodingUrl[0])).status !== 200)) {
                                // The cached encodings are dead (the stream probably restarted)
                                streamInfo = null;
                            }
                            if (streamInfo == null || streamInfo.EncodingsM3U8 == null) {
                                StreamInfos[channelName] = streamInfo = {
                                    ChannelName: channelName,
                                    IsShowingAd: false,
                                    LastPlayerReload: 0,
                                    EncodingsM3U8: encodingsM3u8,
                                    ModifiedM3U8: null,
                                    IsUsingModifiedM3U8: false,
                                    UsherParams: (new URL(url)).search,
                                    RequestedAds: new Set(),
                                    Urls: [],// xxx.m3u8 -> { Resolution: "284x160", FrameRate: 30.0 }
                                    ResolutionList: [],
                                    BackupEncodingsM3U8Cache: [],
                                    ActiveBackupPlayerType: null,
                                    IsMidroll: false,
                                    IsStrippingAdSegments: false,
                                    NumStrippedAdSegments: 0
                                };
                                const lines = encodingsM3u8.replaceAll('\r', '').split('\n');
                                for (let i = 0; i < lines.length - 1; i++) {
                                    if (lines[i].startsWith('#EXT-X-STREAM-INF') && lines[i + 1].includes('.m3u8')) {
                                        const attributes = parseAttributes(lines[i]);
                                        const resolution = attributes['RESOLUTION'];
                                        if (resolution) {
                                            const resolutionInfo = {
                                                Resolution: resolution,
                                                FrameRate: attributes['FRAME-RATE'],
                                                Codecs: attributes['CODECS'],
                                                Url: lines[i + 1]
                                            };
                                            streamInfo.Urls[lines[i + 1]] = resolutionInfo;
                                            streamInfo.ResolutionList.push(resolutionInfo);
                                        }
                                        StreamInfosByUrl[lines[i + 1]] = streamInfo;
                                    }
                                }
                                const nonHevcResolutionList = streamInfo.ResolutionList.filter((element) => element.Codecs.startsWith('avc') || element.Codecs.startsWith('av0'));
                                if (AlwaysReloadPlayerOnAd || (nonHevcResolutionList.length > 0 && streamInfo.ResolutionList.some((element) => element.Codecs.startsWith('hev') || element.Codecs.startsWith('hvc')) && !SkipPlayerReloadOnHevc)) {
                                    if (nonHevcResolutionList.length > 0) {
                                        for (let i = 0; i < lines.length - 1; i++) {
                                            if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
                                                const resSettings = parseAttributes(lines[i].substring(lines[i].indexOf(':') + 1));
                                                const codecsKey = 'CODECS';
                                                if (resSettings[codecsKey].startsWith('hev') || resSettings[codecsKey].startsWith('hvc')) {
                                                    const oldResolution = resSettings['RESOLUTION'];
                                                    const [targetWidth, targetHeight] = oldResolution.split('x').map(Number);
                                                    const newResolutionInfo = nonHevcResolutionList.sort((a, b) => {
                                                        // TODO: Take into account 'Frame-Rate' when sorting (i.e. 1080p60 vs 1080p30)
                                                        const [streamWidthA, streamHeightA] = a.Resolution.split('x').map(Number);
                                                        const [streamWidthB, streamHeightB] = b.Resolution.split('x').map(Number);
                                                        return Math.abs((streamWidthA * streamHeightA) - (targetWidth * targetHeight)) - Math.abs((streamWidthB * streamHeightB) - (targetWidth * targetHeight));
                                                    })[0];
                                                    console.log('ModifiedM3U8 swap ' + resSettings[codecsKey] + ' to ' + newResolutionInfo.Codecs + ' oldRes:' + oldResolution + ' newRes:' + newResolutionInfo.Resolution);
                                                    lines[i] = lines[i].replace(/CODECS="[^"]+"/, `CODECS="${newResolutionInfo.Codecs}"`);
                                                    lines[i + 1] = newResolutionInfo.Url + ' '.repeat(i + 1);// The stream doesn't load unless each url line is unique
                                                }
                                            }
                                        }
                                    }
                                    if (nonHevcResolutionList.length > 0 || AlwaysReloadPlayerOnAd) {
                                        streamInfo.ModifiedM3U8 = lines.join('\n');
                                    }
                                }
                            }
                            streamInfo.LastPlayerReload = Date.now();
                            resolve(new Response(replaceServerTimeInM3u8(streamInfo.IsUsingModifiedM3U8 ? streamInfo.ModifiedM3U8 : streamInfo.EncodingsM3U8, serverTime)));
                        } else {
                            resolve(response);
                        }
                    };
                    const send = function() {
                        return realFetch(url, options).then(function(response) {
                            processAfter(response);
                        })['catch'](function(err) {
                            reject(err);
                        });
                    };
                    send();
                });
            }
        }
        return realFetch.apply(this, arguments);
    };
}
