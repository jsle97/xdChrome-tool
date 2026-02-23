#!/usr/bin/env node
/**
 * @fileoverview xd-chrome entry point. Runs CLI with process argv.
 * @module xd-chrome
 */

import { runCli } from './xd-chrome-cli.js'

/** Launch CLI, exit with returned code. */
const main = async () => {
 const code = await runCli(process.argv.slice(2))
 process.exit(code)
}

if (import.meta.url === `file://${process.argv[1]}`) {
 main().catch(error => {
  console.error(error?.stack || error?.message || String(error))
  process.exit(1)
 })
}

export { main }

