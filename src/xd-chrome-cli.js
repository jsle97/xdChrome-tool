/**
 * @fileoverview CLI interface for xd-chrome. Maps shell commands to tool executions.
 * @module xd-chrome-cli
 */

import { createAgentContext, DEFAULT_CONFIG } from './xd-chrome-core.js'
import { createTools } from './xd-chrome-tools.js'
import { parseArgv, parseList, safeJsonParse, toBoolean, truncate, normalizeUrl } from './xd-chrome-helpers.js'

/** @type {Record<string, string>} CLI command → tool name mapping */
const COMMAND_TO_TOOL = {
 init: 'init',
 close: 'close',
 navigate: 'navigate',
 snapshot: 'snapshot',
 click: 'click',
 fill: 'fill',
 'open-link': 'openLink',
 scroll: 'scroll',
 tab: 'switchToTab',
 proxy: 'proxyControl',
 adblock: 'adblockControl',
 fingerprint: 'generateFingerprint',
 stealth: 'detectStealthIssues',
 behavior: 'rotateBehaviorProfile',
 wait: 'wait',
 extract: 'extractContent',
 source: 'getSource',
 eval: 'evaluate_script',
 key: 'press_key',
 dialog: 'handle_dialog',
 save: 'saveResult',
 read: 'readResult',
 done: 'done'
}

/** ANSI color helpers for terminal output */
const Colors = {
 info: '\x1b[36m', success: '\x1b[32m', error: '\x1b[31m',
 dim: '\x1b[2m', reset: '\x1b[0m', warn: '\x1b[33m'
}

const HELP_TEXT = `${Colors.info}Usage:${Colors.reset}
  node xd-chrome.js <command> [options]

${Colors.info}Commands:${Colors.reset}
  init                                   Initialize browser
  close                                  Close browser
  navigate --url <https://...>           Navigate to URL
  snapshot [--verbose]                   Take DOM snapshot
  click --uid <el_0>                     Click element
  fill --uid <el_0> --text "value"       Fill input
  open-link --uid <el_0>                 Open link by href
  scroll [--direction down|up|bottom]    Scroll page
  tab --target <0|url-fragment>          Switch tab
  proxy <status|rotate>                  Proxy control
  adblock <status|enable|disable|...>    Adblock control
  fingerprint [--config '{}']            Generate fingerprint
  stealth                                Detect stealth issues
  behavior                               Rotate behavior profile
  wait --ms 1200                         Wait
  extract [--selector "article"]         Extract page text
  source [--includeDoctype]              Get HTML source
  eval --script "return document.title"  Execute JS
  key --key Enter                        Press key
  dialog --action accept                 Handle dialog
  save --filename out.md --content "..."  Save result
  read --filename out.md                 Read result
  done --reason "Task complete"          Signal completion
`

/**
 * Build a unique signature for a tool decision (for dedup/logging).
 * @param {{tool: string, params: object}} decision
 * @returns {string}
 */
const decisionSignature = (decision) => {
 const tool = decision?.tool || ''
 const params = decision?.params || {}
 switch (tool) {
  case 'navigate': return `url=${normalizeUrl(params.url)}`
  case 'click': case 'openLink': case 'fill': return `uid=${truncate(params.uid, 40)}`
  case 'press_key': return `key=${truncate(params.key, 40)}`
  case 'scroll': return `direction=${truncate(params.direction, 20)}`
  case 'switchToTab': return `target=${truncate(params.target, 60)}`
  case 'snapshot': return `verbose=${String(params.verbose)}`
  case 'wait': return `ms=${truncate(String(params.ms), 20)}`
  case 'evaluate_script': return `script=${truncate(params.script, 120)}`
  case 'handle_dialog': return `action=${truncate(params.action, 20)}`
  case 'saveResult': case 'readResult': return `filename=${truncate(params.filename, 80)}`
  default: { try { return truncate(JSON.stringify(params), 200) } catch { return '' } }
 }
}

/**
 * Build unique action key combining tool, URL and params.
 * @param {{tool: string, params: object}} decision @param {object} ctx
 * @returns {string}
 */
