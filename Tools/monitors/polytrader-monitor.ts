#!/usr/bin/env bun

/**
 * polytrader-monitor.ts — Autonomous monitor for Polytrader
 *
 * Reads Polytrader's SQLite database directly for:
 * - Category-level Brier score analysis (worse than random?)
 * - Confidence calibration drift (are high-confidence estimates more accurate?)
 * - P&L trends by category
 * - Trade volume and activity patterns
 *
 * Submits findings as Sources to the Ladder pipeline.
 *
 * Usage:
 *   bun run Tools/monitors/polytrader-monitor.ts [--dry-run]
 */

import { Database } from "bun:sqlite";
import { existsSync } from "fs";
import { type Finding, isDuplicate, markSubmitted, loadLedger, saveLedger, submitSource, logRun, fmt } from "./shared";

const DB_PATH = process.env.POLYTRADER_DB || `${process.env.HOME}/live/projects/polytrader/data/polytrader.db`;
const BRIER_RANDOM = 0.25; // worse than this = worse than guessing
const BRIER_GOOD = 0.15; // better than this = solid calibration
const MIN_SCORED = 5; // minimum scored estimations per category to report

const dryRun = process.argv.includes("--dry-run");

// ── Database Helpers ────────────────────────────────────

function openDb(): Database | null {
  if (!existsSync(DB_PATH)) return null;
  try {
    const db = new Database(DB_PATH, { readonly: true });
    db.exec("PRAGMA journal_mode=WAL"); // ensure WAL for concurrent reads
    return db;
  } catch (e) {
    console.log(`  ${fmt.YELLOW}⚠ Cannot open Polytrader DB: ${e}${fmt.RESET}`);
    return null;
  }
}

// ── Analysis ────────────────────────────────────────────

function analyzeCategoryPerformance(db: Database): Finding[] {
  const findings: Finding[] = [];

  try {
    const rows = db.query(`
      SELECT category, total_scored, mean_brier, mean_confidence, bias
      FROM category_performance
      WHERE category != '_overall' AND total_scored >= ?
      ORDER BY mean_brier DESC
    `).all(MIN_SCORED) as Array<{
      category: string;
      total_scored: number;
      mean_brier: number;
      mean_confidence: number;
      bias: number;
    }>;

    // Categories worse than random
    const worseThanRandom = rows.filter((r) => r.mean_brier > BRIER_RANDOM);
    if (worseThanRandom.length > 0) {
      const details = worseThanRandom.map((r) =>
        `${r.category}: Brier ${r.mean_brier.toFixed(3)} (n=${r.total_scored})`
      ).join("; ");

      findings.push({
        title: `Polytrader ${worseThanRandom.length} categories worse than random guessing`,
        detail: `Categories with Brier score > ${BRIER_RANDOM} (random baseline): ${details}. These categories are actively destroying value.`,
        type: "telemetry",
        domain: "prediction-markets",
        tags: ["polytrader", "brier-score", "category-performance", "automated"],
        potentialIdeas: [
          "Exclude worse-than-random categories from trading until calibration improves",
          "Implement category-specific Claude prompts with domain context",
          "Analyze whether bias direction (over/under-estimating) is consistent per category",
        ],
      });
    }

    // Categories with strong performance (good signal)
    const strongCategories = rows.filter((r) => r.mean_brier < BRIER_GOOD && r.total_scored >= 10);
    if (strongCategories.length > 0) {
      const details = strongCategories.map((r) =>
        `${r.category}: Brier ${r.mean_brier.toFixed(3)} (n=${r.total_scored})`
      ).join("; ");

      findings.push({
        title: `Polytrader ${strongCategories.length} categories showing strong calibration`,
        detail: `Categories with Brier < ${BRIER_GOOD}: ${details}. Consider increasing position sizes in these categories.`,
        type: "telemetry",
        domain: "prediction-markets",
        tags: ["polytrader", "brier-score", "strong-performance", "automated"],
        potentialIdeas: [
          "Increase position sizing for well-calibrated categories (Kelly Criterion adjustment)",
          "Analyze what makes these categories predictable — apply lessons to weak categories",
          "Test whether Claude's reasoning patterns differ for strong vs weak categories",
        ],
      });
    }

    // Systematic bias detection
    const biasedCategories = rows.filter((r) => Math.abs(r.bias) > 0.15);
    if (biasedCategories.length > 0) {
      const details = biasedCategories.map((r) => {
        const direction = r.bias > 0 ? "overestimates" : "underestimates";
        return `${r.category}: ${direction} by ${Math.abs(r.bias).toFixed(3)}`;
      }).join("; ");

      findings.push({
        title: `Polytrader systematic bias detected in ${biasedCategories.length} categories`,
        detail: `Categories with >15% systematic bias: ${details}. Bias correction could improve calibration significantly.`,
        type: "telemetry",
        domain: "prediction-markets",
        tags: ["polytrader", "bias", "calibration", "automated"],
        potentialIdeas: [
          "Implement post-hoc bias correction per category (shift Claude estimates by historical bias)",
          "Add bias awareness to Claude prompt — tell it its historical tendency in that category",
          "Test if bias correlates with market liquidity or time-to-resolution",
        ],
      });
    }
  } catch (e) {
    console.log(`  ${fmt.DIM}category_performance table not found or empty${fmt.RESET}`);
  }

  return findings;
}

