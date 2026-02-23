/**
 * @fileoverview Fingerprint manager: generate, cache, and inject browser fingerprints.
 * @module xd-extended-fingerprinting
 */

import { STEALTH_CONFIG, xdStealthUtils } from './xd-extended-stealth-helpers.js'

/** User agent pools by device/browser type */
const XD_USER_AGENTS = {
 desktop: {
  chrome: [
   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
   'Mozilla/5.0 (Windows NT 11.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
   'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
   'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  ],
  firefox: [
   'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
   'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.4; rv:125.0) Gecko/20100101 Firefox/125.0'
  ],
  edge: [
   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0'
  ]
 },
 mobile: {
  chrome: [
   'Mozilla/5.0 (Linux; Android 14; Pixel 8 Pro) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
   'Mozilla/5.0 (Linux; Android 14; SM-S928B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36'
  ],
  safari: [
   'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1'
  ]
 }
}

/**
 * Create fingerprint manager with generation, caching and page injection.
 * @returns {{generate: Function, getCurrent: Function, injectIntoPage: Function}}
 */
const createFingerprintManager = () => {
 const state = { current: null, lastUpdate: 0 }

 /** @param {string} ua @returns {string} Platform string derived from UA */
 const extractPlatform = (ua) => {
  if (ua.includes('Windows')) return 'Win32'
  if (ua.includes('Macintosh')) return 'MacIntel'
  if (ua.includes('Android')) return 'Linux armv8l'
  return 'Linux x86_64'
 }

 /** Simple string hash → base36 */
 const hash = (value) => {
  let result = 0
  for (let i = 0; i < value.length; i++) result = ((result << 5) - result) + value.charCodeAt(i)
  return Math.abs(result).toString(36)
 }

 /**
  * Generate new fingerprint.
  * @param {object} [config={}] @param {string} [config.deviceType='desktop'] @param {string} [config.browserType='chrome']
  * @returns {object} Fingerprint with userAgent, platform, screen, viewport, hash, etc.
  */
 const generate = (config = {}) => {
  const deviceType = config.deviceType || 'desktop'
  const browserType = config.browserType || 'chrome'
  const uaPool = XD_USER_AGENTS[deviceType]?.[browserType] || XD_USER_AGENTS.desktop.chrome
  const userAgent = xdStealthUtils.randomChoice(uaPool)
  const screen = deviceType === 'mobile'
   ? { width: 390, height: 844, devicePixelRatio: 3 }
   : { width: xdStealthUtils.randomChoice([1920, 2560, 1440]), height: 1080, devicePixelRatio: 1 }
  const viewport = { width: Math.max(320, screen.width - 80), height: Math.max(320, screen.height - 120) }
  const fingerprint = {
   userAgent, deviceType, browserType,
   platform: extractPlatform(userAgent),
   timezone: xdStealthUtils.randomChoice(STEALTH_CONFIG.TIMEZONES),
   languages: ['en-US', 'en'],
   webgl: { vendor: xdStealthUtils.randomChoice(STEALTH_CONFIG.WEBGL_VENDORS), renderer: `WebGL ${xdStealthUtils.randomInt(1, 2)}.${xdStealthUtils.randomInt(0, 9)}` },
   hardware: { concurrency: deviceType === 'mobile' ? 8 : xdStealthUtils.randomChoice([8, 12, 16]), memory: deviceType === 'mobile' ? 8 : 16, maxTouchPoints: deviceType === 'mobile' ? 5 : 0 },
   screen, viewport,
   hash: hash(`${userAgent}|${screen.width}x${screen.height}|${viewport.width}x${viewport.height}`),
   generatedAt: Date.now()
  }
  state.current = fingerprint
  state.lastUpdate = Date.now()
  return fingerprint
 }

 /** @returns {object} Current fingerprint (auto-regenerates if expired) */
 const getCurrent = () => {
  if (!state.current || Date.now() - state.lastUpdate > STEALTH_CONFIG.FINGERPRINT_UPDATE_INTERVAL) return generate()
  return state.current
 }

 /**
  * Inject fingerprint overrides into page via addInitScript.
  * @param {import('playwright').Page} page @param {object} [fingerprint]
  */
 const injectIntoPage = async (page, fingerprint = state.current) => {
  if (!page || !fingerprint) return
  await page.addInitScript((fp) => {
   Object.defineProperty(navigator, 'userAgent', { get: () => fp.userAgent })
   Object.defineProperty(navigator, 'platform', { get: () => fp.platform })
   Object.defineProperty(navigator, 'languages', { get: () => fp.languages })
   Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => fp.hardware.concurrency })
   Object.defineProperty(navigator, 'webdriver', { get: () => false })
  }, fingerprint)
 }

 return { generate, getCurrent, injectIntoPage }
}

export { createFingerprintManager }

