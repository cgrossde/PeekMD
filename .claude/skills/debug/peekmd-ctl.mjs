#!/usr/bin/env node
import { runCli } from './peekmd-client.mjs';

const result = await runCli(process.argv.slice(2));
process.exitCode = result.ok ? 0 : 1;