function analyzeConfidenceCalibration(db: Database): Finding[] {
  const findings: Finding[] = [];

  try {
    const rows = db.query(`
      SELECT
        CASE
          WHEN confidence < 0.3 THEN 'low'
          WHEN confidence < 0.6 THEN 'medium'
          WHEN confidence < 0.8 THEN 'high'
          ELSE 'very_high'
        END as bucket,
        COUNT(*) as count,
        AVG(brier_score) as mean_brier,
        AVG(confidence) as avg_confidence
      FROM estimation_scores
      GROUP BY bucket
      HAVING count >= 3
      ORDER BY avg_confidence
    `).all() as Array<{
      bucket: string;
      count: number;
      mean_brier: number;
      avg_confidence: number;
    }>;

    if (rows.length < 2) return findings;

    // Check if confidence is actually predictive of accuracy
    const sorted = rows.sort((a, b) => a.avg_confidence - b.avg_confidence);
    const lowestConf = sorted[0];
    const highestConf = sorted[sorted.length - 1];

    if (lowestConf && highestConf && highestConf.mean_brier >= lowestConf.mean_brier) {
      findings.push({
        title: `Polytrader confidence not predictive of accuracy`,
        detail: `High-confidence estimates (Brier: ${highestConf.mean_brier.toFixed(3)}) are not more accurate than low-confidence (Brier: ${lowestConf.mean_brier.toFixed(3)}). Confidence signal is miscalibrated — position sizing based on confidence is misleading.`,
        type: "telemetry",
        domain: "prediction-markets",
        tags: ["polytrader", "confidence-calibration", "position-sizing", "automated"],
        potentialIdeas: [
          "Redesign confidence scoring — current signal doesn't correlate with accuracy",
          "Use historical Brier scores per category instead of stated confidence for sizing",
          "Analyze Claude's reasoning text to find better proxy signals for estimation quality",
        ],
      });
    } else if (lowestConf && highestConf) {
      const improvement = ((lowestConf.mean_brier - highestConf.mean_brier) / lowestConf.mean_brier * 100).toFixed(1);
      if (parseFloat(improvement) > 30) {
        findings.push({
          title: `Polytrader confidence signal is ${improvement}% predictive`,
          detail: `High-confidence Brier: ${highestConf.mean_brier.toFixed(3)} vs low-confidence Brier: ${lowestConf.mean_brier.toFixed(3)}. Confidence is a useful sizing signal — lean into it more.`,
          type: "telemetry",
          domain: "prediction-markets",
          tags: ["polytrader", "confidence-calibration", "positive-signal", "automated"],
          potentialIdeas: [
            "Increase Kelly fraction for high-confidence trades",
            "Analyze what features of high-confidence markets make them more predictable",
            "Test dynamic confidence thresholds per category",
          ],
        });
      }
    }
  } catch (e) {
    console.log(`  ${fmt.DIM}estimation_scores table not found or empty${fmt.RESET}`);
  }

  return findings;
}

