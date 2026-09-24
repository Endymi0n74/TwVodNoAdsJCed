# TwVodNoAdsJCed

[![Install with Tampermonkey](https://img.shields.io/badge/Install%20with-Tampermonkey-9146FF?style=for-the-badge)](https://raw.githubusercontent.com/Endymi0n74/TwVodNoAdsJCed/master/combined/twitch-combined.user.js)

![Version](https://img.shields.io/badge/version-1.1.3-9146FF?style=for-the-badge) ![Licence](https://img.shields.io/github/license/Endymi0n74/TwVodNoAdsJCed?style=for-the-badge)

[🇫🇷 Français](README.md) · **🇬🇧 English**

Tampermonkey userscript that **blocks Twitch ads**, **unlocks sub-only VODs** and **un-mutes VODs**.

Based on [pixeltris/TwitchAdSolutions](https://github.com/pixeltris/TwitchAdSolutions) (`vaft` script) and on the VOD bypass method from [besuper/TwitchNoSub](https://github.com/besuper/TwitchNoSub).

## ✨ Features

- **Ad blocking** — hooks the Twitch Worker (vaft method): fetches a clean stream, removes ad segments when necessary, fixes buffering
- **Sub-only VODs** — usher bypass: when `usher.ttvnw.net/vod/` returns a **403** (VOD reserved for subscribers), the script builds a direct CDN playlist from the GQL metadata (`seekPreviewsURL`) → the video starts playing
- **Un-muting VODs** — rewriting `-unmuted` → `-muted` in the cloudfront playlists (gets the segments with the original audio)
- **Buttons in the Twitch header** — `📊 Stats` (toast with the counters) and `⏻ ON/OFF` (enable/disable the script)
- **Stats in the console** — persistent counters (localStorage): ads blocked / VODs unlocked

## 📦 Installation — step-by-step guide

### 1. Install Tampermonkey (if needed)
- [Tampermonkey for Chrome](https://chromewebstore.google.com/detail/dhdgffkkebhmkfjojejmpbldmpobfkfo) · [for Firefox](https://addons.mozilla.org/fr/firefox/addon/tampermonkey/)
- ⚠️ **Chrome / Manifest V3 only**: go to `chrome://extensions` → Tampermonkey **Details** → enable **“Allow user scripts”**. Without this option, the script never runs.

### 2. Install the script
- Click the purple **“Install with Tampermonkey”** badge at the top of this README, or open it directly:
  <https://raw.githubusercontent.com/Endymi0n74/TwVodNoAdsJCed/master/combined/twitch-combined.user.js>
- Tampermonkey shows the installation page → click **“Install”**

### 3. Check that it works
- Go to **twitch.tv** (any channel) and open the console (**F12**)
- You should see: `hookWorkerFetch (vaft)` then the `📊 TwitchNoSub+Ads` summary with your counters
- The **📊 Stats** button appears to the left of the viewers/duration bar in the header

### 4. Update
- **Automatic**: the script updates itself (via `@updateURL`, Tampermonkey's periodic check)
- **Manual**: Tampermonkey dashboard → script → **Update** (or reinstall from the URL above)
- Check the displayed version (README version badge / `@version` in the script) — see [CHANGELOG.md](CHANGELOG.md)

### 5. Disable / uninstall
- **Temporarily disable**: **⏻ OFF** button in the header (reload the page; the button stays available to re-enable)
- **Uninstall**: Tampermonkey dashboard → trash can on the script

## 🚀 Usage

![TwitchNoSub+Ads panel](docs/panel.png)

- On a Twitch channel, two buttons appear **to the left of the viewers/duration bar** in the header:
  - **📊 Stats** — opens the **drop-down panel**: counters + toggles (see screenshot above)
  - **⏻ ON/OFF** — disables/re-enables the **whole** script (reload the page; the button stays accessible when OFF)
- **The panel**:
  - `📺 Blocage pubs` — **ON**: blocks live ads (clean stream). **OFF**: ads play normally again
  - `🎬 VODs sub-only` — **ON**: unlocks subscriber-only VODs (+ un-mutes muted VODs). **OFF**: the Twitch paywall stays visible
  - The toggles apply **immediately** (the player reloads, or the page if needed) — no manual reload
  - ⚠️ **Clips and public VODs** always play, whatever the VODs toggle (nothing to unlock — normal)
- **Console (F12)**: stats summary on load, then a log entry for each ad blocked (`📺 Pub bloquée`) and each VOD unlocked (`🎬 VOD sub-only débloquée`)

## ⚠️ Warning

- **Do not combine with other Twitch ad blockers** (vaft, TTV LOL PRO, TwitchNoSub, Purple AdBlock…) — the scripts step on each other (double hooking of the Workers).
- Tested on Chrome + Tampermonkey.

## 🏗️ Architecture

`combined/twitch-combined.user.js` — single script (~1 500 lines), derived from vaft:

| Block | Role |
|------|------|
| `hookWindowWorker()` | Intercepts Twitch's blob Worker and injects the fetch hook into it |
| `hookWorkerFetch()` | In the worker: m3u8 (ads), `channel/hls` (live encodings), `usher.ttvnw.net/vod/` (VODs) |
| `buildVodPlaylist()` | usher 403 bypass → direct CDN playlist (qualities verified, codec detected) |
| `-unmuted → -muted` | Un-mutes the cloudfront playlists |
| `removeRestrictions()` | Cleans up residual overlays (legacy selectors) |
| Header buttons + panel | 📊 Stats / ⏻ ON-OFF buttons + drop-down panel (stats + ads/VODs toggles) + console logs |

## 📂 Repo contents

- `combined/twitch-combined.user.js` — **the script** (to install)
- `combined/test-buildVodPlaylist.js` — Node test harness for the VOD bypass (mock fetch/GQL, 3 branches, playlist format) — `node combined/test-buildVodPlaylist.js`
- `docs/panel.png` — screenshot of the panel for the README
- `.github/workflows/` — **CI**: `node --check` + harness on every push, and automatic release on `v*` tag (script attached)
- `vaft/`, `video-swap-new/` — original upstream scripts (the combined one derives from them)
- `MEMORY.md` — development memory (rules, known bugs, backlog)
- `CHANGELOG.md` — version history
- `issues.md` — known issues in the vaft / video-swap-new base
- `LICENSE` — MIT

## ❓ FAQ — common errors & conflicts

### How do I check the installed version?
- Tampermonkey → dashboard: the “Version” column shows the installed version (e.g. `1.1.3`).
- Compare it with the README version badge or the latest entry in the [CHANGELOG](CHANGELOG.md). If a newer version exists: **Update** (or reinstall from the installation URL).

### The script does nothing
- Check the console (F12) for `hookWorkerFetch (vaft)` after a refresh. If it's not there, the script is not injected.
- **Chrome / Manifest V3**: go to `chrome://extensions` → Tampermonkey Details → enable **“Allow user scripts”**.
- Check that the script is enabled: **⏻ ON/OFF** button in the header (or `localStorage["twitchnosub-enabled"]` ≠ `"false"`).

### Conflicts with other scripts / extensions
- **Never combine TwVodNoAdsJCed with another Twitch ad blocker** (vaft, TTV LOL PRO, Purple AdBlock, TwitchNoSub, AdGuard Extra…). Two scripts hooking Twitch's Workers step on each other: infinite loops, freezes, player crashes.
- Disable the others before using this one.

### Error 3000 (decoder error)
- Most common cause: a conflict with another script or stale cached segments.
- Clear the browser cache, reload the page, and make sure no other Twitch blocker is active.

### A sub-only VOD doesn't play
- Expected logs in the console: `Usher VOD request failed (403) — building bypass playlist` then `VOD bypass: serving generated playlist`.
- If you see `VOD bypass: no valid quality found` or `Missing VOD metadata`: Twitch's CDN structure has changed — [open an issue](https://github.com/Endymi0n74/TwVodNoAdsJCed/issues) with the logs.
- Known limitation: some recently uploaded VODs (less than 7 days old) or some very old uploads may fail (the method is based on the CDN's current structure).

### The stream freezes / buffers during ads
- This is a known issue of the vaft base (`Blocking ads (stripping)` = active removal of ad segments with no backup stream).
- Try pause/play, or adjust the `PlayerBufferingFix` / `AlwaysReloadPlayerOnAd` options in the code. See [issues.md](issues.md).

### Black screen / “Blocking ads (stripping)” displayed
- Normal: the script removes ad segments live but hasn't found a clean stream yet. Wait a few seconds.

### The header buttons don't appear
- The buttons are injected into the header of channel pages (where the viewers / duration are). On home or browse pages, they don't appear.
- If Twitch's header changes structure, the anchor may no longer match — [open an issue](https://github.com/Endymi0n74/TwVodNoAdsJCed/issues) with the DOM structure (right-click → Inspect).

### Mobile (m.twitch.tv)
- Not supported. Use a dedicated mobile solution (see [pixeltris's list](https://github.com/pixeltris/TwitchAdSolutions)).

## ⚖️ License

MIT — Copyright (c) TwitchAdSolutions Contributors. See [LICENSE](LICENSE).