const actionKeyForDecision = (decision, ctx) => {
 const tool = decision?.tool || 'unknown'
 const url = normalizeUrl(ctx?.currentUrl || '')
 return `${tool}|${url}|${decisionSignature(decision)}`
}

/**
 * Parse CLI flags into tool-specific params.
 * @param {{command: string, args: string[], flags: Record<string, string|true>}} parsed
 * @returns {object}
 */
const parseParams = ({ command, args, flags }) => {
 switch (command) {
  case 'navigate': return { url: flags.url || args[1] }
  case 'snapshot': return { verbose: toBoolean(flags.verbose, false) }
  case 'click': return { uid: flags.uid || args[1] }
  case 'fill': return { uid: flags.uid || args[1], text: flags.text || args[2] || '' }
  case 'open-link': return { uid: flags.uid || args[1] }
  case 'scroll': return { direction: flags.direction || args[1] || 'down', distance: Number(flags.distance || 500) }
  case 'tab': return { target: flags.target || args[1] || '0' }
  case 'proxy': return { action: args[1] || flags.action || 'status', reason: flags.reason || '' }
  case 'adblock': {
   const action = args[1] || flags.action || 'status'
   const patch = {
    enabled: flags.enabled !== undefined ? toBoolean(flags.enabled, true) : undefined,
    mode: flags.mode,
    blockUrlPatterns: flags.blockUrlPatterns ? parseList(flags.blockUrlPatterns) : undefined,
    allowlistDomains: flags.allowlistDomains ? parseList(flags.allowlistDomains) : undefined
   }
   return { action, mode: flags.mode, patch }
  }
  case 'fingerprint': return { config: safeJsonParse(flags.config, {}) || {} }
  case 'wait': return { ms: Number(flags.ms || args[1] || 0) }
  case 'extract': return { selector: flags.selector || args[1] || '' }
  case 'source': return { includeDoctype: toBoolean(flags.includeDoctype, true) }
  case 'eval': return { script: flags.script || args[1] || '' }
  case 'key': return { key: flags.key || args[1] || '' }
  case 'dialog': return { action: flags.action || args[1] || 'accept', promptText: flags.promptText || '' }
  case 'save': return { filename: flags.filename || args[1], content: flags.content || '', append: toBoolean(flags.append, false) }
  case 'read': return { filename: flags.filename || args[1] }
  case 'done': return { reason: flags.reason || args[1] || '' }
  default: return {}
 }
}

/**
 * Run CLI with given argv array.
 * @param {string[]} [argv] - Process arguments @param {object} [config] - Config overrides
 * @returns {Promise<number>} Exit code (0=success, 1=error)
 */
const runCli = async (argv = process.argv.slice(2), config = DEFAULT_CONFIG) => {
 const parsed = parseArgv(argv)
 if (!parsed.command || parsed.command === 'help' || parsed.command === '--help') {
  console.log(HELP_TEXT)
  return 0
 }

 const toolName = COMMAND_TO_TOOL[parsed.command]
 if (!toolName) {
  console.error(`${Colors.error}Unknown command: ${parsed.command}${Colors.reset}`)
  console.log(HELP_TEXT)
  return 1
 }

 const tools = createTools()
 const tool = tools[toolName]
 if (!tool) throw new Error(`Tool not implemented: ${toolName}`)

 const ctx = createAgentContext(config)
 const params = parseParams(parsed)
 const shouldInit = !['help', 'done'].includes(parsed.command)
 if (shouldInit && !ctx.browser) await ctx.init()

 try {
  const result = await tool.execute(ctx, params)
  console.log(JSON.stringify({ ok: true, tool: toolName, result }, null, 2))
  return 0
 } catch (error) {
  console.error(JSON.stringify({ ok: false, tool: toolName, error: error.message }, null, 2))
  return 1
 } finally {
  await ctx.close()
 }
}

export { runCli, COMMAND_TO_TOOL, decisionSignature, actionKeyForDecision, Colors }

