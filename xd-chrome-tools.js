/**
 * @fileoverview Tool implementations for xd-chrome browser agent.
 * Each tool exposes `{ execute(ctx, params) }` bound to its schema.
 * @module xd-chrome-tools
 */

import { ToolsSchema } from './xd-chrome-tools-schema.js'
import { sleep } from './xd-chrome-helpers.js'
import { writeFile, mkdir } from 'fs/promises'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

const MAX_CONTENT_LENGTH = 164000

/**
 * Create DOM snapshot by querying interactive elements.
 * @param {import('playwright').Page} page
 * @param {boolean} [verbose=false] - Include more elements
 * @returns {Promise<{elements: object[], text: string}>}
 */
const createSnapshot = async (page, verbose = false) => {
 const elements = await page.evaluate((wantVerbose) => {
  const selectors = [
   'a[href]', 'button', 'input', 'textarea', 'select',
   '[role="button"]', '[role="link"]', '[role="textbox"]'
  ]
  const esc = value => {
   if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value)
   return String(value).replace(/([^a-zA-Z0-9_-])/g, '\\$1')
  }
  const visible = el => {
   const r = el.getBoundingClientRect()
   if (r.width === 0 || r.height === 0) return false
   const s = window.getComputedStyle(el)
   return s.visibility !== 'hidden' && s.display !== 'none'
  }
  const nodes = Array.from(new Set(selectors.flatMap(sel => Array.from(document.querySelectorAll(sel))))).filter(visible).slice(0, wantVerbose ? 300 : 120)
  return nodes.map((el, idx) => {
   const role = el.getAttribute('role') || el.tagName.toLowerCase()
   const text = (el.getAttribute('aria-label') || el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 80)
   const id = el.id ? `#${esc(el.id)}` : ''
   const name = el.getAttribute('name') ? `[name="${String(el.getAttribute('name')).replace(/"/g, '\\"')}"]` : ''
   const selector = id || `${el.tagName.toLowerCase()}${name}`
   return { id: `el_${idx}`, selector, role, name: text, href: el.getAttribute('href') || null }
  })
 }, Boolean(verbose))
 const text = elements.map(el => `${el.id} [${el.role}] ${el.name || ''}`.trim()).join('\n')
 return { elements, text }
}

/**
 * Build tool registry from schema + function implementations.
 * @returns {Record<string, {name: string, description: string, schema: object, execute: Function}>}
 */
