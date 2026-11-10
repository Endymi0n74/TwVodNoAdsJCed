/**
 * Crée un Serving-ID aléatoire de 32 caractères alphanumériques.
 *
 * Utilisé pour simuler l'en-tête #EXT-X-TWITCH-INFO des playlists VOD.
 *
 * @returns {string} Serving-ID de 32 caractères
 */
function createServingID() {
    const w = '0123456789abcdefghijklmnopqrstuvwxyz'.split('');
    let id = '';
    for (let i = 0; i < 32; i++) {
        id += w[Math.floor(Math.random() * w.length)];
    }
    return id;
}

/**
 * Vérifie qu'une qualité de playlist VOD est valide sur le CDN et détecte le codec.
 *
 * Récupère le playlist, puis s'il contient des segments .ts → codec avc1.
 * S'il contient des segments .mp4 → récupère init-0.mp4 pour détecter hev1 ou avc1.
 *
 * @param {string} playlistUrl - URL du playlist qualité sur le CDN
 * @param {Function} realFetch - Fonction fetch du contexte worker
 * @returns {Promise<{codec: string}|null>} Objet { codec } si valide, null sinon
 */
function isValidQuality(playlistUrl, realFetch) {
    return realFetch(playlistUrl, { cache: 'force-cache' }).then(function(response) {
        if (!response.ok) { return null; }
        return response.text().then(function(data) {
            if (data.includes('.ts')) {
                return { codec: 'avc1.4D001E' };
            }
            if (data.includes('.mp4')) {
                return realFetch(playlistUrl.replace('index-dvr.m3u8', 'init-0.mp4'), { cache: 'force-cache' }).then(function(mp4Request) {
                    if (mp4Request.ok) {
                        return mp4Request.text().then(function(content) {
                            return { codec: content.includes('hev1') ? 'hev1.1.6.L93.B0' : 'avc1.4D001E' };
                        });
                    }
                    return { codec: 'hev1.1.6.L93.B0' };
                });
            }
            return null;
        });
    });
}

/**
 * Bypass usher 403 pour les VODs sub-only.
 *
 * Quand usher.ttvnw.net/vod/ répond 403 (VOD réservée aux abonnés),
 * construit un playlist CDN direct à partir des métadonnées GQL
 * (seekPreviewsURL révèle le chemin CDN). Méthode basée sur TwitchNoSub.
 *
 * Gère les trois types de broadcast :
 * - highlight : `{domain}/{vodSpecialID}/{quality}/highlight-{vodId}.m3u8`
 * - upload (>7j) : `{domain}/{owner}/{vodId}/{vodSpecialID}/{quality}/index-dvr.m3u8`
 * - standard : `{domain}/{vodSpecialID}/{quality}/index-dvr.m3u8`
 *
 * @param {string} url - URL usher du VOD (ex: usher.ttvnw.net/vod/{id}.m3u8)
 * @param {Function} realFetch - Fonction fetch du contexte worker
 * @returns {Promise<Response>} Playlist m3u8 généré (status 200) ou erreur (status 403)
 *
 * @example
 * const resp = await buildVodPlaylist('https://usher.ttvnw.net/vod/123456789.m3u8', fetch);
 * // status 200 avec un playlist #EXTM3U contenant les variantes de qualité
 */
