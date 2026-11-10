/**
 * Script de build pour TwVodNoAdsJCed.
 * Concatène les modules src/ en un seul userscript .user.js
 * dans combined/twitch-combined.user.js
 *
 * Usage : node build.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname);
const SRC_DIR = path.join(ROOT, 'src');
const OUT_DIR = path.join(ROOT, 'combined');
const OUT_FILE = path.join(OUT_DIR, 'twitch-combined.user.js');

// Ordre de concaténation : dépendances d'abord, orchestration en dernier.
const MODULES = [
    'core/globals.js',
    'core/declareOptions.js',
    'core/server-time.js',
    'core/attributes.js',
    'core/vod.js',
    'core/gql.js',
    'core/access-token.js',
    'core/fetch-worker.js',
    'core/worker-utils.js',
    'core/ads.js',
    'core/player.js',
    'core/fetch-hook.js',
    'core/storage.js',
    'ui.js',
    'main.js'
];

const USERScript_HEADER = `// ==UserScript==
// @name         TwVodNoAdsJCed
// @namespace    https://github.com/Endymi0n74/TwVodNoAdsJCed
// @version      1.1.4
// @description  Block Twitch ads + watch sub-only VODs (with unmute)
// @updateURL    https://raw.githubusercontent.com/Endymi0n74/TwVodNoAdsJCed/master/combined/twitch-combined.user.js
// @downloadURL  https://raw.githubusercontent.com/Endymi0n74/TwVodNoAdsJCed/master/combined/twitch-combined.user.js
// @author       Endymi0n74
// @match        *://*.twitch.tv/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==
(function() {
    'use strict';
`;

const USERScript_FOOTER = `
})();
`;

function main() {
    if (!fs.existsSync(OUT_DIR)) {
        fs.mkdirSync(OUT_DIR, { recursive: true });
    }

    let parts = [USERScript_HEADER];

    for (const mod of MODULES) {
        const fullPath = path.join(SRC_DIR, mod);
        if (!fs.existsSync(fullPath)) {
            console.error('Module introuvable : ' + fullPath);
            process.exit(1);
        }
        const content = fs.readFileSync(fullPath, 'utf8');
        parts.push('\n// === ' + mod + ' ===\n');
        parts.push(content);
        parts.push('\n// === fin ' + mod + ' ===\n');
    }

    parts.push(USERScript_FOOTER);

    const output = parts.join('\n');
    fs.writeFileSync(OUT_FILE, output, 'utf8');

    console.log('Build OK : ' + OUT_FILE);
    console.log('Modules concaténés : ' + MODULES.length);
    console.log('Taille : ' + (output.length / 1024).toFixed(1) + ' Ko');
}

main();
