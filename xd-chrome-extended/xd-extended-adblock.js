/**
 * @fileoverview Adblock manager with request interception, LRU stats, multi-context support.
 * @module xd-extended-adblock
 */

/** @param {*} value @returns {string[]} Normalized lowercase array */
const normalizeArray = value => (Array.isArray(value) ? value : []).map(v => String(v || '').trim().toLowerCase()).filter(Boolean)

/** @param {string} mode @returns {'balanced'|'aggressive'} */
const normalizeMode = mode => String(mode || 'balanced').toLowerCase() === 'aggressive' ? 'aggressive' : 'balanced'

/** @param {string} value @returns {string} Cleaned domain */
const normalizeDomain = value => String(value || '').trim().toLowerCase().replace(/^\*\./, '').replace(/\.+$/, '')

/** @param {string} host @param {string} domain @returns {boolean} */
const hostMatchesDomain = (host, domain) => {
 const h = normalizeDomain(host), d = normalizeDomain(domain)
 return !!(h && d && (h === d || h.endsWith(`.${d}`)))
}

/**
 * Simple LRU map for tracking blocked hosts.
 * @param {number} [maxSize=500] @returns {object}
 */
const createLRUMap = (maxSize = 500) => {
 const map = new Map()
 return {
  get: key => map.get(key),
  inc: key => {
   const next = (map.get(key) || 0) + 1
   if (map.has(key)) map.delete(key)
   else if (map.size >= maxSize) { const k = map.keys().next().value; if (k !== undefined) map.delete(k) }
   map.set(key, next); return next
  },
  entries: () => Array.from(map.entries()),
  clear: () => map.clear()
 }
}

/**
 * Create adblock manager with request interception.
 * @param {object} [initialConfig={}] - Adblock configuration
 * @param {object} [logger=console] - Logger instance
 * @returns {object} Manager API: install, uninstall, setMode, setEnabled, updateConfig, resetStats, getStatus
 */
const createAdblockManager = (initialConfig = {}, logger = console) => {
 const config = {
  enabled: true,
  mode: 'balanced',
  blockResourceTypes: { balanced: ['media'], aggressive: ['image', 'media', 'font'] },
  blockUrlPatterns: ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'taboola.com', 'outbrain.com', 'criteo.com', 'adnxs.com'],
  allowlistDomains: [],
  logEveryBlocked: 25,
  ...initialConfig
 }

 const installedContexts = new Map()
 let stats = { blocked: 0, allowed: 0, blockedByType: {}, blockedByHost: createLRUMap(500) }

 /** Build optimized lookup cache from current config */
 const buildCache = () => {
  const mode = normalizeMode(config.mode)
  const allPatterns = normalizeArray(config.blockUrlPatterns || [])
  const domainPatterns = allPatterns.filter(p => !p.includes('/') && !p.includes('?'))
  const urlPatterns = allPatterns.filter(p => p.includes('/') || p.includes('?'))
  return {
   enabled: config.enabled !== false, mode,
   blockedTypes: new Set(normalizeArray(config.blockResourceTypes?.[mode] || [])),
   domainPatterns: domainPatterns.map(normalizeDomain),
   urlPatterns,
   allowlistDomains: normalizeArray(config.allowlistDomains || []).map(normalizeDomain)
  }
 }

 let cache = buildCache()

 /** @param {import('playwright').Request} request @returns {{block: boolean, host?: string, resourceType?: string, blockRule?: string}} */
 const evaluate = request => {
  const url = String(request.url() || '').toLowerCase()
  if (!cache.enabled || !url || url.startsWith('data:') || url.startsWith('blob:') || url.startsWith('about:')) return { block: false }
  let host = ''
  try { host = normalizeDomain(new URL(url).hostname) } catch {}
  if (host && cache.allowlistDomains.some(d => hostMatchesDomain(host, d))) return { block: false }
  const resourceType = String(request.resourceType() || '').toLowerCase()
  if (cache.blockedTypes.has(resourceType)) return { block: true, host, resourceType, blockRule: `type:${resourceType}` }
  if (resourceType !== 'document') {
   const matchDomain = cache.domainPatterns.find(p => hostMatchesDomain(host, p))
   if (matchDomain) return { block: true, host, resourceType, blockRule: `domain:${matchDomain}` }
   const matchUrl = cache.urlPatterns.find(p => url.includes(p))
   if (matchUrl) return { block: true, host, resourceType, blockRule: `pattern:${matchUrl}` }
  }
  return { block: false }
 }

 /** @param {import('playwright').Route} route */
 const handler = async route => {
  const decision = evaluate(route.request())
  if (!decision.block) { stats.allowed += 1; return route.continue() }
  stats.blocked += 1
  if (decision.host) stats.blockedByHost.inc(decision.host)
  if (decision.resourceType) stats.blockedByType[decision.resourceType] = (stats.blockedByType[decision.resourceType] || 0) + 1
  if (stats.blocked % (config.logEveryBlocked || 25) === 0) {
   logger.info?.(`Adblock: blocked=${stats.blocked} allowed=${stats.allowed} mode=${cache.mode}`)
  }
  try { await route.abort('blockedbyclient') } catch { await route.abort() }
 }

 /** @param {import('playwright').BrowserContext} browserContext @returns {Promise<boolean>} */
 const install = async browserContext => {
  if (!browserContext || installedContexts.has(browserContext)) return true
  const bound = route => handler(route)
  await browserContext.route('**/*', bound)
  installedContexts.set(browserContext, bound)
  logger.info?.(`Adblock installed (${cache.mode})`)
  return true
 }

 /** @param {import('playwright').BrowserContext} browserContext @returns {Promise<boolean>} */
 const uninstall = async browserContext => {
  if (!browserContext || !installedContexts.has(browserContext)) return false
  const bound = installedContexts.get(browserContext)
  await browserContext.unroute('**/*', bound)
  installedContexts.delete(browserContext)
  return true
 }

 /** Reinstall handler on all tracked contexts (after config change) */
 const reinstallAll = async () => {
  for (const context of Array.from(installedContexts.keys())) {
   try { await uninstall(context); await install(context) } catch {}
  }
 }

 /** @param {object} patch @returns {Promise<object>} Updated status */
 const updateConfig = async patch => {
  Object.assign(config, patch || {})
  cache = buildCache()
  await reinstallAll()
  return getStatus()
 }

 const setMode = async mode => updateConfig({ mode: normalizeMode(mode) })
 const setEnabled = async enabled => updateConfig({ enabled: Boolean(enabled) })

 const resetStats = () => {
  stats = { blocked: 0, allowed: 0, blockedByType: {}, blockedByHost: createLRUMap(500) }
  return getStatus()
 }

 /** @returns {object} Current adblock status with stats */
 const getStatus = () => {
  const topHosts = stats.blockedByHost.entries().sort((a, b) => b[1] - a[1]).slice(0, 10).map(([host, count]) => ({ host, count }))
  return {
   enabled: cache.enabled, mode: cache.mode,
   rules: { blockResourceTypes: config.blockResourceTypes, blockUrlPatterns: config.blockUrlPatterns, allowlistDomains: config.allowlistDomains },
   stats: { blocked: stats.blocked, allowed: stats.allowed, blockedByType: { ...stats.blockedByType }, topBlockedHosts: topHosts }
  }
 }

 return { install, uninstall, setMode, setEnabled, updateConfig, resetStats, getStatus }
}

export { createAdblockManager }

