/**
 * @fileoverview Stealth configuration constants and utility functions.
 * @module xd-extended-stealth-helpers
 */

/** @type {object} Timing and data constants for stealth operations */
const STEALTH_CONFIG = {
 /** @type {number} 5 min - regenerate fingerprint interval */
 FINGERPRINT_UPDATE_INTERVAL: 5 * 60 * 1000,
 /** @type {number} 10 min - behavior profile switch interval */
 BEHAVIOR_SWITCH_INTERVAL: 10 * 60 * 1000,
 MAX_CANVAS_NOISE_INTENSITY: 0.15,
 MIN_CANVAS_NOISE_INTENSITY: 0.02,
 WEBGL_VENDORS: ['Intel Inc.', 'NVIDIA Corporation', 'AMD', 'Apple', 'Microsoft', 'ARM', 'Qualcomm'],
 TIMEZONES: ['Europe/Warsaw', 'Europe/London', 'Europe/Paris', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo']
}

/** Stealth utility functions */
const xdStealthUtils = {
 /** @param {number} min @param {number} max @returns {number} Random int in [min, max] */
 randomInt: (min, max) => Math.floor(Math.random() * (max - min + 1)) + min,
 /** @param {Array} arr @returns {*} Random element */
 randomChoice: arr => arr[Math.floor(Math.random() * arr.length)],
 /**
  * Weighted random choice.
  * @param {Array} items @param {number[]} weights @returns {*}
  */
 weightedChoice: (items, weights) => {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = Math.random() * total
  for (let i = 0; i < items.length; i++) { if (r < weights[i]) return items[i]; r -= weights[i] }
  return items[items.length - 1]
 },
 /** @returns {number} Unique seed based on time + random */
 generateSeed: () => Date.now() + Math.floor(Math.random() * 1000000),
 /** @param {Function} fn @returns {Function} Memoized version */
 memoize: (fn) => {
  const cache = new Map()
  return (...args) => { const k = JSON.stringify(args); if (cache.has(k)) return cache.get(k); const r = fn(...args); cache.set(k, r); return r }
 },
 /** @param {object} config @returns {{width: number, height: number}} Viewport from config */
 getViewportFromConfig: (config) => ({
  width: config?.browser?.viewport?.width || 1280,
  height: config?.browser?.viewport?.height || 800
 })
}

export { STEALTH_CONFIG, xdStealthUtils }

