/** @param {number} ms - Delay in milliseconds @returns {Promise<void>} */
const sleep = ms => new Promise(resolve => setTimeout(resolve, Math.max(0, Number(ms) || 0)))

/** @param {*} value @param {boolean} [fallback=false] @returns {boolean} */
const toBoolean = (value, fallback = false) => {
 if (value === undefined || value === null) return fallback
 if (typeof value === 'boolean') return value
 const normalized = String(value).trim().toLowerCase()
 if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
 if (['0', 'false', 'no', 'off'].includes(normalized)) return false
 return fallback
}

/** @param {number} value @param {number} min @param {number} max @returns {number} */
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || min))

/** @param {string} str @param {number} [max=120] @returns {string} */
const truncate = (str, max = 120) => {
 const s = str === null || str === undefined ? '' : String(str)
 return s.length > max ? s.slice(0, max) + '\u2026' : s
}

/**
 * Parse CLI argv into args, flags and command.
 * @param {string[]} [argv=[]] @returns {{ args: string[], flags: Record<string, string|true>, command: string }}
 */
const parseArgv = (argv = []) => {
 const args = []
 const flags = {}
 for (let i = 0; i < argv.length; i++) {
  const token = argv[i]
  if (!token.startsWith('--')) {
   args.push(token)
   continue
  }
  const key = token.slice(2)
  const next = argv[i + 1]
  if (!next || next.startsWith('--')) {
   flags[key] = true
   continue
  }
  flags[key] = next
  i += 1
 }
 return { args, flags, command: args[0] || 'help' }
}

/** @param {string} value - Comma-separated string @returns {string[]} */
const parseList = value => String(value || '').split(',').map(v => v.trim()).filter(Boolean)

/** @param {string} value @param {*} [fallback=null] @returns {*} Parsed JSON or fallback */
const safeJsonParse = (value, fallback = null) => {
 if (!value || typeof value !== 'string') return fallback
 try { return JSON.parse(value) } catch { return fallback }
}

/**
 * Normalize URL: strip hash, return canonical form.
 * @param {string} url @returns {string}
 */
const normalizeUrl = (url) => {
 if (!url || typeof url !== 'string') return ''
 try { const u = new URL(url.trim()); u.hash = ''; return u.toString() } catch { return url.trim() }
}

/**
 * Create simple logger with colored prefixes.
 * @param {boolean} [silent=false] @returns {{ info: Function, warn: Function, error: Function, success: Function }}
 */
const createLogger = (silent = false) => ({
 info: (...parts) => { if (!silent) console.log('\x1b[36m[info]\x1b[0m', ...parts) },
 warn: (...parts) => { if (!silent) console.warn('\x1b[33m[warn]\x1b[0m', ...parts) },
 error: (...parts) => { if (!silent) console.error('\x1b[31m[error]\x1b[0m', ...parts) },
 success: (...parts) => { if (!silent) console.log('\x1b[32m[ok]\x1b[0m', ...parts) }
})

export { sleep, toBoolean, clamp, truncate, parseArgv, parseList, safeJsonParse, normalizeUrl, createLogger }

