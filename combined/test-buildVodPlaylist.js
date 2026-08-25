#!/usr/bin/env node
'use strict';

/**
 * Harness de test Node pour buildVodPlaylist (bypass des VODs sub-only).
 *
 * Les fonctions sont extraites de twitch-combined.user.js au runtime (même
 * mécanisme que le blob Worker : fn.toString()), puis exécutées dans un sandbox
 * avec fetch / GQL / postMessage mockés. Le round-trip GQL (gqlRequest →
 * postMessage → page → réponse) est simulé côté test.
 *
 * Couverture :
 *   - 3 branches : highlight / upload (>7j) / standard (archive)
 *   - usher v1 et v2 (formats de playlist différents)
 *   - multi-qualités (décrément de BANDWIDTH, AUTOSELECT, variants IVS)
 *   - cas limites : métadonnées manquantes, aucune qualité valide → 403
 *   - retry GQL (1er appel réseau KO → gqlRequestWithRetry rejoue)
 *   - message VodBypassed avec le vodId
 *
 * Usage : node combined/test-buildVodPlaylist.js
 */

const fs = require('fs');
const path = require('path');

if (typeof Response === 'undefined') {
    // Polyfill minimal (Node < 18) — les Node modernes ont Response global.
    globalThis.Response = class {
        constructor(body, init = {}) {
            this._body = body;
            this.status = init.status || 200;
            this.ok = this.status >= 200 && this.status < 300;
        }
        async text() { return String(this._body); }
        async json() { return JSON.parse(this._body); }
    };
}

const SCRIPT_PATH = path.join(__dirname, 'twitch-combined.user.js');
const SCRIPT_SRC = fs.readFileSync(SCRIPT_PATH, 'utf8');

const FUNCTION_NAMES = [
    'createServingID',
    'isValidQuality',
    'gqlRequest',
    'gqlRequestWithRetry',
    'buildVodPlaylist'
];

// Extraire une fonction par son nom (accolades appariées).
function extractFunction(src, name) {
    const start = src.indexOf('function ' + name + '(');
    if (start === -1) throw new Error('function ' + name + ' introuvable dans le script');
    let depth = 0;
    let i = src.indexOf('{', start);
    for (; i < src.length; i++) {
        if (src[i] === '{') depth++;
        else if (src[i] === '}') {
            depth--;
            if (depth === 0) break;
        }
    }
    return src.slice(start, i + 1);
}

// ─── Assertions ───
let passed = 0;
let failed = 0;
function assert(cond, msg) {
    if (cond) { passed++; console.log('   ✔ ' + msg); }
    else { failed++; console.error('   ✘ ' + msg); }
}

// ─── Constantes de test ───
const DOMAIN = 'd2nvs319pecx5r.cloudfront.net';
const VOD_SPECIAL_ID = '1409221430';
const VOD_ID = '123456789';
const SEEK_URL = 'https://' + DOMAIN + '/' + VOD_SPECIAL_ID + '/storyboards/' + VOD_SPECIAL_ID + '-1280x720.jpg';
const V1_URL = 'https://usher.ttvnw.net/vod/' + VOD_ID + '.m3u8';
const V2_URL = 'https://usher.ttvnw.net/vod/v2/' + VOD_ID + '.m3u8';

function gqlVideo({ broadcastType, createdAt, login }) {
    return {
        data: {
            video: {
                broadcastType: broadcastType,
                createdAt: createdAt,
                seekPreviewsURL: SEEK_URL,
                owner: { login: login || 'owner' }
            }
        }
    };
}

// Mock du CDN : renvoie un playlist contenant des segments .ts pour les qualités demandées.
function cdnFor(validQualities) {
    return (url) => {
        const pathname = new URL(url).pathname;
        const ok = validQualities.some((q) => pathname.includes('/' + q + '/'));
        return ok
            ? new Response('#EXTM3U\n#EXTINF:2,\nseg.ts\n', { status: 200 })
            : new Response('nf', { status: 404 });
    };
}

// ─── Sandbox : mêmes fonctions que le blob Worker, dans un scope mocké ───
function buildSandbox(postMessage, pendingFetchRequests, opts = {}) {
    const fns = FUNCTION_NAMES.map((n) => extractFunction(SCRIPT_SRC, n)).join('\n');
    const sandboxSrc = `
        let GQLDeviceID = null;
        let ClientID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
        let AuthorizationHeader = null;
        let ClientIntegrityHeader = null;
        let ClientVersion = null;
        let ClientSession = null;
        const GQL_MAX_RETRIES = 3;
        const GQL_BASE_DELAY = ${opts.gqlBaseDelay || 1000};
        ${fns}
        return { buildVodPlaylist, createServingID };
    `;
    return new Function('pendingFetchRequests', 'postMessage', sandboxSrc)(pendingFetchRequests, postMessage);
}

