/**
 * The entry point for `npm run evidence`.
 *
 * Separate from `evidence.ts` so that importing the measurements — which the
 * tests do, to pin the README to them — does not run them and exit.
 */
import { report } from "./evidence.js";

process.exitCode = report();
