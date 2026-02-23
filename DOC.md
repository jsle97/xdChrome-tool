# xdChrome-tool Technical Documentation

This document describes the technical architecture and internals of `xdChrome-tool`.

---

## 1. Architecture Overview

The application is structured as a modular browser automation runtime:

1. **Entry layer** (`src/xd-chrome.js`)
   - Launches CLI and exits with returned status code.
2. **CLI layer** (`src/xd-chrome-cli.js`)
   - Parses arguments, maps commands to tools, executes a single tool per invocation.
3. **Core runtime layer** (`src/xd-chrome-core.js`)
   - Creates browser context object, initializes browser/page, wires adblock + stealth + proxy integration.
4. **Tool layer** (`src/xd-chrome-tools.js` + `src/xd-chrome-tools-schema.js`)
   - Defines executable operations and the schema/metadata for each operation.
5. **Extended modules** (`src/xd-chrome-extended/*`)
   - Adblock, proxy rotation, fingerprinting, stealth session management, and behavior simulation.
6. **Utility layer** (`src/xd-chrome-helpers.js`)
   - Generic helpers used by CLI and runtime.

---

## 2. Runtime Flow

A standard CLI invocation follows this flow:

1. `node src/xd-chrome.js <command> ...`
2. Entry calls `runCli(argv)`.
3. CLI parser returns `{ command, args, flags }`.
4. Command is translated via `COMMAND_TO_TOOL`.
5. `createTools()` returns registry; selected tool is executed.
6. `createAgentContext(config)` creates runtime context.
7. Context initializes browser (unless command is exempt).
8. Tool executes with `ctx` and parsed `params`.
9. JSON result is printed to stdout.
10. Context closes browser in `finally` block.

This design makes each command invocation isolated and deterministic.

---

## 3. Core Context (`createAgentContext`)

The context object encapsulates state and methods required by tools.

### 3.1 Configuration
- `DEFAULT_CONFIG` fields:
  - `browser`: headless, viewport, timeout, slowMo, CDP toggles
  - `proxy`: enabled + URL list
  - `adblock`: enabled, mode, block types/patterns, allowlist
  - `stealth`: enabled + profile settings

User config is merged shallowly with defaults for each top-level section.

### 3.2 State fields
Key state includes:
- `browser`, `page`, `pages`, `currentPageIndex`
- `currentUrl`, `visitedUrls`, `lastSnapshot`
- proxy/adblock/stealth manager instances
- cookie handling state and lightweight runtime telemetry (`step`, `lastError`)

### 3.3 Important methods
- `init()`
  - Launches Chromium or connects via CDP.
  - Applies proxy launch options if enabled.
  - Creates page and installs adblock handlers.
  - Creates stealth session and tab listeners.
  - Attaches selective console warning/error logging.
- `switchToTab(indexOrUrl)`
  - Supports integer index or URL-fragment matching.
- `handleCookiePolicy()`
  - Attempts clicking known consent selectors once per URL key.
- `rotateBrowser()`
  - Marks proxy failure, restarts browser, re-initializes context.
- `getLiveStatus()`
  - Returns runtime snapshot for monitoring.
- `close()`
  - Closes browser unless running in pooled ownership mode.

---

## 4. Tool System

### 4.1 Registry model
`createTools()` constructs a registry by combining:
- declarative schema metadata from `ToolsSchema`
- concrete `execute(ctx, params)` implementations

Only tools present in both schema and implementation are exposed.

### 4.2 Snapshot-first interaction model
Many interaction tools assume a previously generated snapshot:
- `snapshot` stores `ctx.lastSnapshot` as element metadata (`id`, `selector`, `role`, etc.)
- `click` / `fill` resolve the user-provided `uid` against that snapshot

### 4.3 Critical tool behaviors
- `navigate`
  - Handles tunnel failures with optional proxy rotation retry.
  - Updates URL history and performs auto-snapshot.
- `click`
  - Uses layered strategy: selector → role+name → text → JS click.
  - Detects and auto-switches to newly opened tabs.
  - Falls back to direct navigation for link-type elements if URL did not change.
- `openLink`
  - Resolves href safely and disallows `javascript:` URLs.
- `extractContent`
  - Clones target node, strips non-content tags, returns flattened text.
- `evaluate_script`
  - Runs arbitrary async JS in page context and returns serialized preview.
- `saveResult` / `readResult`
  - Persists under `results/` with filename sanitization.

---

## 5. CLI Parsing and Command Mapping