function buildVodPlaylist(url, realFetch) {
    return (async function() {
        const vodId = (new URL(url)).pathname.split('/').pop().replace(/\.m3u8.*$/, '');
        const isUsherV2 = url.includes('/vod/v2');
        console.log('Building bypass playlist for VOD ' + vodId);
        let gqlData;
        try {
            const gqlResp = await gqlRequestWithRetry({
                query: 'query { video(id: "' + vodId + '") { broadcastType, createdAt, seekPreviewsURL, owner { login } } }'
            }, 'site');
            gqlData = await gqlResp.json();
        } catch (err) {
            console.log('VOD bypass: GQL failed after retries: ' + err.message);
            return new Response('VOD bypass: GQL failed', { status: 403 });
        }
        const vodData = gqlData && gqlData.data && gqlData.data.video;
        if (!vodData || !vodData.seekPreviewsURL) {
            console.log('VOD bypass: missing metadata for ' + vodId);
            return new Response('Missing VOD metadata', { status: 403 });
        }
        const seekUrl = new URL(vodData.seekPreviewsURL);
        const domain = seekUrl.host;
        const paths = seekUrl.pathname.split('/');
        const vodSpecialID = paths[paths.findIndex(function(p) { return p.includes('storyboards'); }) - 1];
        const broadcastType = vodData.broadcastType.toLowerCase();
        const created = new Date(vodData.createdAt);
        const daysSince = (new Date('2023-02-10').getTime() - created.getTime()) / (1000 * 3600 * 24);
        const defaultResolutions = {
            '160p30': { name: '160p', resolution: '284x160', frameRate: 30 },
            '360p30': { name: '360p', resolution: '640x360', frameRate: 30 },
            '480p30': { name: '480p', resolution: '854x480', frameRate: 30 },
            '720p60': { name: '720p60', resolution: '1280x720', frameRate: 60 },
            '1080p60': { name: '1080p60', resolution: '1920x1080', frameRate: 60 },
            '1440p60': { name: '1440p60', resolution: '2560x1440', frameRate: 60 },
            'chunked': { name: 'chunked', resolution: 'chunked', frameRate: 60 }
        };
        let fakePlaylist = '#EXTM3U\n#EXT-X-TWITCH-INFO:ORIGIN="s3",B="false",REGION="EU",USER-IP="127.0.0.1",SERVING-ID="' + createServingID() + '",CLUSTER="cloudfront_vod",USER-COUNTRY="BE",MANIFEST-CLUSTER="cloudfront_vod"';
        let bitrate = 8534030;
        const resKeys = ['chunked', '1440p60', '1080p60', '720p60', '480p30', '360p30', '160p30'];
        for (let i = 0; i < resKeys.length; i++) {
            const resKey = resKeys[i];
            let playlistUrl;
            if (broadcastType === 'highlight') {
                playlistUrl = 'https://' + domain + '/' + vodSpecialID + '/' + resKey + '/highlight-' + vodId + '.m3u8';
            } else if (broadcastType === 'upload' && daysSince > 7) {
                playlistUrl = 'https://' + domain + '/' + vodData.owner.login + '/' + vodId + '/' + vodSpecialID + '/' + resKey + '/index-dvr.m3u8';
            } else {
                playlistUrl = 'https://' + domain + '/' + vodSpecialID + '/' + resKey + '/index-dvr.m3u8';
            }
            const quality = await isValidQuality(playlistUrl, realFetch);
            if (quality) {
                const resValue = defaultResolutions[resKey];
                if (isUsherV2) {
                    const variantSource = resKey == 'chunked' ? 'source' : 'transcode';
                    fakePlaylist += '\n#EXT-X-STREAM-INF:BANDWIDTH=' + bitrate + ',CODECS="' + quality.codec + ',mp4a.40.2",RESOLUTION=' + resValue.resolution + ',FRAME-RATE=' + resValue.frameRate + ',STABLE-VARIANT-ID="' + resKey + '",IVS-NAME="' + resValue.name + '",IVS-VARIANT-SOURCE="' + variantSource + '"\n' + playlistUrl;
                } else {
                    const enabled = resKey == 'chunked' ? 'YES' : 'NO';
                    fakePlaylist += '\n#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="' + resKey + '",NAME="' + resKey + '",AUTOSELECT=' + enabled + ',DEFAULT=' + enabled + '\n#EXT-X-STREAM-INF:BANDWIDTH=' + bitrate + ',CODECS="' + quality.codec + ',mp4a.40.2",RESOLUTION=' + resValue.resolution + ',VIDEO="' + resValue.name + '",FRAME-RATE=' + resValue.frameRate + '\n' + playlistUrl;
                }
                bitrate -= 100;
            }
        }
        if (!fakePlaylist.includes('#EXT-X-STREAM-INF')) {
            console.log('VOD bypass: no valid quality found for ' + vodId);
            return new Response('No valid quality found', { status: 403 });
        }
        console.log('VOD bypass: serving generated playlist for ' + vodId);
        postMessage({ key: 'VodBypassed', vodId: vodId });
        return new Response(fakePlaylist, { status: 200, headers: { 'Content-Type': 'application/vnd.apple.mpegurl' } });
    })();
}
