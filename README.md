# xdChrome-tool

A modular, zero-framework browser automation toolkit built on Node.js + Playwright. One CLI command = one deterministic browser action.

Unlike heavyweight automation frameworks, xdChrome-tool gives you composable, single-purpose commands that can be chained in shell scripts, piped to other tools, or orchestrated by AI agents. Every command outputs structured JSON — no guessing, no parsing HTML logs.

---

## Why xdChrome-tool?

**Snapshot-first interaction** — instead of brittle CSS selectors, you take an accessibility snapshot of the page, get a list of interactive elements with stable UIDs (`el_0`, `el_1`, ...), and interact by referencing those UIDs. If the DOM changes, just re-snapshot.

**4-layer click resilience** — when you click an element, the tool tries: primary CSS selector → ARIA role+name → text content match → JavaScript `.click()`. If the URL doesn't change on a link click, it auto-falls back to direct navigation via `href`.

**Built-in stealth stack** — fingerprint generation/injection, human-like typing and scrolling with behavioral profiles, stealth diagnostics, and anti-detection helpers. All modular — use what you need, skip what you don't.

**Operational controls** — proxy rotation with failure tracking and auto-banning, request-level adblock with LRU stats, cookie consent auto-dismissal (7 known banner selectors).

---

## Quick Start

```bash
git clone https://github.com/jsle97/xdChrome-tool.git
cd xdChrome-tool
npm install          # installs playwright + node-fetch
npx playwright install --with-deps
```

```bash
# Initialize browser
node src/xd-chrome.js init

# Navigate
node src/xd-chrome.js navigate --url https://example.com

# See what's on the page
node src/xd-chrome.js snapshot

# Click an element from the snapshot
node src/xd-chrome.js click --uid el_3

# Extract page text
node src/xd-chrome.js extract --selector "article"

# Save output
node src/xd-chrome.js save --filename result.md --content "Extracted data here"

# Done
node src/xd-chrome.js done --reason "Task complete"
```

Every command returns JSON:
```json
{
  "ok": true,
  "tool": "navigate",
  "result": {
    "success": true,
    "url": "https://example.com",
    "snapshot": "el_0 [link] \"More information...\"\nel_1 [link] \"IANA\"",
    "elementCount": 2
  }
}
```

---

## Architecture

```
xd-chrome.js              Entry point — runs CLI, exits with status code
  └─ xd-chrome-cli.js     Parses argv, maps 22 commands → tool executions
      ├─ xd-chrome-core.js     Browser context factory (init, tabs, cookies, lifecycle)
      ├─ xd-chrome-tools.js    22 tool implementations with execute(ctx, params)
      ├─ xd-chrome-tools-schema.js   Declarative tool metadata and parameter schemas
      ├─ xd-chrome-helpers.js        Utility functions (sleep, parseArgv, logger, etc.)
      └─ xd-chrome-extended/
          ├─ xd-extended-adblock.js          Request interception with 5-step pipeline
          ├─ xd-extended-proxy.js            Round-robin rotation, failure tracking, auto-ban
          ├─ xd-extended-fingerprinting.js   UA/device fingerprint generation + injection
          ├─ xd-extended-behavior.js         Human-like typing/scrolling with 3 profiles
          ├─ xd-extended-stealth.js          Session manager binding fingerprint + behavior
          └─ xd-extended-stealth-helpers.js  Shared constants and randomization utilities
```

**Design principle**: each CLI invocation is isolated and deterministic. The tool creates a browser context, executes exactly one operation, prints JSON to stdout, and closes. This makes it trivially composable.

---

## Command Reference

| Command | Description | Key Options |
|---------|-------------|-------------|
| `init` | Launch browser | |
| `close` | Close browser | |
| `navigate` | Go to URL (auto-snapshots) | `--url <URL>` |
| `snapshot` | Accessibility snapshot of interactive elements | `--verbose` |
| `click` | Click element by UID | `--uid el_5` |
| `fill` | Fill input field | `--uid el_2 --text "value"` |
| `open-link` | Navigate via element's href | `--uid el_3` |
| `scroll` | Scroll page | `--direction down\|up\|bottom --distance 500` |
| `tab` | Switch browser tab | `--target 0` or `--target "url-fragment"` |
| `extract` | Extract readable text | `--selector "article"` |
| `source` | Get raw HTML | `--includeDoctype` |
| `eval` | Execute JavaScript in page | `--script "return document.title"` |
| `key` | Press keyboard key | `--key Enter` |
| `dialog` | Handle alert/confirm/prompt | `--action accept\|dismiss` |
| `wait` | Pause execution | `--ms 2000` |
| `save` | Save to results/ directory | `--filename out.md --content "..." --append` |
| `read` | Read saved result | `--filename out.md` |
| `proxy` | Proxy status or rotate | `status\|rotate` |
| `adblock` | Adblock controls | `status\|enable\|disable\|setMode\|updateConfig\|resetStats` |
| `fingerprint` | Generate + inject fingerprint | `--config '{"deviceType":"mobile"}'` |
| `stealth` | Detect automation signals | |
| `behavior` | Rotate behavior profile | |
| `done` | Signal task completion | `--reason "Summary"` |

---

## Extended Modules

### Adblock Manager
Request-level interception with a 5-step decision pipeline:
1. Skip unsupported schemes (`data:`, `blob:`, `about:`)
2. Allowlist domain bypass
3. Block by resource type (balanced: media only; aggressive: images, media, fonts)
4. Block by domain pattern (doubleclick, googlesyndication, taboola, criteo, etc.)
5. Block by URL pattern