const createTools = () => {
 /** @type {Record<string, (ctx: object, params: object) => Promise<object>>} */
 const fnc = {
  /** Initialize browser if not already running. */
  init: async (ctx) => {
   if (!ctx.browser) await ctx.init()
   return { success: true, status: 'initialized' }
  },

  /** Close browser and cleanup. */
  close: async (ctx) => {
   await ctx.close()
   return { success: true, status: 'closed' }
  },

  /**
   * Navigate to URL with tunnel-fail retry and auto-snapshot.
   * @param {object} ctx @param {{url: string}} params
   */
  navigate: async (ctx, params) => {
   if (!ctx.page) await ctx.init()
   const targetUrl = params.url
   const timeout = ctx.config.browser.timeout || 30000

   const attemptGoto = () => ctx.page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout })

   try {
    await attemptGoto()
   } catch (navErr) {
    const msg = navErr?.message || ''
    if (msg.includes('ERR_TUNNEL_CONNECTION_FAILED') && ctx.rotateBrowser) {
     ctx.logger.warn('Tunnel failed, rotating proxy...')
     const rotated = await ctx.rotateBrowser()
     if (rotated) await attemptGoto()
     else throw navErr
    } else { throw navErr }
   }

   await sleep(500)
   ctx.currentUrl = ctx.page.url()
   ctx.addVisitedUrl(ctx.currentUrl)
   if (ctx._proxyManager && ctx._proxyLaunchRaw) ctx._proxyManager.reportSuccess(ctx._proxyLaunchRaw)

   // Auto-snapshot after navigation
   const snap = await createSnapshot(ctx.page, false)
   ctx.lastSnapshot = snap
   return { success: true, url: ctx.currentUrl, snapshot: snap.text, elementCount: snap.elements.length }
  },

  /** Take DOM snapshot of interactive elements. */
  snapshot: async (ctx, params) => {
   const snap = await createSnapshot(ctx.page, params?.verbose)
   ctx.lastSnapshot = snap
   return { success: true, elementCount: snap.elements.length, snapshot: snap.text }
  },

  /**
   * Click element with multi-strategy fallback (selector → role → text → JS click).
   * @param {object} ctx @param {{uid: string}} params
   */
  click: async (ctx, params) => {
   const item = ctx.lastSnapshot?.elements?.find(el => el.id === params.uid)
   if (!item) throw new Error(`Element not found in snapshot: ${params.uid}`)

   const urlBefore = ctx.page.url()
   const tabsBefore = ctx.pages.length

   // Try primary selector
   let clicked = false
   const locator = ctx.page.locator(item.selector).first()
   try {
    await locator.scrollIntoViewIfNeeded({ timeout: 2000 }).catch(() => {})
    await locator.click({ timeout: 5000, force: true })
    clicked = true
   } catch {
    // Fallback: role+name
    if (item.role && item.name) {
     try {
      await ctx.page.getByRole(item.role, { name: item.name, exact: false }).first().click({ timeout: 3000, force: true })
      clicked = true
     } catch {}
    }
    // Fallback: text match
    if (!clicked && item.name) {
     try {
      await ctx.page.getByText(item.name, { exact: false }).first().click({ timeout: 3000, force: true })
      clicked = true
     } catch {}
    }
    // Fallback: JS click
    if (!clicked) {
     try {
      await locator.evaluate(el => el.click())
      clicked = true
     } catch (err) { throw new Error(`All click strategies failed for ${params.uid}: ${err.message}`) }
    }
   }

   await sleep(500)
   // Handle new tab auto-switch
   const tabsAfter = ctx.pages.length
   const newTabOpened = tabsAfter > tabsBefore
   if (newTabOpened) {
    await ctx.switchToTab(tabsAfter - 1)
   }

   ctx.currentUrl = ctx.page.url()
   ctx.addVisitedUrl(ctx.currentUrl)

   // If URL didn't change and element is a link, fallback to direct navigation
   if (ctx.currentUrl === urlBefore && item.role === 'link' && item.href) {
    try {
     const resolved = new URL(item.href, ctx.page.url()).toString()
     await ctx.page.goto(resolved, { waitUntil: 'domcontentloaded', timeout: ctx.config.browser.timeout || 30000 })
     await sleep(400)
     ctx.currentUrl = ctx.page.url()
     ctx.addVisitedUrl(ctx.currentUrl)
    } catch {}
   }

   ctx.lastSnapshot = null
   return { success: true, clicked: params.uid, newTabOpened, url: ctx.currentUrl }
  },

  /**
   * Fill input with optional stealth typing emulation.
   * @param {object} ctx @param {{uid: string, text: string}} params
   */
  fill: async (ctx, params) => {
   const item = ctx.lastSnapshot?.elements?.find(el => el.id === params.uid)
   if (!item) throw new Error(`Element not found in snapshot: ${params.uid}`)
   if (ctx.stealthSession?.emulateTyping) {
    await ctx.stealthSession.emulateTyping(item.selector, params.text)
   } else {
    const locator = item.selector
     ? ctx.page.locator(item.selector).first()
     : ctx.page.getByRole('textbox', { name: item.name }).first()
    await locator.fill(params.text, { timeout: 5000 })
   }
   return { success: true, uid: params.uid, textLength: String(params.text || '').length }
  },

  /** Open link by resolving href and navigating directly. */
  openLink: async (ctx, params) => {
   const item = ctx.lastSnapshot?.elements?.find(el => el.id === params.uid)
   if (!item) throw new Error(`Element not found in snapshot: ${params.uid}`)
   let href = item.href
   if (!href) {
    // Attempt to find href in DOM
    href = await ctx.page.evaluate(sel => {
     try { const el = document.querySelector(sel); return el?.href || el?.getAttribute('href') || null } catch { return null }
    }, item.selector)
   }
   if (!href) throw new Error(`Element has no href: ${params.uid}`)
   if (href.startsWith('javascript:')) throw new Error('Cannot navigate to javascript: href')
   const resolved = new URL(href, ctx.page.url()).toString()
   await ctx.page.goto(resolved, { waitUntil: 'domcontentloaded', timeout: ctx.config.browser.timeout || 30000 })
   await sleep(400)
   ctx.currentUrl = ctx.page.url()
   ctx.addVisitedUrl(ctx.currentUrl)
   return { success: true, url: ctx.currentUrl }
  },

  /** Scroll page with optional stealth emulation. */
  scroll: async (ctx, params = {}) => {
   const direction = params.direction || 'down'
   const distance = params.distance || 500
   if (direction === 'bottom') {
    await ctx.page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
   } else if (ctx.stealthSession?.emulateScroll) {
    await ctx.stealthSession.emulateScroll(distance, direction)
   } else {
    await ctx.page.mouse.wheel(0, direction === 'up' ? -distance : distance)
   }
   await sleep(300)
   ctx.lastSnapshot = null
   return { success: true, direction }
  },

  /** Switch to tab by index or URL fragment. */
  switchToTab: async (ctx, params) => {
   const value = String(params.target || '')
   const index = Number.parseInt(value, 10)
   const ok = Number.isNaN(index) ? await ctx.switchToTab(value) : await ctx.switchToTab(index)
   if (!ok) {
    const tabInfo = ctx.pages.map((p, i) => { try { return `${i}: ${p.url()}` } catch { return `${i}: unknown` } })
    throw new Error(`Tab not found: ${params.target}. Available:\n${tabInfo.join('\n')}`)
   }
   return { success: true, index: ctx.currentPageIndex, url: ctx.currentUrl, totalTabs: ctx.pages.length }
  },

  /** Check proxy status or rotate proxy/browser session. */
  proxyControl: async (ctx, params) => {
   const action = params.action
   if (action === 'status') {
    return { success: true, enabled: !!ctx._proxyManager, stats: ctx._proxyManager?.getStats?.() || { total: 0, available: 0, banned: 0 } }
   }
   if (action === 'rotate') {
    if (!ctx._proxyManager) throw new Error('Proxy manager unavailable')
    if (params.reason) ctx.logger.info(`Proxy rotate: ${params.reason}`)
    const rotated = await ctx.rotateBrowser()
    if (!rotated) throw new Error('Proxy rotation failed')
    return { success: true, rotated: true, url: ctx.currentUrl, stats: ctx._proxyManager.getStats() }
   }
   throw new Error(`Unknown proxy action: ${action}`)
  },

  /** Adblock control: status/enable/disable/setMode/updateConfig/resetStats. */
  adblockControl: async (ctx, params) => {
   const action = params.action
   if (!ctx.adblock || typeof ctx.adblock.getStatus !== 'function') throw new Error('Adblock not initialized')
   if (action === 'status') return { success: true, ...ctx.adblock.getStatus() }
   if (action === 'enable') return { success: true, ...(await ctx.adblock.setEnabled(true)) }
   if (action === 'disable') return { success: true, ...(await ctx.adblock.setEnabled(false)) }
   if (action === 'setMode') return { success: true, ...(await ctx.adblock.setMode(params.mode || 'balanced')) }
   if (action === 'updateConfig') return { success: true, ...(await ctx.adblock.updateConfig(params.patch || {})) }
   if (action === 'resetStats') return { success: true, ...ctx.adblock.resetStats() }
   throw new Error(`Unknown adblock action: ${action}`)
  },

  /** Wait for given milliseconds. */
  wait: async (_ctx, params) => {
   await sleep(params.ms)
   return { success: true, waited: params.ms }
  },

  /**
   * Extract readable text content from page, stripping nav/footer/scripts.
   * @param {object} ctx @param {{selector?: string}} params
   */
  extractContent: async (ctx, params) => {
   const selector = (typeof params?.selector === 'string' && params.selector.trim()) || 'body'
   const content = await ctx.page.evaluate(sel => {
    const target = document.querySelector(sel) || document.body
    const clone = target.cloneNode(true)
    for (const tag of ['script', 'style', 'nav', 'header', 'footer', 'aside', 'noscript']) {
     clone.querySelectorAll(tag).forEach(el => el.remove())
    }
    const getText = node => {
     if (node.nodeType === Node.TEXT_NODE) return node.textContent.trim()
     if (node.nodeType === Node.ELEMENT_NODE) return Array.from(node.childNodes).map(getText).filter(Boolean).join(' ')
     return ''
    }
    return getText(clone).replace(/\s+/g, ' ').trim()
   }, selector)
   const truncated = content.length > MAX_CONTENT_LENGTH
   return { success: true, content: truncated ? content.substring(0, MAX_CONTENT_LENGTH) + '\n... (truncated)' : content, length: content.length, truncated }
  },

  /** Get raw HTML source of current page. */
  getSource: async (ctx, params) => {
   const rawHtml = await ctx.page.content()
   const html = params?.includeDoctype !== false ? `<!DOCTYPE html>\n${rawHtml}` : rawHtml
   const truncated = html.length > MAX_CONTENT_LENGTH
   return { success: true, url: ctx.page.url(), source: truncated ? html.substring(0, MAX_CONTENT_LENGTH) + '\n<!-- truncated -->' : html, length: html.length, truncated }
  },

  /** Execute arbitrary JS in page context. */
  evaluate_script: async (ctx, params) => {
   const script = String(params.script || '').trim()
   if (!script) throw new Error('script is required')
   const result = await ctx.page.evaluate(async ({ userScript }) => {
    const fn = new Function(`return (async () => { ${userScript} })();`)
    return await fn()
   }, { userScript: script })
   const serialized = typeof result === 'string' ? result : JSON.stringify(result)
   return { success: true, result, preview: (serialized || String(result)).slice(0, 2000) }
  },

  /** Press keyboard key. */
  press_key: async (ctx, params) => {
   const key = String(params.key || '').trim()
   if (!key) throw new Error('key is required')
   await ctx.page.keyboard.press(key)
   await sleep(200)
   ctx.currentUrl = ctx.page.url()
   ctx.addVisitedUrl(ctx.currentUrl)
   return { success: true, key }
  },

  /** Handle browser dialog (alert/confirm/prompt). */
  handle_dialog: async (ctx, params) => {
   const action = String(params.action || '').toLowerCase()
   if (!['accept', 'dismiss'].includes(action)) throw new Error('action must be accept or dismiss')
   return new Promise(resolve => {
    const timer = setTimeout(() => {
     ctx.page.removeListener('dialog', onDialog)
     resolve({ success: false, handled: false, reason: 'No dialog within timeout' })
    }, 2000)
    const onDialog = async dialog => {
     clearTimeout(timer)
     try {
      if (action === 'accept') await dialog.accept(String(params.promptText ?? ''))
      else await dialog.dismiss()
      resolve({ success: true, handled: true, dialogType: dialog.type(), message: dialog.message(), action })
     } catch (err) { resolve({ success: false, handled: false, error: err.message }) }
    }
    ctx.page.once('dialog', onDialog)
   })
  },

  /** Save content to results directory. */
  saveResult: async (ctx, params) => {
   const resultsDir = join(process.cwd(), 'results')
   await mkdir(resultsDir, { recursive: true })
   const safeName = (params.filename || 'result.md').replace(/[^a-zA-Z0-9_.\-]/g, '_').slice(0, 100)
   const filepath = join(resultsDir, safeName)
   const body = params.content || ''
   if (params.append && existsSync(filepath)) {
    const existing = readFileSync(filepath, 'utf-8')
    await writeFile(filepath, `${existing}\n\n---\n\n${body}`, 'utf-8')
   } else {
    await writeFile(filepath, body, 'utf-8')
   }
   return { success: true, filepath: `results/${safeName}`, length: body.length, appended: !!params.append }
  },

  /** Read previously saved result file. */
  readResult: async (_ctx, params) => {
   const safeName = (params.filename || '').replace(/[^a-zA-Z0-9_.\-]/g, '_').slice(0, 100)
   const filepath = join(process.cwd(), 'results', safeName)
   if (!existsSync(filepath)) throw new Error(`File not found: ${safeName}`)
   const content = readFileSync(filepath, 'utf-8')
   const truncated = content.length > MAX_CONTENT_LENGTH
   return { success: true, filename: safeName, content: truncated ? content.substring(0, MAX_CONTENT_LENGTH) + '\n... (truncated)' : content, length: content.length, truncated }
  },

  /** Signal task completion. */
  done: async (_ctx, params) => {
   return { done: true, reason: params.reason }
  },

  /** Generate and inject browser fingerprint. */
  generateFingerprint: async (ctx, params) => {
   const fingerprint = ctx.fingerprintManager.generate(params.config || {})
   if (ctx.page) await ctx.fingerprintManager.injectIntoPage(ctx.page, fingerprint)
   return { success: true, hash: fingerprint.hash, userAgent: fingerprint.userAgent, platform: fingerprint.platform }
  },

  /** Detect stealth issues (webdriver, plugins, etc). */
  detectStealthIssues: async (ctx) => {
   if (!ctx.page) return { success: false, error: 'No page available' }
   const issues = []
   try {
    const props = await ctx.page.evaluate(() => ({
     webdriver: navigator.webdriver, plugins: navigator.plugins.length,
     languages: navigator.languages, platform: navigator.platform
    }))
    if (props.webdriver !== false && props.webdriver !== undefined) issues.push({ type: 'webdriver', severity: 'high', message: 'Webdriver property detected' })
    if (props.plugins < 3) issues.push({ type: 'plugins', severity: 'medium', message: `Low plugin count: ${props.plugins}` })
   } catch (err) { issues.push({ type: 'evaluation', severity: 'high', message: err.message }) }
   return { success: true, issues, timestamp: new Date().toISOString() }
  },

  /** Rotate behavior profile for stealth. */
  rotateBehaviorProfile: async (ctx) => {
   const profile = ctx.behaviorEmulator.rotateProfile()
   return { success: true, profile, metrics: ctx.behaviorEmulator.getBehaviorMetrics() }
  }
 }

 /** @type {Record<string, object>} */
 const registry = {}
 for (const [name, schema] of Object.entries(ToolsSchema)) {
  if (fnc[name]) registry[name] = { ...schema, execute: fnc[name] }
 }
 return registry
}

export { createTools, createSnapshot }

