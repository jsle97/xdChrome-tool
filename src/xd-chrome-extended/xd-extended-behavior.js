/**
 * @fileoverview Human-like behavior emulation: typing delays, scroll pauses, profile rotation.
 * @module xd-extended-behavior
 */

import { STEALTH_CONFIG, xdStealthUtils } from './xd-extended-stealth-helpers.js'
import { sleep } from '../xd-chrome-helpers.js'

/**
 * Create behavior emulator with multiple profiles (stealth/casual/researcher).
 * @returns {{setProfile: Function, rotateProfile: Function, shouldSwitchProfile: Function, emulateTyping: Function, emulateScroll: Function, getBehaviorMetrics: Function}}
 */
const createBehaviorEmulator = () => {
 /** @type {Record<string, {clickDelay: {min: number, max: number}, typeDelay: {min: number, max: number}, scrollPause: {min: number, max: number}}>} */
 const profiles = {
  stealth: { clickDelay: { min: 250, max: 1100 }, typeDelay: { min: 50, max: 140 }, scrollPause: { min: 80, max: 320 } },
  casual: { clickDelay: { min: 450, max: 1800 }, typeDelay: { min: 70, max: 180 }, scrollPause: { min: 120, max: 450 } },
  researcher: { clickDelay: { min: 800, max: 2600 }, typeDelay: { min: 80, max: 200 }, scrollPause: { min: 150, max: 600 } }
 }

 let currentProfile = 'stealth'
 let lastSwitch = 0

 /** @param {string} name @returns {boolean} */
 const setProfile = (name) => {
  if (!profiles[name]) return false
  currentProfile = name
  lastSwitch = Date.now()
  return true
 }

 /** @returns {string} New active profile name */
 const rotateProfile = () => {
  const keys = Object.keys(profiles)
  const idx = keys.indexOf(currentProfile)
  const next = keys[(idx + 1) % keys.length]
  setProfile(next)
  return next
 }

 /** @returns {boolean} Whether enough time has passed for a profile switch */
 const shouldSwitchProfile = () => Date.now() - lastSwitch > STEALTH_CONFIG.BEHAVIOR_SWITCH_INTERVAL

 /**
  * Emulate human-like typing with per-character delays.
  * @param {import('playwright').Page} page @param {string} selector @param {string} text
  */
 const emulateTyping = async (page, selector, text) => {
  if (!page || !selector) return
  const p = profiles[currentProfile]
  await page.click(selector)
  for (const char of String(text || '')) {
   await page.keyboard.type(char)
   await sleep(xdStealthUtils.randomInt(p.typeDelay.min, p.typeDelay.max))
  }
 }

 /**
  * Emulate human-like scrolling with pause after.
  * @param {import('playwright').Page} page @param {number} [distance=500] @param {string} [direction='down']
  */
 const emulateScroll = async (page, distance = 500, direction = 'down') => {
  if (!page) return
  const p = profiles[currentProfile]
  const amount = Math.max(10, Number(distance) || 500)
  const sign = direction === 'up' ? -1 : 1
  await page.mouse.wheel(0, sign * amount)
  await sleep(xdStealthUtils.randomInt(p.scrollPause.min, p.scrollPause.max))
 }

 /** @returns {{profile: string, sinceSwitchMs: number}} */
 const getBehaviorMetrics = () => ({
  profile: currentProfile,
  sinceSwitchMs: Date.now() - lastSwitch
 })

 return { setProfile, rotateProfile, shouldSwitchProfile, emulateTyping, emulateScroll, getBehaviorMetrics }
}

export { createBehaviorEmulator }

