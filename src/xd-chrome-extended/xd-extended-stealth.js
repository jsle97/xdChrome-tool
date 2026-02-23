/**
 * @fileoverview Stealth session manager: binds fingerprint, behavior, and detection per page.
 * @module xd-extended-stealth
 */

import { createFingerprintManager } from './xd-extended-fingerprinting.js'
import { createBehaviorEmulator } from './xd-extended-behavior.js'

/**
 * Create stealth session manager.
 * @param {object} [deps={}]
 * @param {object} [deps.fingerprintManager] - Fingerprint manager instance
 * @param {object} [deps.behaviorEmulator] - Behavior emulator instance
 * @returns {{createSession: Function, getSessionMetrics: Function, closeSession: Function, detectStealthIssues: Function}}
 */
const createStealthSessionManager = ({ fingerprintManager, behaviorEmulator } = {}) => {
 const fp = fingerprintManager || createFingerprintManager()
 const behavior = behaviorEmulator || createBehaviorEmulator()
 /** @type {Map<string, object>} Active sessions */
 const sessions = new Map()

 /**
  * Create a new stealth session for a page.
  * @param {import('playwright').Page} page
  * @param {object} [config={}] @param {string} [config.behaviorProfile='stealth']
  * @returns {Promise<object>} Session with emulateTyping, emulateScroll, rotateProfile, etc.
  */
 const createSession = async (page, config = {}) => {
  const id = config.sessionId || `xd-stealth-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  const fingerprint = fp.generate(config)
  behavior.setProfile(config.behaviorProfile || 'stealth')
  await fp.injectIntoPage(page, fingerprint)
  const session = {
   id, page, fingerprint,
   behaviorProfile: config.behaviorProfile || 'stealth',
   createdAt: new Date(), lastActivity: new Date(),
   metrics: { pageLoads: 0, fingerprintChanges: 0 }
  }
  sessions.set(id, session)
  return {
   ...session,
   /** @param {string} selector @param {string} text */
   emulateTyping: (selector, text) => behavior.emulateTyping(page, selector, text),
   /** @param {number} distance @param {string} direction */
   emulateScroll: (distance, direction) => behavior.emulateScroll(page, distance, direction),
   rotateProfile: () => behavior.rotateProfile(),
   detectStealthIssues: () => detectStealthIssues(page),
   getMetrics: () => getSessionMetrics(id),
   close: () => closeSession(id)
  }
 }

 /** @param {string} sessionId @returns {object|null} */
 const getSessionMetrics = (sessionId) => {
  const session = sessions.get(sessionId)
  if (!session) return null
  return {
   ...session.metrics,
   behaviorProfile: behavior.getBehaviorMetrics().profile,
   fingerprintHash: session.fingerprint.hash
  }
 }

 /** @param {string} sessionId @returns {boolean} */
 const closeSession = (sessionId) => {
  sessions.delete(sessionId)
  return true
 }

 /**
  * Detect stealth issues on a page (webdriver, plugin count, etc).
  * @param {import('playwright').Page} page
  * @returns {Promise<{issues: object[], timestamp: string}>}
  */
 const detectStealthIssues = async (page) => {
  if (!page) return { issues: [] }
  const issues = []
  try {
   const navProps = await page.evaluate(() => ({
    webdriver: navigator.webdriver,
    plugins: navigator.plugins.length,
    languages: navigator.languages,
    platform: navigator.platform
   }))
   if (navProps.webdriver !== false && navProps.webdriver !== undefined) {
    issues.push({ type: 'webdriver', severity: 'high', message: 'Webdriver property detected' })
   }
   if (navProps.plugins < 3) {
    issues.push({ type: 'plugins', severity: 'medium', message: `Low plugin count: ${navProps.plugins}` })
   }
  } catch (error) {
   issues.push({ type: 'evaluation', severity: 'high', message: error.message })
  }
  return { issues, timestamp: new Date().toISOString() }
 }

 return { createSession, getSessionMetrics, closeSession, detectStealthIssues }
}

export { createStealthSessionManager }

