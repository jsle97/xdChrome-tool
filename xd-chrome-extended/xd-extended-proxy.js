/**
 * @fileoverview Proxy manager with failure tracking, auto-banning, and rotation.
 * @module xd-extended-proxy
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'

/** Failures within this window count toward ban */
const FAIL_THRESHOLD = 3
/** @type {number} 1 hour failure window */
const FAIL_WINDOW_MS = 60 * 60 * 1000
/** @type {number} 12 hour ban duration */
const BAN_DURATION_MS = 12 * 60 * 60 * 1000

/**
 * Proxy manager with round-robin rotation, failure tracking, and persistent bans.
 * @param {string[]} cfgUrls - Proxy URLs (protocol://user:pass@host:port)
 * @param {string} [dataDir='./data_arch'] - Directory for persisting ban state
 */
class ProxyManager {
 constructor (cfgUrls = [], dataDir = './data_arch') {
  this._allUrls = [...new Set((Array.isArray(cfgUrls) ? cfgUrls : []).map(v => String(v || '').trim()).filter(Boolean))]
  this._index = 0
  this._current = null
  /** @type {Record<string, number[]>} Recent failure timestamps per proxy */
  this._failures = {}
  this._state = { banned: {}, lastRotation: 0 }
  this._bansFile = join(dataDir, 'proxies.json')
  this._load()
  this._shuffle()
 }

 /** Fisher-Yates shuffle to randomize initial order */
 _shuffle () {
  const arr = this._allUrls
  for (let i = arr.length - 1; i > 0; i--) {
   const j = Math.floor(Math.random() * (i + 1))
   ;[arr[i], arr[j]] = [arr[j], arr[i]]
  }
 }

 /** Load ban state from disk, clean expired bans */
 _load () {
  try {
   if (existsSync(this._bansFile)) {
    this._state = JSON.parse(readFileSync(this._bansFile, 'utf-8'))
    if (!this._state.banned) this._state.banned = {}
   }
  } catch {}
  // Clean expired bans on load
  const now = Date.now()
  for (const [url, ban] of Object.entries(this._state.banned)) {
   if (ban.expiresAt && ban.expiresAt <= now) delete this._state.banned[url]
  }
 }

 /** Persist ban state to disk */
 save () {
  try {
   mkdirSync(dirname(this._bansFile), { recursive: true })
   writeFileSync(this._bansFile, JSON.stringify(this._state, null, 2), 'utf-8')
  } catch {}
 }

 /** @param {string} url @returns {boolean} Whether proxy is currently banned */
 _isBanned (url) {
  const ban = this._state.banned[url]
  if (!ban) return false
  if (Date.now() >= ban.expiresAt) { delete this._state.banned[url]; return false }
  return true
 }

 /**
  * Parse proxy URL into components.
  * @param {string} raw @returns {{raw: string, server: string, username: string, password: string}|null}
  */
 _parseProxy (raw) {
  try {
   const parsed = new URL(raw)
   return {
    raw,
    server: `${parsed.protocol}//${parsed.host}`,
    username: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password)
   }
  } catch { return null }
 }

 /** @returns {object|null} Next available proxy (round-robin), or null if all banned */
 getNextProxy () {
  const available = this._allUrls.filter(url => !this._isBanned(url))
  if (!available.length) return null
  this._index = (this._index + 1) % available.length
  this._current = available[this._index]
  this._state.lastRotation = Date.now()
  return this._parseProxy(this._current)
 }

 /** @returns {object|null} Currently active parsed proxy */
 getCurrentProxy () {
  if (!this._current) return null
  return this._parseProxy(this._current)
 }

 /** @returns {string|null} Raw URL of current proxy */
 getCurrentProxyUrl () { return this._current }

 /**
  * Report proxy failure. Bans proxy after FAIL_THRESHOLD failures within window.
  * @param {string} proxyUrl @returns {boolean} true if proxy was banned
  */
 reportFailure (proxyUrl) {
  if (!proxyUrl) return false
  const now = Date.now()
  if (!this._failures[proxyUrl]) this._failures[proxyUrl] = []
  this._failures[proxyUrl].push(now)
  this._failures[proxyUrl] = this._failures[proxyUrl].filter(ts => now - ts < FAIL_WINDOW_MS)
  if (this._failures[proxyUrl].length < FAIL_THRESHOLD) return false
  this._state.banned[proxyUrl] = { bannedAt: now, expiresAt: now + BAN_DURATION_MS, failures: this._failures[proxyUrl].length }
  delete this._failures[proxyUrl]
  this.save()
  return true
 }

 /** @param {string} proxyUrl - Clear failure history on success */
 reportSuccess (proxyUrl) {
  if (!proxyUrl) return
  delete this._failures[proxyUrl]
 }

 /** @returns {{total: number, available: number, banned: number}} Pool stats */
 getStats () {
  const now = Date.now()
  const banned = Object.values(this._state.banned).filter(b => b.expiresAt > now).length
  return { total: this._allUrls.length, available: this._allUrls.length - banned, banned }
 }
}

export { ProxyManager }
