/**
 * @fileoverview Core browser agent context: config, init, tab management, stealth, proxy, adblock.
 * @module xd-chrome-core
 */

import { chromium } from 'playwright'
import { createLogger, toBoolean } from './xd-chrome-helpers.js'
import { createAdblockManager } from './xd-chrome-extended/xd-extended-adblock.js'
import { ProxyManager } from './xd-chrome-extended/xd-extended-proxy.js'
import { createFingerprintManager } from './xd-chrome-extended/xd-extended-fingerprinting.js'
import { createBehaviorEmulator } from './xd-chrome-extended/xd-extended-behavior.js'
import { createStealthSessionManager } from './xd-chrome-extended/xd-extended-stealth.js'
import { xdStealthUtils } from './xd-chrome-extended/xd-extended-stealth-helpers.js'

/** @type {object} Default configuration merged with user overrides */
const DEFAULT_CONFIG = {
 browser: {
  headless: true,
  viewport: { width: 1280, height: 800 },
  slowMo: 0,
  timeout: 30000,
  useCDP: false,
  cdpEndpoint: 'http://localhost:9222'
 },
 proxy: { enabled: false, urls: [] },
 adblock: {
  enabled: true,
  mode: 'balanced',
  blockResourceTypes: { balanced: ['media'], aggressive: ['image', 'media', 'font'] },
  blockUrlPatterns: ['doubleclick.net', 'googlesyndication.com', 'googleadservices.com', 'taboola.com', 'outbrain.com', 'criteo.com'],
  allowlistDomains: []
 },
 stealth: { enabled: true, deviceType: 'desktop', browserType: 'chrome', behaviorProfile: 'stealth' }
}

/** Well-known cookie consent selectors */
const COOKIE_SELECTORS = [
 '#onetrust-accept-btn-handler',
 '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
 '#L2AGLb',
 '.osano-cm-accept-all',
 '[data-testid="cookie-policy-dialog-accept-button"]',
 '[data-testid="GDPR-accept"]',
 'button[data-cookiebanner="accept_button"]'
]

/**
 * Create agent context with browser lifecycle, proxy, adblock and stealth.
 * @param {object} [config={}] - User config overrides
 * @param {object} [opts={}] - Extra options (logger, page for pooled mode)
 * @returns {object} Agent context
 */
