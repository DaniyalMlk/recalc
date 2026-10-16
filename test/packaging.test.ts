/**
 * What `npm publish` would actually ship.
 *
 * The rest of the suite reaches into `../src`, which is exactly the view that
 * cannot see a packaging mistake: the entry points, the file list, the
 * distribution name and the shebang are all invisible to it. Four real
 * defects lived here behind 1,913 green tests — the distribution name was
 * taken on the registry, `repository` was absent (which npm trusted
 * publishing requires to match), nothing rebuilt before packing, and sixty
 * source maps shipped pointing at `src/` paths the tarball does not contain.
 *
 * So these tests read the manifest and ask `npm pack` what the tarball holds.
 * `npm pack --dry-run` fires `prepack`, so the answers describe a fresh build
 * rather than whatever was lying in `dist`.
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface Manifest {
  readonly name: string;
  readonly version: string;
  readonly license: string;
  readonly main: string;
  readonly types: string;
  readonly bin: Record<string, string>;
  readonly files: readonly string[];
  readonly engines: Record<string, string>;
  readonly repository: { readonly type: string; readonly url: string };
  readonly exports: Record<string, Record<string, string>>;
  readonly scripts: Record<string, string>;
}

const manifest = JSON.parse(
  readFileSync(resolve(root, "package.json"), "utf8"),
) as Manifest;

interface Packed {
  readonly name: string;
  readonly version: string;
  readonly files: readonly { readonly path: string }[];
}

const packed: Packed = (() => {
  const output = execFileSync(
    "npm",
    ["pack", "--dry-run", "--json", "--silent"],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
  );
  return (JSON.parse(output) as readonly Packed[])[0]!;
})();

const shipped = new Set(packed.files.map((file) => file.path));

describe("the manifest", () => {
  it("publishes under the distribution name, not the taken one", () => {
    // `recalc` on npm is an unrelated package. The import specifier is the
    // distribution name on this registry, so it has to differ; the binary
    // does not, and stays `recalc`.
    expect(manifest.name).toBe("recalc-formula");
    expect(Object.keys(manifest.bin)).toEqual(["recalc"]);
  });

  it("declares an entry point for every way in", () => {
    expect(manifest.main).toBe("./dist/index.js");
    expect(manifest.types).toBe("./dist/index.d.ts");
    expect(manifest.exports["."]!["import"]).toBe("./dist/index.js");
    expect(manifest.exports["."]!["types"]).toBe("./dist/index.d.ts");
  });

  it("builds before it packs, not only before it publishes", () => {
    // Without this, `npm pack` tars up whatever is in dist, which may predate
    // the commit being packed.
    expect(manifest.scripts["prepack"]).toBe("npm run build");
    expect(manifest.scripts["build"]).toBe("tsc -p tsconfig.build.json");
  });

  it("points the repository at this repository, exactly", () => {
    // npm trusted publishing compares this against the publishing workflow's
    // repository and refuses the publish if they differ. Note that it is the
    // repository name, `recalc`, not the distribution name.
    expect(manifest.repository.url).toBe(
      "git+https://github.com/DaniyalMlk/recalc.git",
    );
  });

  it("claims a licence the repository actually carries", () => {
    expect(manifest.license).toBe("MIT");
    expect(readFileSync(resolve(root, "LICENSE"), "utf8")).toContain(
      "MIT License",
    );
  });

  it("names a Node floor that supports the build it ships", () => {
    expect(manifest.engines["node"]).toBe(">=20.19.0");
  });
});

describe("the tarball", () => {
  it("is this package at this version", () => {
    expect(packed.name).toBe(manifest.name);
    expect(packed.version).toBe(manifest.version);
  });

  it("carries both entry points and the executable", () => {
    expect(shipped).toContain("dist/index.js");
    expect(shipped).toContain("dist/index.d.ts");
    for (const target of Object.values(manifest.bin)) {
      expect(shipped).toContain(target);
    }
  });

  it("carries no source maps", () => {
    // `files` is ["dist"], so a map that ships points at a src/ path the
    // tarball does not contain. Sixty of them did.
    const maps = [...shipped].filter((path) => path.endsWith(".map"));
    expect(maps).toEqual([]);
  });

  it("carries no tests, sources or build configuration", () => {
    // Declarations end in .ts and are the point of `types`, so they are
    // excluded from the source check rather than caught by it.
    const leaked = [...shipped].filter(
      (path) =>
        path.startsWith("src/") ||
        path.startsWith("test/") ||
        path.startsWith("bench/") ||
        path.startsWith("web/") ||
        path.startsWith("tsconfig") ||
        (path.endsWith(".ts") && !path.endsWith(".d.ts")),
    );
    expect(leaked).toEqual([]);
  });

  it("carries declarations beside the code they describe", () => {
    const declarations = [...shipped].filter((path) => path.endsWith(".d.ts"));
    expect(declarations.length).toBeGreaterThan(40);
    for (const declaration of declarations) {
      expect(shipped).toContain(declaration.replace(/\.d\.ts$/, ".js"));
    }
  });

  it("ships nothing from outside dist but the three metadata files", () => {
    const stray = [...shipped].filter(
      (path) =>
        !path.startsWith("dist/") &&
        !["package.json", "README.md", "LICENSE"].includes(path),
    );
    expect(stray).toEqual([]);
  });
});

describe("the executable", () => {
  it("starts with a shebang in the built output", () => {
    // Without it the file is handed to the shell, which reads the first
    // import statement as a command. Asserted on the build, since the build
    // is what gets installed.
    const built = readFileSync(resolve(root, "dist/cli.js"), "utf8");
    expect(built.startsWith("#!/usr/bin/env node\n")).toBe(true);
  });

  it("evaluates a formula from the built output", () => {
    // The CLI is a REPL, so it is driven over stdin rather than by a flag.
    const printed = execFileSync(
      process.execPath,
      [resolve(root, "dist/cli.js")],
      { input: "A1 = 6\nA2 = 7\nB1 = =A1*A2\nB1\n", encoding: "utf8" },
    );
    expect(printed).toContain("42");
    expect(printed).toContain("=A1*A2");
  });
});
