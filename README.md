# xdChrome-tool

`xdChrome-tool` is a lightweight Node.js + Playwright browser automation toolkit focused on:

- **CLI-driven execution** of browser actions
- **Structured tools** (navigate, snapshot, click, fill, extract, etc.)
- **Stealth-oriented behavior** (fingerprinting, behavior profiles, anti-detection helpers)
- **Operational controls** for proxy rotation and ad blocking

The project exposes a command-line entrypoint that maps short commands to strongly defined tool operations. It is useful when you need scriptable and inspectable browser workflows without a heavyweight framework wrapper.

---

## Main Capabilities

### Core browser lifecycle
- Launch Chromium via Playwright in headless or headed mode.
- Optional CDP connection mode for attaching to an existing Chrome instance.
- Context/page tracking, current URL state, visited URL history.

### Interaction and extraction
- Navigate to pages and auto-generate a lightweight interactive-element snapshot.
- Click, fill, scroll, press keyboard keys, and handle dialogs.
- Read page text (`extractContent`) and raw HTML (`getSource`).
- Execute custom JavaScript in page context (`evaluate_script`).

### Anti-detection and realism
- Fingerprint generation and injection (UA/platform/hardware-related values).
- Behavior emulation with profile-based typing/scroll delays.
- Stealth diagnostics (`detectStealthIssues`) to detect common automation signals.

### Network/session controls
- Built-in adblock manager with configurable blocking modes/rules.
- Proxy manager with rotation, failure tracking, and temporary banning.

### Result persistence
- Save and read intermediate/final outputs to/from the `results/` directory.

---

## Repository Structure

At root:

- `README.md` – user-facing project overview and usage
- `DOC.md` – technical documentation
- `src/` – all implementation files

Inside `src/`:

- `xd-chrome.js` – CLI entrypoint
- `xd-chrome-cli.js` – CLI parser and command→tool mapping
- `xd-chrome-core.js` – browser agent context and lifecycle
- `xd-chrome-tools.js` – tool implementations
- `xd-chrome-tools-schema.js` – tool metadata/schema
- `xd-chrome-helpers.js` – utility helpers
- `xd-chrome-extended/` – stealth, adblock, proxy, fingerprinting, behavior modules

---

## Requirements

- **Node.js 18+** recommended
- Installed dependencies required by source code:
  - `playwright`

> Note: This repository currently does not contain `package.json`; install runtime dependencies according to your environment standards.

---

## Quick Start

### 1) Run help

```bash
node /home/runner/work/xdChrome-tool/xdChrome-tool/src/xd-chrome.js --help
```

### 2) Initialize browser

```bash
node /home/runner/work/xdChrome-tool/xdChrome-tool/src/xd-chrome.js init
```

### 3) Navigate to a page

```bash
node /home/runner/work/xdChrome-tool/xdChrome-tool/src/xd-chrome.js navigate --url https://example.com
```

### 4) Snapshot and interact

```bash
node /home/runner/work/xdChrome-tool/xdChrome-tool/src/xd-chrome.js snapshot --verbose
node /home/runner/work/xdChrome-tool/xdChrome-tool/src/xd-chrome.js click --uid el_0
```

### 5) Save output

```bash
node /home/runner/work/xdChrome-tool/xdChrome-tool/src/xd-chrome.js save --filename output.md --content "Automation result"
```

---

## Command Reference (CLI)

General pattern:

```bash
node src/xd-chrome.js <command> [options]
```

Common commands:

- `init` / `close`
- `navigate --url <https://...>`
- `snapshot [--verbose]`
- `click --uid <el_x>`
- `fill --uid <el_x> --text "..."`
- `open-link --uid <el_x>`
- `scroll [--direction down|up|bottom] [--distance 500]`
- `tab --target <index|url-fragment>`
- `proxy <status|rotate>`
- `adblock <status|enable|disable|setMode|updateConfig|resetStats>`
- `fingerprint [--config '{"deviceType":"desktop"}']`
- `stealth`
- `behavior`
- `wait --ms 1000`
- `extract [--selector "article"]`
- `source [--includeDoctype true|false]`
- `eval --script "return document.title"`
- `key --key Enter`
- `dialog --action accept|dismiss [--promptText "..."]`
- `save --filename file.md --content "..." [--append true]`
- `read --filename file.md`
- `done --reason "Task complete"`

---

## Typical Use Cases

### 1) Website flow automation
- Navigate through multi-step UI flows.
- Click and fill form elements discovered via snapshots.
- Handle popups/dialogs and capture resulting source/text.

### 2) Content extraction pipelines
- Visit selected URLs.
- Extract cleaned page text (`extractContent`) from `body` or a specific selector.
- Save outputs as files for post-processing.

### 3) Basic anti-bot experimentation
- Generate and inject rotating fingerprints.
- Emulate human-like typing and scrolling behavior.
- Run stealth checks to monitor detectable signals.

### 4) Proxy/adblock assisted browsing
- Route traffic through rotating proxies.
- Block heavy or ad-related resources to improve speed/noise profile.

### 5) Tool-driven orchestration
- Use individual commands as composable units in shell scripts or higher-level agents.

---

## Limitations

- No built-in test suite in current repository state.
- Dependency manifest is not included at the moment.
- Some stealth/fingerprint techniques may not bypass advanced bot protection systems.

---

## Safety & Operational Notes

- Treat `eval` (`evaluate_script`) as privileged functionality.
- Validate target URLs and scripts before automation in production.
- Be mindful of website ToS, legal requirements, and privacy regulations.

---

## License

No explicit license file is currently present in this repository. Add one if redistribution or commercial usage is planned.