const createAgentContext = (config = {}, opts = {}) => {
 const cfg = {
  ...DEFAULT_CONFIG,
  ...config,
  browser: { ...DEFAULT_CONFIG.browser, ...(config.browser || {}) },
  proxy: { ...DEFAULT_CONFIG.proxy, ...(config.proxy || {}) },
  adblock: { ...DEFAULT_CONFIG.adblock, ...(config.adblock || {}) },
  stealth: { ...DEFAULT_CONFIG.stealth, ...(config.stealth || {}) }
 }
 const logger = opts.logger || createLogger(false)

 const ctx = {
  config: cfg,
  logger,
  browser: null,
  page: opts.page || null,
  pages: opts.page ? [opts.page] : [],
  currentPageIndex: 0,
  currentUrl: 'about:blank',
  lastSnapshot: null,
  visitedUrls: new Set(['about:blank']),
  _proxyManager: null,
  _proxyLaunchRaw: null,
  _ownership: opts.ownership || 'standalone',
  adblock: null,
  stealthSession: null,
  fingerprintManager: createFingerprintManager(),
  behaviorEmulator: createBehaviorEmulator(),
  stealthManager: null,
  cookieState: { lastUrl: '', attempts: 0 },
  step: 0,
  lastError: null
 }

 /** @param {string} url - Add URL to visited set */
 ctx.addVisitedUrl = url => { if (url) ctx.visitedUrls.add(url) }
 /** @returns {string[]} All visited URLs */
 ctx.getVisitedUrls = () => Array.from(ctx.visitedUrls)

 /**
  * Switch to tab by numeric index or URL substring.
  * @param {number|string} indexOrUrl
  * @returns {Promise<boolean>}
  */
 ctx.switchToTab = async (indexOrUrl) => {
  if (typeof indexOrUrl === 'number') {
   if (indexOrUrl < 0 || indexOrUrl >= ctx.pages.length) return false
   ctx.page = ctx.pages[indexOrUrl]
   ctx.currentPageIndex = indexOrUrl
   ctx.currentUrl = ctx.page.url()
   logger.info(`Switched to tab ${indexOrUrl + 1}/${ctx.pages.length}`)
   return true
  }
  const needle = String(indexOrUrl || '')
  const idx = ctx.pages.findIndex(p => {
   try { return p.url().includes(needle) } catch { return false }
  })
  if (idx < 0) return false
  return ctx.switchToTab(idx)
 }

 /**
  * Auto-dismiss common cookie consent banners.
  * @param {object} [options] @param {boolean} [options.force=false]
  * @returns {Promise<{handled: boolean, clicks: number}>}
  */
 ctx.handleCookiePolicy = async (options = {}) => {
  if (!ctx.page) return { handled: false, clicks: 0 }
  let currentUrl = ''
  try { currentUrl = ctx.page.url() } catch {}
  const urlKey = currentUrl.split('#')[0]
  if (!options.force && ctx.cookieState.lastUrl === urlKey && ctx.cookieState.attempts >= 1) {
   return { handled: false, clicks: 0, skipped: true }
  }
  if (ctx.cookieState.lastUrl !== urlKey) { ctx.cookieState.lastUrl = urlKey; ctx.cookieState.attempts = 0 }
  ctx.cookieState.attempts += 1
  let clicks = 0
  for (const sel of COOKIE_SELECTORS) {
   try {
    const loc = ctx.page.locator(sel).first()
    if ((await loc.count()) === 0) continue
    if (!(await loc.isVisible().catch(() => false))) continue
    await loc.click({ timeout: 800, force: true })
    clicks++
   } catch {}
  }
  if (clicks > 0) logger.info(`Cookie handler: ${clicks} banner(s) dismissed`)
  return { handled: clicks > 0, clicks }
 }

 /**
  * Initialize browser (standalone or CDP), set up stealth, adblock, tab listeners.
  * @returns {Promise<void>}
  */
 ctx.init = async () => {
  const launchOpts = {
   headless: toBoolean(cfg.browser.headless, true),
   slowMo: Number(cfg.browser.slowMo) || 0,
   args: ['--disable-blink-features=AutomationControlled', '--no-sandbox']
  }

  // CDP mode: connect to existing Chrome
  if (cfg.browser.useCDP) {
   logger.info('Connecting to Chrome via CDP...')
   ctx.browser = await chromium.connectOverCDP(cfg.browser.cdpEndpoint || 'http://localhost:9222')
   const contexts = ctx.browser.contexts()
   if (contexts.length > 0) {
    ctx.page = contexts[0].pages()[0] || await contexts[0].newPage()
   } else {
    const context = await ctx.browser.newContext({ viewport: xdStealthUtils.getViewportFromConfig(cfg) })
    ctx.page = await context.newPage()
   }
  } else {
   // Proxy setup
   if (cfg.proxy.enabled) {
    ctx._proxyManager = new ProxyManager(cfg.proxy.urls || [])
    const proxy = ctx._proxyManager.getNextProxy()
    if (proxy) {
     launchOpts.proxy = { server: proxy.server, username: proxy.username, password: proxy.password }
     ctx._proxyLaunchRaw = proxy.raw
     logger.info(`Proxy: ${proxy.server}`)
    } else {
     logger.warn('Proxy enabled but no available proxies')
    }
   }
   ctx.browser = await chromium.launch(launchOpts)
   ctx.page = await ctx.browser.newPage({ viewport: xdStealthUtils.getViewportFromConfig(cfg) })
  }

  ctx.pages = [ctx.page]
  ctx.currentPageIndex = 0
  ctx.currentUrl = ctx.page.url()

  // Adblock
  ctx.adblock = createAdblockManager(cfg.adblock, logger)
  await ctx.adblock.install(ctx.page.context())

  // Stealth session
  ctx.stealthManager = createStealthSessionManager({
   fingerprintManager: ctx.fingerprintManager,
   behaviorEmulator: ctx.behaviorEmulator
  })
  if (cfg.stealth.enabled !== false) {
   ctx.stealthSession = await ctx.stealthManager.createSession(ctx.page, cfg.stealth)
  }

  // Track new tabs
  ctx.page.context().on('page', newPage => {
   if (ctx.pages.includes(newPage)) return
   ctx.pages.push(newPage)
   logger.info(`New tab opened (${ctx.pages.length} tabs)`)
  })

  // Log page console errors
  ctx.page.on('console', msg => {
   if (msg.type() === 'error' || msg.type() === 'warning') {
    const text = msg.text()
    if (!text.includes('Third-party cookie') && !text.includes('preload')) {
     logger.warn(`Console ${msg.type()}: ${text.slice(0, 200)}`)
    }
   }
  })

  logger.success('Browser ready')
 }

 /**
  * Rotate proxy: report failure, close browser, re-init.
  * @returns {Promise<boolean>}
  */
 ctx.rotateBrowser = async () => {
  if (!ctx._proxyManager) return false
  if (ctx._proxyLaunchRaw) ctx._proxyManager.reportFailure(ctx._proxyLaunchRaw)
  logger.info('Rotating proxy — restarting browser...')
  await ctx.close()
  await ctx.init()
  return true
 }

 /**
  * Get live status for monitoring.
  * @returns {object}
  */
 ctx.getLiveStatus = () => ({
  step: ctx.step,
  url: ctx.currentUrl,
  tabs: ctx.pages.length,
  visitedCount: ctx.visitedUrls.size,
  adblock: ctx.adblock?.getStatus?.() || { enabled: false },
  lastError: ctx.lastError,
  ts: Date.now()
 })

 /** Close browser and cleanup. Pooled mode skips browser.close(). */
 ctx.close = async () => {
  if (ctx._ownership === 'pooled') {
   ctx.page = null; ctx.pages = []; return
  }
  if (ctx.browser) await ctx.browser.close()
  ctx.browser = null
  ctx.page = null
  ctx.pages = []
 }

 return ctx
}

export { createAgentContext, DEFAULT_CONFIG }

