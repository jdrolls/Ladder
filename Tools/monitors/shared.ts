#!/usr/bin/env bun

/**
 * shared.ts — Shared utilities for Ladder autonomous monitors
 */

import { readFile, writeFile, readdir } from "fs/promises";
import { existsSync } from "fs";
import { join, resolve } from "path";

export const ROOT = resolve(import.meta.dir, "../..");
export const LEDGER_PATH = join(import.meta.dir, "ledger.json");
export const LOGS_DIR = join(import.meta.dir, "logs");

const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RESET = "\x1b[0m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED = "\x1b[31m";
const CYAN = "\x1b[36m";

export const fmt = { BOLD, DIM, RESET, GREEN, YELLOW, RED, CYAN };

// ── Finding types ───────────────────────────────────────

export interface Finding {
  title: string;
  detail: string;
  type: string; // telemetry, observation
  domain: string;
  tags: string[];
  potentialIdeas: string[];
}

// ── Deduplication ───────────────────────────────────────

function hashFinding(f: Finding): string {
  const key = `${f.title}::${f.domain}::${f.tags.sort().join(",")}`;
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    const chr = key.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return hash.toString(36);
}

export async function loadLedger(): Promise<Set<string>> {
  if (!existsSync(LEDGER_PATH)) return new Set();
  try {
    const data = JSON.parse(await readFile(LEDGER_PATH, "utf-8"));
    return new Set(data.submitted || []);
  } catch {
    return new Set();
  }
}

export async function saveLedger(ledger: Set<string>): Promise<void> {
  await writeFile(LEDGER_PATH, JSON.stringify({
    submitted: Array.from(ledger),
    updated: new Date().toISOString(),
  }, null, 2), "utf-8");
}

export function isDuplicate(finding: Finding, ledger: Set<string>): boolean {
  return ledger.has(hashFinding(finding));
}

export function markSubmitted(finding: Finding, ledger: Set<string>): void {
  ledger.add(hashFinding(finding));
}

// ── Source submission ───────────────────────────────────

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function slugify(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 60);
}

async function getNextSourceId(): Promise<string> {
  const dir = join(ROOT, "Sources");
  if (!existsSync(dir)) return "SR-00001";

  const files = await readdir(dir);
  const ids = files
    .filter((f) => f.match(/^SR-\d/) && f.endsWith(".md"))
    .map((f) => {
      const match = f.match(/SR-(\d+)/);
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter((n) => n > 0);

  const next = ids.length > 0 ? Math.max(...ids) + 1 : 1;
  return `SR-${String(next).padStart(5, "0")}`;
}

export async function submitSource(finding: Finding, dryRun: boolean): Promise<string | null> {
  const id = await getNextSourceId();
  const slug = slugify(finding.title);
  const filename = `${id}—${slug}.md`;
  const filepath = join(ROOT, "Sources", filename);

  const content = `---
id: ${id}
title: "${finding.title}"
type: ${finding.type}
url: ""
status: active
created: ${today()}
tags: [${finding.tags.join(", ")}]
domain: "${finding.domain}"
relevance: "${finding.detail.substring(0, 200)}"
---

## Summary

${finding.title}

## Key Points

- ${finding.detail}

## Connection to Problems

Auto-detected by Ladder autonomous monitor.

## Potential Ideas

${finding.potentialIdeas.map((idea) => `- ${idea}`).join("\n")}
`;

  if (dryRun) {
    console.log(`  ${YELLOW}[DRY RUN]${RESET} Would create: Sources/${filename}`);
    console.log(`    ${DIM}${finding.detail}${RESET}`);
    return id;
  }

  await writeFile(filepath, content, "utf-8");
  console.log(`  ${GREEN}✓${RESET} Created ${CYAN}${id}${RESET}: ${finding.title}`);
  return id;
}

// ── Telegram Notifications ──────────────────────────────

const TELEGRAM_BOT_TOKEN = process.env.DORA_TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

export async function notifyTelegram(message: string): Promise<boolean> {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    // Try loading from DORA's .env
    try {
      const envPath = join(process.env.HOME || "", "live/config/dora/.env");
      const envContent = await readFile(envPath, "utf-8");
      const tokenMatch = envContent.match(/DORA_TELEGRAM_BOT_TOKEN=(.+)/);
      const chatMatch = envContent.match(/TELEGRAM_CHAT_ID=(.+)/);
      if (!tokenMatch || !chatMatch) {
        console.log(`  ${DIM}Telegram: credentials not found in DORA .env${RESET}`);
        return false;
      }
      const token = tokenMatch[1].trim();
      const chatId = chatMatch[1].trim();
      return await sendTelegram(token, chatId, message);
    } catch {
      console.log(`  ${DIM}Telegram: could not load DORA .env${RESET}`);
      return false;
    }
  }
  return await sendTelegram(TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID, message);
}

async function sendTelegram(token: string, chatId: string, message: string): Promise<boolean> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "HTML",
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      console.log(`  ${YELLOW}Telegram: API error ${res.status}${RESET}`);
      return false;
    }
    return true;
  } catch (e) {
    console.log(`  ${YELLOW}Telegram: send failed — ${e}${RESET}`);
    return false;
  }
}

// ── Logging ─────────────────────────────────────────────

export async function logRun(monitor: string, findings: Finding[], submitted: string[]): Promise<void> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const logPath = join(LOGS_DIR, `${timestamp}_${monitor}.json`);

  await writeFile(logPath, JSON.stringify({
    monitor,
    timestamp: new Date().toISOString(),
    findings_count: findings.length,
    submitted_count: submitted.length,
    submitted_ids: submitted,
    findings: findings.map((f) => ({ title: f.title, domain: f.domain })),
  }, null, 2), "utf-8");
}
