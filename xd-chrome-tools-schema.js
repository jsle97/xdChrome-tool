/**
 * @fileoverview Tool definitions (name, description, parameter schema) for xd-chrome agent.
 * @module xd-chrome-tools-schema
 */

/** @type {Record<string, {name: string, description: string, schema: Record<string, object>}>} */
const ToolsSchema = {
 init: { name: 'init', description: 'Initialize browser runtime', schema: {} },
 close: { name: 'close', description: 'Close browser runtime', schema: {} },
 navigate: {
  name: 'navigate',
  description: 'Navigate to URL (auto-snapshots after load)',
  schema: { url: { type: 'string', description: 'Full URL to navigate to', required: true } }
 },
 snapshot: {
  name: 'snapshot',
  description: 'Take accessibility snapshot (preferred over screenshot)',
  schema: { verbose: { type: 'boolean', description: 'Include extra detail', required: false } }
 },
 click: {
  name: 'click',
  description: 'Click element by uid from snapshot',
  schema: { uid: { type: 'string', description: 'Element ID from snapshot (e.g. el_5)', required: true } }
 },
 fill: {
  name: 'fill',
  description: 'Fill input field by uid from snapshot',
  schema: {
   uid: { type: 'string', description: 'Element ID of input field', required: true },
   text: { type: 'string', description: 'Text to type into the field', required: true }
  }
 },
 openLink: {
  name: 'openLink',
  description: 'Open link by uid via direct navigation (use href instead of click)',
  schema: { uid: { type: 'string', description: 'Element ID of link from snapshot', required: true } }
 },
 scroll: {
  name: 'scroll',
  description: 'Scroll current page (clears snapshot)',
  schema: {
   direction: { type: 'string', enum: ['down', 'up', 'bottom'], description: 'Scroll direction', required: false },
   distance: { type: 'number', description: 'Pixels to scroll (default 500)', required: false }
  }
 },
 switchToTab: {
  name: 'switchToTab',
  description: 'Switch tab by index (0-based) or URL fragment',
  schema: { target: { type: 'string', description: 'Tab index or URL fragment to match', required: true } }
 },
 proxyControl: {
  name: 'proxyControl',
  description: 'Check proxy status or rotate proxy/browser session',
  schema: {
   action: { type: 'string', enum: ['status', 'rotate'], description: 'Proxy action', required: true },
   reason: { type: 'string', description: 'Optional reason for logs', required: false }
  }
 },
 adblockControl: {
  name: 'adblockControl',
  description: 'Check or change adblock config/state (mode, enabled, rules, stats)',
  schema: {
   action: { type: 'string', enum: ['status', 'enable', 'disable', 'setMode', 'updateConfig', 'resetStats'], description: 'Adblock action', required: true },
   mode: { type: 'string', enum: ['balanced', 'aggressive'], description: 'Mode for setMode', required: false },
   enabled: { type: 'boolean', description: 'Explicit enabled flag for updateConfig', required: false },
   blockUrlPatterns: { type: 'array', description: 'URL/domain block patterns', required: false },
   allowlistDomains: { type: 'array', description: 'Allowlist domains', required: false }
  }
 },
 wait: {
  name: 'wait',
  description: 'Wait for specified milliseconds',
  schema: { ms: { type: 'number', description: 'Milliseconds to wait', required: true } }
 },
 extractContent: {
  name: 'extractContent',
  description: 'Extract readable text from current page (articles, regulations, main content)',
  schema: { selector: { type: 'string', description: 'CSS selector (default: body)', required: false } }
 },
 getSource: {
  name: 'getSource',
  description: 'Get raw HTML source of current page',
  schema: { includeDoctype: { type: 'boolean', description: 'Include DOCTYPE declaration', required: false } }
 },
 evaluate_script: {
  name: 'evaluate_script',
  description: 'Execute JavaScript in page context and return serializable result',
  schema: { script: { type: 'string', description: 'JavaScript code to execute', required: true } }
 },
 press_key: {
  name: 'press_key',
  description: 'Press keyboard key on active page (e.g. Enter, Escape, Tab)',
  schema: { key: { type: 'string', description: 'Key name (e.g. Enter, Escape, ArrowDown)', required: true } }
 },
 handle_dialog: {
  name: 'handle_dialog',
  description: 'Handle browser dialog (alert/confirm/prompt). Call BEFORE the triggering action.',
  schema: {
   action: { type: 'string', enum: ['accept', 'dismiss'], description: 'How to handle dialog', required: true },
   promptText: { type: 'string', description: 'Text for prompt dialog', required: false }
  }
 },
 saveResult: {
  name: 'saveResult',
  description: 'Save intermediate/final result to file',
  schema: {
   filename: { type: 'string', description: 'Output filename (e.g. results.json)', required: true },
   content: { type: 'string', description: 'Content to save', required: true },
   append: { type: 'boolean', description: 'Append instead of overwrite', required: false }
  }
 },
 readResult: {
  name: 'readResult',
  description: 'Read previously saved result file (max 164k chars)',
  schema: { filename: { type: 'string', description: 'Filename to read', required: true } }
 },
 done: {
  name: 'done',
  description: 'Finish task and report final summary',
  schema: { reason: { type: 'string', description: 'Summary of accomplishments', required: true } }
 },
 generateFingerprint: {
  name: 'generateFingerprint',
  description: 'Generate and inject a new browser fingerprint',
  schema: { config: { type: 'object', description: 'Fingerprint generation config', required: false } }
 },
 detectStealthIssues: {
  name: 'detectStealthIssues',
  description: 'Detect potential stealth issues on current page',
  schema: {}
 },
 rotateBehaviorProfile: {
  name: 'rotateBehaviorProfile',
  description: 'Rotate the current behavior profile',
  schema: {}
 }
}

export { ToolsSchema }

