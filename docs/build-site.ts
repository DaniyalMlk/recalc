/**
 * Write the site out, and put the built demo next to it.
 *
 * One line of work and a copy, kept apart from `docs/site.ts` so that the
 * generator itself touches no filesystem and the tests can call it directly.
 * The demo is expected to be built already — `npm run build:web` — because
 * bundling is the bundler's job and this script should not have an opinion
 * about how it was done.
 */

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSite, DEMO } from "./site.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "site");
const WEB = join(ROOT, "web", "dist");

// Cleared rather than written over: a page the generator no longer produces
// should not survive in the published site because it was there last time.
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

for (const [name, content] of buildSite()) {
  writeFileSync(join(OUT, name), content, "utf8");
}

if (!existsSync(WEB)) {
  process.stderr.write(
    `the demo has not been built: ${WEB} is missing — run \`npm run build:web\` first\n`,
  );
  process.exit(1);
}
cpSync(WEB, join(OUT, DEMO), { recursive: true });

process.stdout.write(
  `site: ${[...buildSite().keys()].join(", ")} and the demo under ${DEMO}\n`,
);
