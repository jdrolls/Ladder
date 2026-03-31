#!/usr/bin/env bun

/**
 * ralph-monitor.ts — Autonomous monitor for Ralph Trades v5.1
 *
 * Queries Ralph's Hono API (localhost:4000) for:
 * - Winner production rate changes (week-over-week)
 * - Instrument dead zones (zero winners after many runs)
 * - Strategy-instrument heatmap anomalies
 *
 * Submits findings as Sources to the Ladder pipeline.
 *
 * Usage:
 *   bun run Tools/monitors/ralph-monitor.ts [--dry-run]
 */

import { type Finding, isDuplicate, markSubmitted, loadLedger, saveLedger, submitSource, logRun, fmt } from "./shared";

const RALPH_API = process.env.RALPH_API_URL || "http://localhost:4000";
const DEAD_ZONE_THRESHOLD = 500; // runs without a winner = dead zone
const WINNER_RATE_CHANGE_THRESHOLD = 0.20; // 20% change triggers finding

const dryRun = process.argv.includes("--dry-run");

// ── API Helpers ─────────────────────────────────────────

async function fetchApi<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${RALPH_API}${path}`, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) return null;
    return await res.json() as T;
  } catch {
    return null;
  }
}

interface Stats {
  total_runs: number;
  total_winners: number;
  runs_today: number;
  winners_today: number;
  [key: string]: unknown;
}

interface HeatmapEntry {
  strategy_type_id: number;
  instrument_id: number;
  instrument_symbol?: string;
  strategy_name?: string;
  total_runs: number;
  pass_count: number;
  avg_sharpe: number;
  avg_profit_factor?: number;
  [key: string]: unknown;
}

interface Winner {
  id: string;
  strategy_type_id: number;
  instrument_id: number;
  instrument_symbol?: string;
  sharpe_ratio: number;
  profit_factor: number;
  status: string;
  created_at: string;
  [key: string]: unknown;
}

// ── Analysis ────────────────────────────────────────────

async function analyzeWinnerRate(): Promise<Finding[]> {
  const stats = await fetchApi<Stats>("/api/stats");
  if (!stats) return [];

  const findings: Finding[] = [];
  const winRate = stats.total_runs > 0 ? stats.total_winners / stats.total_runs : 0;

  // Check for very low overall win rate
  if (stats.total_runs > 1000 && winRate < 0.001) {
    findings.push({
      title: `Ralph overall winner rate critically low: ${(winRate * 100).toFixed(3)}%`,
      detail: `After ${stats.total_runs} total runs, only ${stats.total_winners} winners found (${(winRate * 100).toFixed(3)}%). Discovery engine may need parameter space expansion or strategy type additions.`,
      type: "telemetry",
      domain: "algorithmic-trading",
      tags: ["ralph-trades", "winner-rate", "discovery-efficiency", "automated"],
      potentialIdeas: [
        "Expand parameter search ranges for underexplored strategy types",
        "Add new strategy type variants to increase coverage",
        "Analyze whether winner criteria are too strict for current market regime",
      ],
    });
  }

  // Check for zero winners today with significant runs
  if (stats.runs_today > 100 && stats.winners_today === 0) {
    findings.push({
      title: `Ralph zero winners today despite ${stats.runs_today} runs`,
      detail: `${stats.runs_today} runs completed today with zero winners. Could indicate market regime shift, overly strict filters, or exhausted search space.`,
      type: "telemetry",
      domain: "algorithmic-trading",
      tags: ["ralph-trades", "daily-performance", "automated"],
      potentialIdeas: [
        "Check if market volatility regime has shifted recently",
        "Review winner filter thresholds against current market conditions",
        "Analyze whether Thompson Sampling is stuck in local optima",
      ],
    });
  }

  return findings;
}

async function analyzeHeatmap(): Promise<Finding[]> {
  const heatmap = await fetchApi<HeatmapEntry[]>("/api/heatmap");
  if (!heatmap || heatmap.length === 0) return [];

  const findings: Finding[] = [];

  // Find dead zones — instruments with many runs but zero winners
  const byInstrument = new Map<number, { runs: number; wins: number; symbol: string }>();

  for (const entry of heatmap) {
    const existing = byInstrument.get(entry.instrument_id) || { runs: 0, wins: 0, symbol: entry.instrument_symbol || `ID:${entry.instrument_id}` };
    existing.runs += entry.total_runs;
    existing.wins += entry.pass_count;
    byInstrument.set(entry.instrument_id, existing);
  }

  const deadZones: string[] = [];
  for (const [id, data] of byInstrument) {
    if (data.runs >= DEAD_ZONE_THRESHOLD && data.wins === 0) {
      deadZones.push(`${data.symbol} (${data.runs} runs, 0 winners)`);
    }
  }

  if (deadZones.length > 0) {
    findings.push({
      title: `Ralph instrument dead zones detected: ${deadZones.length} instruments`,
      detail: `Instruments with ${DEAD_ZONE_THRESHOLD}+ runs and zero winners: ${deadZones.join(", ")}. Compute spent on these instruments may be wasted.`,
      type: "telemetry",
      domain: "algorithmic-trading",
      tags: ["ralph-trades", "dead-zones", "instrument-selection", "automated"],
      potentialIdeas: [
        "Deprioritize dead zone instruments in Thompson Sampling weights",
        "Investigate if dead zone instruments have structural characteristics preventing profitability",
        "Implement periodic re-evaluation of dead zones in case market regimes change",
      ],
    });
  }

  // Find strategy-instrument pairs with high run count but low Sharpe
  const underperformers = heatmap
    .filter((e) => e.total_runs > 200 && e.avg_sharpe < 0.5 && e.pass_count === 0)
    .sort((a, b) => b.total_runs - a.total_runs)
    .slice(0, 5);

  if (underperformers.length >= 3) {
    const details = underperformers.map((e) =>
      `${e.strategy_name || e.strategy_type_id}×${e.instrument_symbol || e.instrument_id}: ${e.total_runs} runs, avg Sharpe ${e.avg_sharpe.toFixed(2)}`
    ).join("; ");

    findings.push({
      title: `Ralph ${underperformers.length} strategy-instrument pairs consistently underperforming`,
      detail: `Top underperformers by run count with zero wins: ${details}. These combinations consistently fail to produce winners.`,
      type: "telemetry",
      domain: "algorithmic-trading",
      tags: ["ralph-trades", "strategy-optimization", "heatmap", "automated"],
      potentialIdeas: [
        "Block these specific strategy-instrument combinations from future evaluation",
        "Analyze if these strategies work on other instruments to isolate the problem",
        "Check if parameter ranges for these strategies need instrument-specific tuning",
      ],
    });
  }

  return findings;
}

async function analyzeRecentWinners(): Promise<Finding[]> {
  const winners = await fetchApi<Winner[]>("/api/winners");
  if (!winners || winners.length === 0) return [];

  const findings: Finding[] = [];

  // Check for clustering — lots of winners on same instrument
  const byInstrument = new Map<string, number>();
  const recentWinners = winners.filter((w) => {
    const created = new Date(w.created_at);
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    return created > weekAgo;
  });

  for (const w of recentWinners) {
    const key = w.instrument_symbol || String(w.instrument_id);
    byInstrument.set(key, (byInstrument.get(key) || 0) + 1);
  }

  const hotInstruments = Array.from(byInstrument.entries())
    .filter(([_, count]) => count >= 3)
    .sort((a, b) => b[1] - a[1]);

  if (hotInstruments.length > 0) {
    const details = hotInstruments.map(([sym, count]) => `${sym}: ${count} winners`).join(", ");
    findings.push({
      title: `Ralph winner clustering on ${hotInstruments.length} instruments this week`,
      detail: `${recentWinners.length} winners this week, concentrated on: ${details}. Consider allocating more compute to hot instruments.`,
      type: "telemetry",
      domain: "algorithmic-trading",
      tags: ["ralph-trades", "winner-clustering", "resource-allocation", "automated"],
      potentialIdeas: [
        "Dynamically shift Thompson Sampling weights toward hot instruments",
        "Analyze whether clustering indicates favorable market conditions or exhausted search space",
        "Test if hot instrument strategies generalize to correlated instruments",
      ],
    });
  }

  return findings;
}

// ── Main ────────────────────────────────────────────────

async function main(): Promise<Finding[]> {
  console.log(`\n${fmt.BOLD}Ralph Trades Monitor${fmt.RESET}`);
  console.log(`${fmt.DIM}API: ${RALPH_API}${fmt.RESET}\n`);

  // Check API reachability
  const stats = await fetchApi<Stats>("/api/stats");
  if (!stats) {
    console.log(`  ${fmt.YELLOW}⚠ Ralph API not reachable at ${RALPH_API}${fmt.RESET}`);
    console.log(`  ${fmt.DIM}Skipping Ralph monitoring this cycle${fmt.RESET}\n`);
    return [];
  }

  console.log(`  ${fmt.DIM}Connected — ${stats.total_runs} total runs, ${stats.total_winners} winners${fmt.RESET}\n`);

  const allFindings: Finding[] = [];
  const ledger = await loadLedger();
  const submitted: string[] = [];

  // Run all analyses
  const [winnerRateFindings, heatmapFindings, recentFindings] = await Promise.all([
    analyzeWinnerRate(),
    analyzeHeatmap(),
    analyzeRecentWinners(),
  ]);

  allFindings.push(...winnerRateFindings, ...heatmapFindings, ...recentFindings);

  // Submit new findings
  for (const finding of allFindings) {
    if (isDuplicate(finding, ledger)) {
      console.log(`  ${fmt.DIM}↩ Skipped (duplicate): ${finding.title}${fmt.RESET}`);
      continue;
    }

    const id = await submitSource(finding, dryRun);
    if (id) {
      submitted.push(id);
      markSubmitted(finding, ledger);
    }
  }

  if (!dryRun) {
    await saveLedger(ledger);
    await logRun("ralph", allFindings, submitted);
  }

  console.log(`\n  ${fmt.BOLD}Ralph: ${allFindings.length} findings, ${submitted.length} new submissions${fmt.RESET}\n`);
  return allFindings;
}

const findings = await main();
export { findings };
