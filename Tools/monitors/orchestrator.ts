#!/usr/bin/env bun

/**
 * orchestrator.ts — Main entry point for Ladder autonomous engine
 *
 * Runs all monitors in sequence, then the advancer, then reports.
 *
 * Usage:
 *   bun run Tools/monitors/orchestrator.ts [--dry-run]
 *
 * The orchestrator:
 * 1. Runs ralph-monitor (queries Ralph API for trading patterns)
 * 2. Runs polytrader-monitor (reads Polytrader SQLite for calibration data)
 * 3. Runs advancer (promotes Sources -> Ideas -> Hypotheses)
 * 4. Reports summary and logs results
 */

import { resolve, join } from "path";
import { writeFile, mkdir, readdir } from "fs/promises";
import { existsSync } from "fs";
import { notifyTelegram } from "./shared";

const ROOT = resolve(import.meta.dir, "../..");
const LOGS_DIR = join(import.meta.dir, "logs");
const dryRun = process.argv.includes("--dry-run");

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const CYAN = "\x1b[36m";

// ── Pipeline counting ───────────────────────────────────

async function countDir(dir: string, prefix: string): Promise<number> {
  const fullDir = join(ROOT, dir);
  if (!existsSync(fullDir)) return 0;
  const files = await readdir(fullDir);
  return files.filter((f) => f.startsWith(prefix) && f.endsWith(".md") && f !== "TEMPLATE.md" && f !== "README.md").length;
}

async function countPipeline() {
  const [sources, ideas, hypotheses, experiments, results, algorithms] = await Promise.all([
    countDir("Sources", "SR-"),
    countDir("Ideas", "ID-"),
    countDir("Hypotheses", "HY-"),
    countDir("Experiments", "EX-"),
    countDir("Results", "RE-"),
    countDir("Algorithms", "AL-"),
  ]);
  return { sources, ideas, hypotheses, experiments, results, algorithms };
}

// ── Main ────────────────────────────────────────────────

