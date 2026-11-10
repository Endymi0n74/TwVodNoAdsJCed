#!/usr/bin/env node
'use strict';

/**
 * Harness de test unitaire pour TwVodNoAdsJCed.
 *
 * Teste :
 *   - stripAdSegments (suppression des segments pub dans un m3u8)
 *   - parseAttributes (parsing des attributs #EXT-X-STREAM-INF)
 *   - hookFetch (filtrage des requêtes GQL : device ID, player type, picture-by-picture)
 *
 * Usage : node combined/test-unit.js
 */

const fs = require('fs');
const path = require('path');

if (typeof Response === 'undefined') {
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

let passed = 0;
let failed = 0;
function assert(cond, msg) {
    if (cond) { passed++; console.log('   ✔ ' + msg); }
    else { failed++; console.error('   ✘ ' + msg); }
}

// ─── Extraction de fonction par nom (accolades appariées) ───
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

// ─── 1. stripAdSegments ───
console.log('\n▶ stripAdSegments');
(function() {
    const src = extractFunction(SCRIPT_SRC, 'stripAdSegments');
    // sandbox minimal : on a besoin de AdSegmentCache, AllSegmentsAreAdSegments, streamInfo
    const AdSegmentCache = new Map();
    let AllSegmentsAreAdSegments = false;
    const sandboxSrc = `
        const AdSegmentCache = ${JSON.stringify([])};
        let AllSegmentsAreAdSegments = false;
        ${src}
        return stripAdSegments;
    `;
    // On ne peut pas directement injecter AdSegmentCache dans le scope de la fonction extraite
    // car elle utilise la variable globale du sandbox. On recrée donc un sandbox avec Map.
    const sandboxCode = `
        let AdSegmentCache = new Map();
        let AllSegmentsAreAdSegments = false;
        const AdSignifier = 'stitched';
        ${src}
        return { stripAdSegments, AdSegmentCache, setAllSegments: (v) => { AllSegmentsAreAdSegments = v; } };
    `;
    const fn = new Function(sandboxCode)();
    const stripAdSegments = fn.stripAdSegments;
    const cache = fn.AdSegmentCache;
    const setAllSegments = fn.setAllSegments;

    const m3u8 = '#EXTM3U\n#EXTINF:2,live\nseg-live.ts\n#EXTINF:2,\nad-segment.ts\n#EXT-X-TWITCH-PREFETCH:prefetch.ts\n#EXT-X-STREAM-INF:BANDWIDTH=1000\nother.m3u8\n';
    const streamInfo = { NumStrippedAdSegments: 0, IsStrippingAdSegments: false };
    const result = stripAdSegments(m3u8, false, streamInfo);

    assert(result.includes('seg-live.ts'), 'segment live conservé dans le texte');
    assert(result.includes('ad-segment.ts'), 'segment pub présent dans le texte (suppression via cache, pas texte)');
    assert(cache.has('ad-segment.ts'), 'URL segment pub ajoutée au AdSegmentCache');
    assert(!cache.has('seg-live.ts'), 'segment live pas dans le cache');
    assert(streamInfo.NumStrippedAdSegments === 1, 'compteur incrémenté (1)');
    assert(streamInfo.IsStrippingAdSegments === true, 'flag IsStrippingAdSegments = true');
    assert(!result.includes('#EXT-X-TWITCH-PREFETCH:'), 'ligne PREFETCH vidée');

    // Test avec AllSegmentsAreAdSegments = true : même les segments ,live sont mis en cache
    setAllSegments(true);
    cache.clear();
    streamInfo.NumStrippedAdSegments = 0;
    stripAdSegments(m3u8, false, streamInfo);
    assert(cache.has('seg-live.ts'), 'segment live dans le cache (AllSegments=true)');
    assert(cache.has('ad-segment.ts'), 'segment pub dans le cache (AllSegments=true)');
    assert(streamInfo.NumStrippedAdSegments === 2, 'compteur = 2 (live + ad)');

    // Test nettoyage cache : entrées > 120s supprimées
    cache.set('old-seg.ts', Date.now() - 200000);
    cache.set('new-seg.ts', Date.now());
    stripAdSegments('#EXTM3U\n', false, streamInfo);
    assert(!cache.has('old-seg.ts'), 'entrée cache > 120s supprimée');
    assert(cache.has('new-seg.ts'), 'entrée cache < 120s conservée');
})();

// ─── 2. parseAttributes ───
console.log('\n▶ parseAttributes');
(function() {
    const src = extractFunction(SCRIPT_SRC, 'parseAttributes');
    const sandboxCode = `
        ${src}
        return parseAttributes;
    `;
    const parseAttributes = new Function(sandboxCode)();

    // Cas simple
    const a = parseAttributes('CODECS="avc1.4D001E,mp4a.40.2",RESOLUTION="1920x1080",FRAME-RATE=60');
    assert(a.CODECS === 'avc1.4D001E,mp4a.40.2', 'CODECS parsé');
    assert(a.RESOLUTION === '1920x1080', 'RESOLUTION parsé');
    assert(a['FRAME-RATE'] === 60, 'FRAME-RATE converti en nombre');

    // Avec valeurs non-quotées et nombres
    const b = parseAttributes('BANDWIDTH=8534030,AUTOSELECT=YES');
    assert(b.BANDWIDTH === 8534030, 'BANDWIDTH = nombre');
    assert(b.AUTOSELECT === 'YES', 'AUTOSELECT = string');

    // Chaîne vide
    const c = parseAttributes('');
    assert(Object.keys(c).length === 0, 'chaîne vide → objet vide');
})();

// ─── 3. hookFetch ───
console.log('\n▶ hookFetch');
(async function() {
    const src = extractFunction(SCRIPT_SRC, 'hookFetch');
    // Contexte sandbox : on doit fournir window.realFetch, window.fetch, GQLDeviceID, etc.
    const sandboxCode = `
        let GQLDeviceID = null;
        let ClientVersion = null;
        let ClientSession = null;
        let ClientIntegrityHeader = null;
        let AuthorizationHeader = null;
        let tnsAdsEnabled = true;
        let ForceAccessTokenPlayerType = 'popout';
        const postTwitchWorkerMessage = (key, value) => { window.__lastWM = {key, value}; };
        const realFetch = (url, init) => new Response('ok', { status: 200 });
        const window = {
            realFetch: realFetch,
            fetch: null
        };
        ${src}
        // hookFetch assigne window.fetch
        hookFetch();
        return { fetch: window.fetch, realFetch, getLastWM: () => window.__lastWM };
    `;
    const { fetch, realFetch, getLastWM } = new Function(sandboxCode)();

    // Test 1 : requête GQL avec PlaybackAccessToken et picture-by-picture → body vidé
    let r = await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ operationName: 'PlaybackAccessToken', variables: { playerType: 'picture-by-picture' } })
    });
    assert(r.status === 200, 'requête picture-by-picture passe (status 200)');

    // Test 2 : requête GQL avec device ID → propage UpdateDeviceId
    r = await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: { 'X-Device-Id': 'test-device-123', 'Content-Type': 'application/json' },
        body: JSON.stringify({ operationName: 'PlaybackAccessToken', variables: { playerType: 'embed' } })
    });
    const wm = getLastWM();
    assert(wm && wm.key === 'UpdateDeviceId', 'UpdateDeviceId envoyé au worker');
    assert(wm.value === 'test-device-123', 'device ID = test-device-123');

    // Test 3 : requête non-GQL passe normalement
    r = await fetch('https://usher.ttvnw.net/api/channel/hls/channel.m3u8?token=abc', {
        method: 'GET'
    });
    assert(r.status === 200, 'requête non-GQL passe normalement');
})();

// ─── Résumé ───
console.log('\n═════════════════════════════════════════════════════');
console.log('Résultat : ' + passed + ' assertions OK, ' + failed + ' échec(s)');
console.log('══════════════════════════════════════════════════════');
process.exit(failed ? 1 : 0);
