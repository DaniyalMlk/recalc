#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { ParseError } from "./engine/errors.js";
import { ReplSession, paint } from "./repl.js";
import type { FileAccess } from "./repl.js";

const BOLD = "\u001b[1m";
const DIM = "\u001b[2m";
const RED = "\u001b[31m";

/** The shell is the only place the engine touches the filesystem. */
const files: FileAccess = {
  read: (path) => readFileSync(path, "utf8"),
  write: (path, text) => writeFileSync(path, text, "utf8"),
};

function run(): void {
  const session = new ReplSession(files);
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
    prompt: paint(BOLD, "recalc> "),
  });

  process.stdout.write(
    `${paint(BOLD, "recalc")} ${paint(DIM, "- type .help for commands, .demo for a worked model")}\n`,
  );
  rl.prompt();

  rl.on("line", (raw: string) => {
    const line = raw.trim();
    if (line === "") {
      rl.prompt();
      return;
    }

    try {
      const output = session.handle(line);
      if (output === ReplSession.QUIT) {
        rl.close();
        return;
      }
      if (output !== null) process.stdout.write(`${output}\n`);
    } catch (error) {
      if (error instanceof ParseError) {
        process.stdout.write(`${paint(RED, error.annotate())}\n`);
      } else {
        process.stdout.write(
          `${paint(RED, error instanceof Error ? error.message : String(error))}\n`,
        );
      }
    }

    rl.prompt();
  });

  rl.on("close", () => {
    process.stdout.write("\n");
    process.exit(0);
  });
}

run();