async function main() {
  const startTime = Date.now();

  console.log(`\n${BOLD}╔═══════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}║       LADDER AUTONOMOUS ENGINE            ║${RESET}`);
  console.log(`${BOLD}╚═══════════════════════════════════════════╝${RESET}`);
  console.log(`${DIM}${new Date().toISOString()}${RESET}`);
  if (dryRun) console.log(`${YELLOW}DRY RUN — no files will be created${RESET}`);
  console.log();

  // Ensure logs directory exists
  if (!existsSync(LOGS_DIR)) await mkdir(LOGS_DIR, { recursive: true });

  // Snapshot pipeline counts before monitors run
  const beforeCounts = await countPipeline();

  const summary = {
    timestamp: new Date().toISOString(),
    dryRun,
    ralph: { ran: false, findings: 0, submitted: 0, error: null as string | null },
    polytrader: { ran: false, findings: 0, submitted: 0, error: null as string | null },
    advancer: { ran: false, newIdeas: 0, newHypotheses: 0, error: null as string | null },
    duration_ms: 0,
  };

  // ── Phase 1: Ralph Monitor ──────────────────────────

  console.log(`${BOLD}━━━ Phase 1: Ralph Trades Monitor ━━━${RESET}`);
  try {
    const args = dryRun ? ["--dry-run"] : [];
    const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "ralph-monitor.ts"), ...args], {
      stdout: "inherit",
      stderr: "inherit",
      cwd: ROOT,
    });
    const exitCode = await proc.exited;
    summary.ralph.ran = true;
    if (exitCode !== 0) {
      summary.ralph.error = `Exit code: ${exitCode}`;
    }
  } catch (e) {
    summary.ralph.error = String(e);
    console.log(`  ${YELLOW}⚠ Ralph monitor failed: ${e}${RESET}\n`);
  }

  // ── Phase 2: Polytrader Monitor ─────────────────────

  console.log(`${BOLD}━━━ Phase 2: Polytrader Monitor ━━━${RESET}`);
  try {
    const args = dryRun ? ["--dry-run"] : [];
    const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "polytrader-monitor.ts"), ...args], {
      stdout: "inherit",
      stderr: "inherit",
      cwd: ROOT,
    });
    const exitCode = await proc.exited;
    summary.polytrader.ran = true;
    if (exitCode !== 0) {
      summary.polytrader.error = `Exit code: ${exitCode}`;
    }
  } catch (e) {
    summary.polytrader.error = String(e);
    console.log(`  ${YELLOW}⚠ Polytrader monitor failed: ${e}${RESET}\n`);
  }

  // ── Phase 3: Pipeline Advancer ──────────────────────

  console.log(`${BOLD}━━━ Phase 3: Pipeline Advancer ━━━${RESET}`);
  try {
    const args = dryRun ? ["--dry-run"] : [];
    const proc = Bun.spawn(["bun", "run", join(import.meta.dir, "advancer.ts"), ...args], {
      stdout: "inherit",
      stderr: "inherit",
      cwd: ROOT,
    });
    const exitCode = await proc.exited;
    summary.advancer.ran = true;
    if (exitCode !== 0) {
      summary.advancer.error = `Exit code: ${exitCode}`;
    }
  } catch (e) {
    summary.advancer.error = String(e);
    console.log(`  ${YELLOW}⚠ Advancer failed: ${e}${RESET}\n`);
  }

  // ── Phase 4: Pipeline Status ────────────────────────

  console.log(`${BOLD}━━━ Phase 4: Pipeline Status ━━━${RESET}`);
  const statusProc = Bun.spawn(["bun", "run", join(ROOT, "Tools/cli.ts"), "status"], {
    stdout: "inherit",
    stderr: "inherit",
    cwd: ROOT,
  });
  await statusProc.exited;

  // ── Summary ─────────────────────────────────────────

  summary.duration_ms = Date.now() - startTime;

  // Count current pipeline entries
  const counts = await countPipeline();

  console.log(`\n${BOLD}╔═══════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}║              RUN SUMMARY                  ║${RESET}`);
  console.log(`${BOLD}╚═══════════════════════════════════════════╝${RESET}`);
  console.log(`  ${DIM}Duration:${RESET} ${(summary.duration_ms / 1000).toFixed(1)}s`);
  console.log(`  ${DIM}Ralph:${RESET}     ${summary.ralph.ran ? (summary.ralph.error ? `${YELLOW}⚠ ${summary.ralph.error}${RESET}` : `${GREEN}✓${RESET}`) : `${DIM}skipped${RESET}`}`);
  console.log(`  ${DIM}Polytrader:${RESET} ${summary.polytrader.ran ? (summary.polytrader.error ? `${YELLOW}⚠ ${summary.polytrader.error}${RESET}` : `${GREEN}✓${RESET}`) : `${DIM}skipped${RESET}`}`);
  console.log(`  ${DIM}Advancer:${RESET}  ${summary.advancer.ran ? (summary.advancer.error ? `${YELLOW}⚠ ${summary.advancer.error}${RESET}` : `${GREEN}✓${RESET}`) : `${DIM}skipped${RESET}`}`);
  console.log(`  ${DIM}Pipeline:${RESET}  SR:${counts.sources} → ID:${counts.ideas} → HY:${counts.hypotheses} → EX:${counts.experiments} → RE:${counts.results}`);
  console.log();

  // Save summary log
  if (!dryRun) {
    const logTimestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const logPath = join(LOGS_DIR, `${logTimestamp}_orchestrator.json`);
    await writeFile(logPath, JSON.stringify({ ...summary, pipeline: counts }, null, 2), "utf-8");
    console.log(`  ${DIM}Log: ${logPath}${RESET}`);
  }

  // ── Telegram Notification ───────────────────────────
  // Only notify when there's actual progress (new entries created)

  const newSources = counts.sources - beforeCounts.sources;
  const newIdeas = counts.ideas - beforeCounts.ideas;
  const newHypotheses = counts.hypotheses - beforeCounts.hypotheses;
  const totalNew = newSources + newIdeas + newHypotheses;

  if (totalNew > 0 && !dryRun) {
    const parts: string[] = [];
    if (newSources > 0) parts.push(`${newSources} source${newSources > 1 ? "s" : ""}`);
    if (newIdeas > 0) parts.push(`${newIdeas} idea${newIdeas > 1 ? "s" : ""}`);
    if (newHypotheses > 0) parts.push(`${newHypotheses} hypothes${newHypotheses > 1 ? "es" : "is"}`);

    const msg = [
      `🪜 <b>Ladder Progress</b>`,
      ``,
      `New: ${parts.join(", ")}`,
      `Pipeline: ${counts.sources}→${counts.ideas}→${counts.hypotheses}→${counts.experiments}→${counts.results}`,
      ``,
      `<code>bun run ladder list all</code> for details`,
    ].join("\n");

    const sent = await notifyTelegram(msg);
    if (sent) {
      console.log(`  ${GREEN}✓${RESET} Telegram notification sent`);
    }
  } else if (totalNew === 0 && !dryRun) {
    console.log(`  ${DIM}No new entries — skipping Telegram notification${RESET}`);
  }

  console.log();
}

await main();