function makeBuild({ gqlHandler, cdnHandler, opts }) {
    const pendingFetchRequests = new Map();
    const messages = [];
    const postMessage = (msg) => {
        messages.push(msg);
        if (msg.key !== 'FetchRequest') return;
        const fr = msg.value;
        const pending = pendingFetchRequests.get(fr.id);
        pendingFetchRequests.delete(fr.id);
        if (!pending) return;
        // Simule le round-trip page → worker (handleWorkerFetchRequest)
        Promise.resolve().then(() => gqlHandler(fr)).then(
            (resp) => pending.resolve(resp),
            (err) => pending.reject(err)
        );
    };
    const realFetch = async (url) => {
        const resp = cdnHandler(url);
        return resp || new Response('not found', { status: 404 });
    };
    const sandbox = buildSandbox(postMessage, pendingFetchRequests, opts);
    return { build: sandbox.buildVodPlaylist, realFetch, messages };
}

// ─── Validation du format du playlist généré ───
function assertPlaylistFormat(playlist, { usherV2, expectedCount, expectedUrls, extraChecks }) {
    assert(playlist.startsWith('#EXTM3U'), 'commence par #EXTM3U');
    assert(
        playlist.includes('#EXT-X-TWITCH-INFO:ORIGIN="s3",B="false",REGION="EU",USER-IP="127.0.0.1",SERVING-ID="'),
        'ligne #EXT-X-TWITCH-INFO complète (ORIGIN/B/REGION/USER-IP/SERVING-ID)'
    );
    assert(/SERVING-ID="[a-z0-9]{32}"/.test(playlist), 'SERVING-ID = 32 caractères alphanumériques');
    assert(
        playlist.includes('CLUSTER="cloudfront_vod",USER-COUNTRY="BE",MANIFEST-CLUSTER="cloudfront_vod"'),
        'CLUSTER + MANIFEST-CLUSTER = cloudfront_vod'
    );
    const count = (playlist.match(/#EXT-X-STREAM-INF/g) || []).length;
    assert(count === expectedCount, count + ' ligne(s) #EXT-X-STREAM-INF (attendu : ' + expectedCount + ')');
    const lines = playlist.split('\n');
    for (const u of expectedUrls) {
        const idx = lines.indexOf(u);
        assert(idx !== -1, 'URL qualité présente : ' + u);
        assert(idx > 0 && lines[idx - 1].includes('#EXT-X-STREAM-INF'), 'URL précédée de #EXT-X-STREAM-INF');
    }
    if (usherV2) {
        assert(
            playlist.includes('STABLE-VARIANT-ID="chunked",IVS-NAME="chunked",IVS-VARIANT-SOURCE="source"'),
            'v2 : STABLE-VARIANT-ID / IVS-NAME / IVS-VARIANT-SOURCE="source"'
        );
    } else {
        assert(
            playlist.includes('#EXT-X-MEDIA:TYPE=VIDEO,GROUP-ID="chunked",NAME="chunked",AUTOSELECT=YES,DEFAULT=YES'),
            'v1 : #EXT-X-MEDIA chunked AUTOSELECT=YES'
        );
    }
    (extraChecks || []).forEach(([cond, msg]) => assert(cond, msg));
}

// ─── Tests ───

async function testHighlight(usherV2) {
    console.log('  [' + (usherV2 ? 'usher v2' : 'usher v1') + '] broadcastType=highlight');
    const { build, realFetch, messages } = makeBuild({
        gqlHandler: () => new Response(JSON.stringify(gqlVideo({ broadcastType: 'HIGHLIGHT', createdAt: '2023-01-01T00:00:00Z' })), { status: 200 }),
        cdnHandler: cdnFor(['chunked'])
    });
    const resp = await build(usherV2 ? V2_URL : V1_URL, realFetch);
    assert(resp.status === 200, 'status 200');
    const playlist = await resp.text();
    assertPlaylistFormat(playlist, {
        usherV2,
        expectedCount: 1,
        expectedUrls: ['https://' + DOMAIN + '/' + VOD_SPECIAL_ID + '/chunked/highlight-' + VOD_ID + '.m3u8']
    });
    const vb = messages.find((m) => m.key === 'VodBypassed');
    assert(vb && vb.vodId === VOD_ID, 'postMessage VodBypassed avec vodId=' + VOD_ID);
}

async function testUpload(usherV2) {
    console.log('  [' + (usherV2 ? 'usher v2' : 'usher v1') + '] broadcastType=upload, createdAt > 7j → branche upload');
    const { build, realFetch } = makeBuild({
        gqlHandler: () => new Response(JSON.stringify(gqlVideo({ broadcastType: 'UPLOAD', createdAt: '2022-01-01T00:00:00Z', login: 'owner' })), { status: 200 }),
        cdnHandler: cdnFor(['chunked'])
    });
    const resp = await build(usherV2 ? V2_URL : V1_URL, realFetch);
    assert(resp.status === 200, 'status 200');
    const playlist = await resp.text();
    assertPlaylistFormat(playlist, {
        usherV2,
        expectedCount: 1,
        expectedUrls: ['https://' + DOMAIN + '/owner/' + VOD_ID + '/' + VOD_SPECIAL_ID + '/chunked/index-dvr.m3u8']
    });
}

async function testStandard(usherV2) {
    console.log('  [' + (usherV2 ? 'usher v2' : 'usher v1') + '] broadcastType=archive → branche standard');
    const { build, realFetch } = makeBuild({
        gqlHandler: () => new Response(JSON.stringify(gqlVideo({ broadcastType: 'ARCHIVE', createdAt: '2023-01-01T00:00:00Z' })), { status: 200 }),
        cdnHandler: cdnFor(['chunked'])
    });
    const resp = await build(usherV2 ? V2_URL : V1_URL, realFetch);
    assert(resp.status === 200, 'status 200');
    const playlist = await resp.text();
    assertPlaylistFormat(playlist, {
        usherV2,
        expectedCount: 1,
        expectedUrls: ['https://' + DOMAIN + '/' + VOD_SPECIAL_ID + '/chunked/index-dvr.m3u8']
    });
}

async function testMultiQuality(usherV2) {
    console.log('  [' + (usherV2 ? 'usher v2' : 'usher v1') + '] multi-qualités : chunked / 1080p60 / 720p60');
    const { build, realFetch } = makeBuild({
        gqlHandler: () => new Response(JSON.stringify(gqlVideo({ broadcastType: 'ARCHIVE', createdAt: '2023-01-01T00:00:00Z' })), { status: 200 }),
        cdnHandler: cdnFor(['chunked', '1080p60', '720p60'])
    });
    const resp = await build(usherV2 ? V2_URL : V1_URL, realFetch);
    assert(resp.status === 200, 'status 200');
    const playlist = await resp.text();
    const urls = ['chunked', '1080p60', '720p60'].map((q) =>
        'https://' + DOMAIN + '/' + VOD_SPECIAL_ID + '/' + q + '/index-dvr.m3u8'
    );
    const extraChecks = usherV2
        ? [
            [playlist.includes('BANDWIDTH=8534030'), 'chunked → BANDWIDTH=8534030'],
            [playlist.includes('BANDWIDTH=8533930'), '1080p60 → BANDWIDTH=8533930 (décrément)'],
            [playlist.includes('BANDWIDTH=8533830'), '720p60 → BANDWIDTH=8533830 (décrément)'],
            [(playlist.match(/IVS-VARIANT-SOURCE="transcode"/g) || []).length === 2, 'v2 : 2 variants transcode (1080p60, 720p60)']
        ]
        : [
            [playlist.includes('BANDWIDTH=8534030'), 'chunked → BANDWIDTH=8534030'],
            [playlist.includes('BANDWIDTH=8533930'), '1080p60 → BANDWIDTH=8533930 (décrément)'],
            [playlist.includes('BANDWIDTH=8533830'), '720p60 → BANDWIDTH=8533830 (décrément)'],
            [playlist.includes('GROUP-ID="1080p60",NAME="1080p60",AUTOSELECT=NO,DEFAULT=NO'), 'v1 : 1080p60 AUTOSELECT=NO']
        ];
    assertPlaylistFormat(playlist, { usherV2, expectedCount: 3, expectedUrls: urls, extraChecks });
}

async function testUploadRecent() {
    console.log('  upload récent (≤7j) → tombe dans la branche standard');
    const { build, realFetch } = makeBuild({
        gqlHandler: () => new Response(JSON.stringify(gqlVideo({ broadcastType: 'UPLOAD', createdAt: '2023-02-09T00:00:00Z', login: 'owner' })), { status: 200 }),
        cdnHandler: cdnFor(['chunked'])
    });
    const resp = await build(V1_URL, realFetch);
    assert(resp.status === 200, 'status 200');
    const playlist = await resp.text();
    assert(
        playlist.includes('https://' + DOMAIN + '/' + VOD_SPECIAL_ID + '/chunked/index-dvr.m3u8'),
        'URL standard utilisée (pas la branche upload)'
    );
    assert(
        !playlist.includes('/owner/' + VOD_ID + '/'),
        'pas de chemin upload (owner/vodId) dans le playlist'
    );
}

async function testMissingMetadata() {
    console.log('  métadonnées GQL manquantes (video: null)');
    const { build, realFetch, messages } = makeBuild({
        gqlHandler: () => new Response(JSON.stringify({ data: { video: null } }), { status: 200 }),
        cdnHandler: cdnFor(['chunked'])
    });
    const resp = await build(V1_URL, realFetch);
    assert(resp.status === 403, 'status 403');
    assert((await resp.text()) === 'Missing VOD metadata', 'body "Missing VOD metadata"');
    assert(!messages.some((m) => m.key === 'VodBypassed'), 'aucun message VodBypassed');
}

async function testNoQuality() {
    console.log('  aucune qualité valide sur le CDN');
    const { build, realFetch, messages } = makeBuild({
        gqlHandler: () => new Response(JSON.stringify(gqlVideo({ broadcastType: 'ARCHIVE', createdAt: '2023-01-01T00:00:00Z' })), { status: 200 }),
        cdnHandler: () => new Response('nf', { status: 404 })
    });
    const resp = await build(V1_URL, realFetch);
    assert(resp.status === 403, 'status 403');
    assert((await resp.text()) === 'No valid quality found', 'body "No valid quality found"');
    assert(!messages.some((m) => m.key === 'VodBypassed'), 'aucun message VodBypassed');
}

async function testGqlRetry() {
    console.log('  retry GQL : 1er appel réseau KO, 2e OK');
    let gqlCalls = 0;
    const { build, realFetch } = makeBuild({
        gqlHandler: async () => {
            gqlCalls++;
            if (gqlCalls === 1) throw new Error('network down');
            return new Response(JSON.stringify(gqlVideo({ broadcastType: 'ARCHIVE', createdAt: '2023-01-01T00:00:00Z' })), { status: 200 });
        },
        cdnHandler: cdnFor(['chunked']),
        opts: { gqlBaseDelay: 1 }
    });
    const resp = await build(V1_URL, realFetch);
    assert(resp.status === 200, 'status 200 malgré l’échec initial');
    assert(gqlCalls === 2, 'gqlRequestWithRetry a rejoué (2 appels GQL)');
    const playlist = await resp.text();
    assert(playlist.includes('index-dvr.m3u8'), 'playlist généré après retry');
}

// ─── Portes pubs/VODs de hookWorkerFetch (simulation du blob) ───
function extractHook() {
    const start = SCRIPT_SRC.indexOf('function hookWorkerFetch(');
    let depth = 0;
    let i = SCRIPT_SRC.indexOf('{', start);
    for (; i < SCRIPT_SRC.length; i++) {
        if (SCRIPT_SRC[i] === '{') depth++;
        else if (SCRIPT_SRC[i] === '}') {
            depth--;
            if (depth === 0) break;
        }
    }
    return SCRIPT_SRC.slice(start, i + 1);
}

function buildBlob(initialFlags) {
    const scope = `
        const pendingFetchRequests = new Map();
        const AdSegmentCache = new Map();
        let AdSignifier = 'stitched';
        let StreamInfos = {};
        let StreamInfosByUrl = {};
        let HasTriggeredPlayerReload = false;
        let V2API = false;
        let SimulatedAdsDepth = 0;
        let AllSegmentsAreAdSegments = false;
        let GQLDeviceID = null;
        let ClientID = 'x';
        let AuthorizationHeader = null;
        let ClientIntegrityHeader = null;
        let ClientVersion = null;
        let ClientSession = null;
        const GQL_MAX_RETRIES = 3;
        const GQL_BASE_DELAY = 1000;
        let tnsAdsEnabled = ${initialFlags.ads};
        let tnsVodsEnabled = ${initialFlags.vods};
        function buildVodPlaylist() { return Promise.resolve(new Response('BY-PASSED-PLAYLIST', { status: 200 })); }
        async function processM3U8(url, text) { return text.replace(/ADSEG\.ts/g, 'STRIPPED.ts'); }
        ${extractHook()}
        return {
            hookWorkerFetch,
            updateFlags: function(v) {
                if (v && typeof v.adsEnabled === 'boolean') { tnsAdsEnabled = v.adsEnabled; }
                if (v && typeof v.vodsEnabled === 'boolean') { tnsVodsEnabled = v.vodsEnabled; }
            },
            getFlags: function() { return { ads: tnsAdsEnabled, vods: tnsVodsEnabled }; }
        };
    `;
    return new Function(scope)();
}

async function testGates() {
    const blob = buildBlob({ ads: true, vods: true });
    globalThis.fetch = (url) => {
        url = String(url);
        if (url.includes('usher.ttvnw.net/vod/')) return Promise.resolve(new Response('403', { status: 403 }));
        if (url.endsWith('.m3u8')) {
            const body = url.includes('cloudfront')
                ? '#EXTM3U\n#EXTINF:2,\nseg-unmuted.ts\n'
                : '#EXTM3U\n#EXTINF:2,\nADSEG.ts\n';
            return Promise.resolve(new Response(body, { status: 200 }));
        }
        return Promise.resolve(new Response('nf', { status: 404 }));
    };
    blob.hookWorkerFetch();
    const hookedFetch = globalThis.fetch;

    console.log('  usher 403, VODs ON → bypass');
    let r = await hookedFetch('https://usher.ttvnw.net/vod/123.m3u8', {});
    assert((await r.text()) === 'BY-PASSED-PLAYLIST', 'buildVodPlaylist appelé (bypass)');

    console.log('  VODs OFF (UpdateFeatureFlags) → 403 passthrough');
    blob.updateFlags({ adsEnabled: true, vodsEnabled: false });
    assert(blob.getFlags().vods === false, 'flag vods = false après updateFlags');
    r = await hookedFetch('https://usher.ttvnw.net/vod/123.m3u8', {});
    assert(r.status === 403, 'réponse 403 d’origine (pas de bypass)');

    console.log('  m3u8 live avec pubs, ads ON → stripping');
    r = await hookedFetch('https://video-edge-xxx.hls.ttvnw.net/foo.m3u8', {});
    const txtOn = await r.text();
    assert(!txtOn.includes('ADSEG.ts') && txtOn.includes('STRIPPED.ts'), 'segments pubs strippés');

    console.log('  ads OFF (UpdateFeatureFlags) → m3u8 brut');
    blob.updateFlags({ adsEnabled: false, vodsEnabled: false });
    assert(blob.getFlags().ads === false, 'flag ads = false après updateFlags');
    r = await hookedFetch('https://video-edge-xxx.hls.ttvnw.net/foo.m3u8', {});
    assert((await r.text()).includes('ADSEG.ts'), 'segments pubs conservés (pas de stripping)');

    console.log('  VODs ON : dé-mute cloudfront');
    blob.updateFlags({ adsEnabled: false, vodsEnabled: true });
    r = await hookedFetch('https://d2nvs319pecx5r.cloudfront.net/xxx.m3u8', {});
    let vodTxt = await r.text();
    assert(vodTxt.includes('seg-muted.ts') && !vodTxt.includes('-unmuted'), '-unmuted → -muted appliqué');

    console.log('  VODs OFF : pas de dé-mute cloudfront');
    blob.updateFlags({ adsEnabled: false, vodsEnabled: false });
    r = await hookedFetch('https://d2nvs319pecx5r.cloudfront.net/xxx.m3u8', {});
    vodTxt = await r.text();
    assert(vodTxt.includes('seg-unmuted.ts'), '-unmuted conservé (dé-mute inactif)');
}

// ─── Lancement ───
async function main() {
    const tests = [
        ['highlight — branche highlight', () => testHighlight(false)],
        ['highlight — branche highlight (usher v2)', () => testHighlight(true)],
        ['upload > 7 jours — branche upload', () => testUpload(false)],
        ['upload > 7 jours — branche upload (usher v2)', () => testUpload(true)],
        ['archive — branche standard', () => testStandard(false)],
        ['archive — branche standard (usher v2)', () => testStandard(true)],
        ['archive — multi-qualités', () => testMultiQuality(false)],
        ['archive — multi-qualités (usher v2)', () => testMultiQuality(true)],
        ['upload récent (≤7j) → standard', () => testUploadRecent()],
        ['métadonnées manquantes → 403', () => testMissingMetadata()],
        ['aucune qualité valide → 403', () => testNoQuality()],
        ['retry GQL (1 échec puis succès)', () => testGqlRetry()],
        ['portes pubs/VODs (simulation blob)', () => testGates()]
    ];
    for (const [name, fn] of tests) {
        console.log('\n▶ ' + name);
        try { await fn(); } catch (e) { failed++; console.error('   ✘ EXCEPTION : ' + (e.stack || e.message)); }
    }
    console.log('\n════════════════════════════════════════');
    console.log('Résultat : ' + passed + ' assertions OK, ' + failed + ' échec(s)');
    console.log('════════════════════════════════════════');
    process.exit(failed ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