`parseArgv()` supports:
- positional args
- `--flag value` key-value pairs
- boolean flags (value-less keys become `true`)

`parseParams()` normalizes command-specific parameter objects for tools.

`decisionSignature()` and `actionKeyForDecision()` provide canonical signatures for deduplication/logging workflows.

---

## 6. Extended Module Details

### 6.1 Adblock manager (`xd-extended-adblock.js`)
- Intercepts all context requests via `route('**/*')`.
- Decision pipeline:
  1. ignore unsupported schemes (`data:`, `blob:`, `about:`)
  2. allowlist domain bypass
  3. block by resource type
  4. block by domain pattern
  5. block by URL pattern
- Tracks stats:
  - total blocked/allowed
  - blocked by resource type
  - top blocked hosts via small LRU map
- Supports hot config updates with context reinstallation.

### 6.2 Proxy manager (`xd-extended-proxy.js`)
- Round-robin with shuffled initial order.
- Failure tracking window (`FAIL_WINDOW_MS`) and threshold (`FAIL_THRESHOLD`).
- Auto-ban with expiry (`BAN_DURATION_MS`) and persistent state file (`data_arch/proxies.json`).
- Public API:
  - `getNextProxy`, `getCurrentProxy`, `reportFailure`, `reportSuccess`, `getStats`.

### 6.3 Fingerprint manager (`xd-extended-fingerprinting.js`)
- Generates UA/device/browser-driven fingerprints.
- Includes platform, timezone, languages, WebGL and hardware fields.
- Provides hash for identity tracking and refresh interval handling.
- Injects selected values into `navigator` properties with `addInitScript`.

### 6.4 Behavior emulator (`xd-extended-behavior.js`)
- Profiles: `stealth`, `casual`, `researcher`.
- Supports profile rotation and switch interval checks.
- Emulates typing character-by-character with random delay.
- Emulates scroll with profile-dependent pauses.

### 6.5 Stealth session manager (`xd-extended-stealth.js`)
- Binds page + fingerprint + behavior under a session ID.
- Returns session facade with helper methods (`emulateTyping`, `emulateScroll`, `detectStealthIssues`, etc.).
- Tracks lightweight metrics and supports session close.

### 6.6 Stealth helpers (`xd-extended-stealth-helpers.js`)
- Constants for timing, WebGL vendors, timezone pool.
- Generic randomization + utility methods used across stealth modules.

---

## 7. Data and I/O

### 7.1 Filesystem outputs
- `results/<safe-name>` for saved outputs
- `data_arch/proxies.json` for proxy ban persistence

### 7.2 Logs
- Colorized logger from helpers (`info/warn/error/success`).
- Browser console warnings/errors are filtered to reduce noise.

---

## 8. Security Considerations

1. **Dynamic script execution (`evaluate_script`)**
   - Allows arbitrary JavaScript in browser context.
   - Must be restricted to trusted operators/workflows.
2. **Proxy credentials**
   - Credentials are parsed from proxy URLs and used at launch.
   - Keep proxy lists protected and avoid logging secrets.
3. **File operations**
   - `saveResult/readResult` sanitize filenames to reduce traversal risk.
4. **Navigation safety**
   - `openLink` blocks `javascript:` pseudo-URLs.

---

## 9. Error Handling Strategy

- Most CLI failures return a JSON error payload and exit code `1`.
- Tool-level exceptions are allowed to bubble and are serialized by CLI catch block.
- Several runtime paths intentionally use tolerant `try/catch` to preserve session resilience (e.g., cookie handling, some fallbacks).

---

## 10. Extending the Application

To add a new tool:

1. Add metadata in `src/xd-chrome-tools-schema.js`.
2. Implement `execute` function in `src/xd-chrome-tools.js`.
3. (Optional) Add CLI command mapping in `src/xd-chrome-cli.js`:
   - map command in `COMMAND_TO_TOOL`
   - add parameter parsing in `parseParams`
   - add help text line

Because registry creation intersects schema and implementation, omitted entries are automatically excluded.

---

## 11. Operational Recommendations

- Use one command per process invocation (current design assumption).
- Capture snapshot before `click`/`fill` operations relying on `uid`.
- Keep adblock mode at `balanced` unless aggressive blocking is required.
- Rotate proxies on network tunnel failures.

---

## 12. Known Gaps

- No packaged dependency manifest in repository root.
- No built-in automated test suite yet.
- No formal release/build pipeline definitions in current state.