Includes LRU-based stats tracking (top 500 blocked hosts), hot config updates without browser restart, and multi-context support.

```bash
node src/xd-chrome.js adblock status
node src/xd-chrome.js adblock setMode --mode aggressive
node src/xd-chrome.js adblock updateConfig --blockUrlPatterns "tracker.example.com,ads.example.com"
```

### Proxy Manager
Round-robin rotation with shuffled initial order and automatic failure handling:
- **3 failures within 1 hour** → proxy gets banned for 12 hours
- Ban state persists to disk (`data_arch/proxies.json`) across sessions
- Reports success/failure per proxy for continuous health tracking

```bash
node src/xd-chrome.js proxy status    # { total: 5, available: 4, banned: 1 }
node src/xd-chrome.js proxy rotate    # restarts browser with next available proxy
```

### Stealth Stack
Three layers working together:

**Fingerprinting** — generates consistent device fingerprints (UA, platform, timezone, WebGL vendor, hardware concurrency, screen dimensions) from curated pools. Injects via `addInitScript` to override `navigator` properties. Auto-regenerates every 5 minutes.

**Behavior Emulation** — three profiles with different timing characteristics:

| Profile | Click Delay | Type Delay | Scroll Pause |
|---------|------------|------------|--------------|
| `stealth` | 250–1100ms | 50–140ms | 80–320ms |
| `casual` | 450–1800ms | 70–180ms | 120–450ms |
| `researcher` | 800–2600ms | 80–200ms | 150–600ms |

Typing is character-by-character with randomized per-character delays. Profile rotation every 10 minutes.

**Stealth Diagnostics** — checks for detectable automation signals (webdriver property, low plugin count) and reports issues with severity levels.

---

## Use Cases

**Shell script automation** — chain commands for multi-step flows:
```bash
node src/xd-chrome.js navigate --url "https://example.com/login"
node src/xd-chrome.js snapshot
node src/xd-chrome.js fill --uid el_0 --text "user@email.com"
node src/xd-chrome.js fill --uid el_1 --text "password123"
node src/xd-chrome.js click --uid el_2
node src/xd-chrome.js extract --selector ".dashboard"
node src/xd-chrome.js save --filename dashboard.md --content "$(cat)"
```

**Content extraction pipelines** — scrape and structure content:
```bash
for url in "${URLS[@]}"; do
  node src/xd-chrome.js navigate --url "$url"
  node src/xd-chrome.js extract --selector "article"
  node src/xd-chrome.js save --filename "pages.md" --content "$(cat)" --append true
done
```

**AI agent orchestration** — the structured JSON output and tool schema make this a natural fit for LLM tool-calling workflows. Each command maps to a well-defined tool with typed parameters.

**QA and testing** — stealth diagnostics help identify automation detection vectors. Use fingerprint rotation and behavior profiles to test how your site handles different client configurations.

---

## Configuration

Browser, proxy, adblock, and stealth settings are configured via the `DEFAULT_CONFIG` object in `xd-chrome-core.js`:

```javascript
{
  browser: { headless: true, viewport: { width: 1280, height: 800 }, timeout: 30000 },
  proxy: { enabled: false, urls: [] },
  adblock: { enabled: true, mode: 'balanced' },
  stealth: { enabled: true, deviceType: 'desktop', browserType: 'chrome', behaviorProfile: 'stealth' }
}
```

CDP mode available for connecting to an existing Chrome instance instead of launching a new one.

---

## Shell Setup

**Option A — symlink (recommended)**

```bash
chmod +x src/xd-chrome.js
sudo ln -s "$(pwd)/src/xd-chrome.js" /usr/local/bin/xdc
```

Now you can use `xdc` globally:
```bash
xdc navigate --url https://example.com
xdc snapshot --verbose
xdc click --uid el_3
```

**Option B — shell function with validation**

Add to `~/.bashrc` or `~/.zshrc`:
```bash
xdc() {
 local XDC_DIR="$HOME/tools/xdChrome-tool"
 if [ $# -eq 0 ]; then
  node "$XDC_DIR/src/xd-chrome.js" --help
  return
 fi
 node "$XDC_DIR/src/xd-chrome.js" "$@"
}
```

Then `source ~/.bashrc` and use as `xdc navigate --url ...`.

**Option C — pipe-friendly wrapper for scripting**

```bash
xdc() {
 local XDC_DIR="$HOME/tools/xdChrome-tool"
 node "$XDC_DIR/src/xd-chrome.js" "$@" 2>/dev/null | jq -r '.result // .'
}
```

Strips stderr and extracts `.result` — useful for chaining:
```bash
xdc navigate --url https://example.com | jq '.elementCount'
```

---

## Requirements

- **Node.js 18+**
- **Playwright** (installed via npm)

---

## Limitations

- One command per process invocation (by design — ensures isolation)
- Stealth techniques may not bypass advanced bot protection (Cloudflare Turnstile, etc.)
- No built-in test suite yet

---

## Safety & Legal

- `eval` (`evaluate_script`) executes arbitrary JS in page context — treat as privileged
- `openLink` blocks `javascript:` pseudo-URLs to prevent injection
- File operations sanitize filenames to prevent path traversal
- Always respect website Terms of Service, robots.txt, and applicable privacy regulations

---

## License

MIT — see [LICENSE](LICENSE)

---

**Author**: Jakub Śledzikowski — [jsle.eu](https://jsle.eu) | jakub@jsle.eu