function analyzePnL(db: Database): Finding[] {
  const findings: Finding[] = [];

  try {
    const overall = db.query(`
      SELECT
        COUNT(*) as total_trades,
        SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) as open_trades,
        SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) as closed_trades,
        SUM(CASE WHEN pnl IS NOT NULL THEN pnl ELSE 0 END) as realized_pnl,
        SUM(size_usd) as total_deployed
      FROM paper_trades
    `).get() as {
      total_trades: number;
      open_trades: number;
      closed_trades: number;
      realized_pnl: number;
      total_deployed: number;
    } | null;

    if (!overall || overall.total_trades === 0) return findings;

    // Check for concerning P&L trend
    if (overall.closed_trades >= 10 && overall.realized_pnl < 0) {
      const lossRate = Math.abs(overall.realized_pnl / (overall.total_deployed || 1) * 100);
      if (lossRate > 5) {
        findings.push({
          title: `Polytrader realized P&L at -$${Math.abs(overall.realized_pnl).toFixed(2)} (${lossRate.toFixed(1)}% loss)`,
          detail: `${overall.closed_trades} closed trades with total realized loss of $${Math.abs(overall.realized_pnl).toFixed(2)} on $${overall.total_deployed.toFixed(2)} deployed. Loss rate of ${lossRate.toFixed(1)}% suggests systematic edge issues.`,
          type: "telemetry",
          domain: "prediction-markets",
          tags: ["polytrader", "pnl", "risk-management", "automated"],
          potentialIdeas: [
            "Analyze losing trades by category to identify which segments drive losses",
            "Review spread threshold — current minimum may not cover transaction costs and slippage",
            "Consider reducing position sizes until calibration data matures",
          ],
        });
      }
    }

    // Check trade concentration
    if (overall.open_trades > 200) {
      findings.push({
        title: `Polytrader high trade concentration: ${overall.open_trades} open positions`,
        detail: `${overall.open_trades} open trades may exceed manageable portfolio size. Higher concentration increases correlation risk and reduces per-trade edge monitoring.`,
        type: "telemetry",
        domain: "prediction-markets",
        tags: ["polytrader", "portfolio-management", "concentration-risk", "automated"],
        potentialIdeas: [
          "Implement portfolio cap and enforce it at opportunity detection level",
          "Rank open positions by expected edge and close lowest-conviction trades",
          "Add sector concentration limits to prevent correlated exposure",
        ],
      });
    }
  } catch (e) {
    console.log(`  ${fmt.DIM}paper_trades table not found or empty${fmt.RESET}`);
  }

  return findings;
}

// ── Main ────────────────────────────────────────────────

async function main(): Promise<Finding[]> {
  console.log(`\n${fmt.BOLD}Polytrader Monitor${fmt.RESET}`);
  console.log(`${fmt.DIM}DB: ${DB_PATH}${fmt.RESET}\n`);

  const db = openDb();
  if (!db) {
    console.log(`  ${fmt.YELLOW}⚠ Polytrader DB not available at ${DB_PATH}${fmt.RESET}`);
    console.log(`  ${fmt.DIM}Skipping Polytrader monitoring this cycle${fmt.RESET}\n`);
    return [];
  }

  console.log(`  ${fmt.DIM}Connected to Polytrader DB${fmt.RESET}\n`);

  const allFindings: Finding[] = [];
  const ledger = await loadLedger();
  const submitted: string[] = [];

  // Run all analyses
  const categoryFindings = analyzeCategoryPerformance(db);
  const calibrationFindings = analyzeConfidenceCalibration(db);
  const pnlFindings = analyzePnL(db);

  allFindings.push(...categoryFindings, ...calibrationFindings, ...pnlFindings);

  db.close();

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
    await logRun("polytrader", allFindings, submitted);
  }

  console.log(`\n  ${fmt.BOLD}Polytrader: ${allFindings.length} findings, ${submitted.length} new submissions${fmt.RESET}\n`);
  return allFindings;
}

const findings = await main();
export { findings };
