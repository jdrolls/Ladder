#!/usr/bin/env bun

/**
 * advancer.ts — Autonomous pipeline advancement for Ladder
 *
 * Scans Sources with potential ideas and promotes them to Ideas.
 * Scores Ideas and promotes high-scoring ones to Hypotheses.
 *
 * Usage:
 *   bun run Tools/monitors/advancer.ts [--dry-run]
 */

import { readdir, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import { join } from "path";
import { ROOT, fmt } from "./shared";

const dryRun = process.argv.includes("--dry-run");

// ── Helpers ─────────────────────────────────────────────

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function slugify(title: string): string {
  return title
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .replace(/\s+/g, "_")
    .substring(0, 60);
}

function parseFrontmatter(content: string): Record<string, string> {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};

  const result: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.substring(0, colonIdx).trim();
    const value = line.substring(colonIdx + 1).trim().replace(/^["']|["']$/g, "");
    if (key && value && !key.startsWith(" ")) {
      result[key] = value;
    }
  }
  return result;
}

async function getNextId(dir: string, prefix: string): Promise<string> {
  const fullDir = join(ROOT, dir);
  if (!existsSync(fullDir)) return `${prefix}-00001`;

  const files = await readdir(fullDir);
  const ids = files
    .filter((f) => f.startsWith(prefix) && f.endsWith(".md") && f !== "TEMPLATE.md" && f !== "README.md")
    .map((f) => {
      const match = f.match(new RegExp(`${prefix}-(\\d+)`));
      return match ? parseInt(match[1], 10) : 0;
    })
    .filter((n) => n > 0);

  const next = ids.length > 0 ? Math.max(...ids) + 1 : 1;
  return `${prefix}-${String(next).padStart(5, "0")}`;
}

// ── Source -> Idea promotion ────────────────────────────

interface SourceEntry {
  filepath: string;
  id: string;
  title: string;
  status: string;
  domain: string;
  tags: string;
  potentialIdeas: string[];
  content: string;
}

async function loadSources(): Promise<SourceEntry[]> {
  const dir = join(ROOT, "Sources");
  if (!existsSync(dir)) return [];

  const files = await readdir(dir);
  const sources: SourceEntry[] = [];

  for (const file of files) {
    if (!file.startsWith("SR-") || !file.endsWith(".md")) continue;

    const filepath = join(dir, file);
    const content = await readFile(filepath, "utf-8");
    const fm = parseFrontmatter(content);

    if (fm.status !== "active") continue;

    // Extract potential ideas from content
    const ideasSection = content.match(/## Potential Ideas\n([\s\S]*?)(?=\n##|$)/);
    const potentialIdeas = ideasSection
      ? ideasSection[1].split("\n").filter((l) => l.trim().startsWith("-")).map((l) => l.trim().replace(/^-\s*/, ""))
      : [];

    sources.push({
      filepath,
      id: fm.id || file.replace(".md", ""),
      title: fm.title || "(untitled)",
      status: fm.status || "draft",
      domain: fm.domain || "",
      tags: fm.tags || "[]",
      potentialIdeas,
      content,
    });
  }

  return sources;
}

async function checkExistingIdeasForSource(sourceId: string): Promise<boolean> {
  const dir = join(ROOT, "Ideas");
  if (!existsSync(dir)) return false;

  const files = await readdir(dir);
  for (const file of files) {
    if (!file.startsWith("ID-") || !file.endsWith(".md")) continue;
    const content = await readFile(join(dir, file), "utf-8");
    if (content.includes(sourceId)) return true;
  }
  return false;
}

async function promoteSourceToIdea(source: SourceEntry): Promise<string[]> {
  const createdIds: string[] = [];

  // Only promote sources with 2+ potential ideas
  if (source.potentialIdeas.length < 2) return createdIds;

  // Check if ideas already exist for this source
  if (await checkExistingIdeasForSource(source.id)) {
    console.log(`  ${fmt.DIM}↩ Ideas already exist for ${source.id}${fmt.RESET}`);
    return createdIds;
  }

  // Create an idea from the top potential idea
  const topIdea = source.potentialIdeas[0];
  const id = await getNextId("Ideas", "ID");
  const slug = slugify(topIdea);
  const filename = `${id}—${slug}.md`;
  const filepath = join(ROOT, "Ideas", filename);

  const content = `---
id: ${id}
title: "${topIdea}"
status: draft
created: ${today()}
sources: [${source.id}]
phase: contemplate
domain: ${source.domain}
tags: [${source.tags.replace(/[\[\]]/g, "")}, auto-advanced]
scores:
  feasibility: 0
  novelty: 0
  impact: 0
  elegance: 0
---

## Description

${topIdea}

## Provenance

Auto-advanced from ${source.id}: "${source.title}"

Other potential ideas from this source:
${source.potentialIdeas.slice(1).map((idea) => `- ${idea}`).join("\n")}

## Connection

Addresses observations identified in ${source.id}.

## Next Steps

- Score on feasibility, novelty, impact, elegance (0-100)
- If average score > 70, advance to hypothesis
- Define testable prediction with specific metric and threshold
`;

  if (dryRun) {
    console.log(`  ${fmt.YELLOW}[DRY RUN]${fmt.RESET} Would create: Ideas/${filename}`);
    console.log(`    ${fmt.DIM}From ${source.id}: ${topIdea}${fmt.RESET}`);
  } else {
    await writeFile(filepath, content, "utf-8");
    console.log(`  ${fmt.GREEN}✓${fmt.RESET} Created ${fmt.CYAN}${id}${fmt.RESET}: ${topIdea}`);
    console.log(`    ${fmt.DIM}← ${source.id}${fmt.RESET}`);
  }

  createdIds.push(id);
  return createdIds;
}

// ── Idea -> Hypothesis promotion ────────────────────────

interface IdeaEntry {
  filepath: string;
  id: string;
  title: string;
  status: string;
  scores: { feasibility: number; novelty: number; impact: number; elegance: number };
  content: string;
}

async function loadIdeas(): Promise<IdeaEntry[]> {
  const dir = join(ROOT, "Ideas");
  if (!existsSync(dir)) return [];

  const files = await readdir(dir);
  const ideas: IdeaEntry[] = [];

  for (const file of files) {
    if (!file.startsWith("ID-") || !file.endsWith(".md")) continue;

    const filepath = join(dir, file);
    const content = await readFile(filepath, "utf-8");
    const fm = parseFrontmatter(content);

    // Parse scores from YAML (nested, so manual parse)
    const scoresMatch = content.match(/scores:\n\s+feasibility:\s*(\d+)\n\s+novelty:\s*(\d+)\n\s+impact:\s*(\d+)\n\s+elegance:\s*(\d+)/);
    const scores = scoresMatch
      ? { feasibility: parseInt(scoresMatch[1]), novelty: parseInt(scoresMatch[2]), impact: parseInt(scoresMatch[3]), elegance: parseInt(scoresMatch[4]) }
      : { feasibility: 0, novelty: 0, impact: 0, elegance: 0 };

    ideas.push({
      filepath,
      id: fm.id || file.replace(".md", ""),
      title: fm.title || "(untitled)",
      status: fm.status || "draft",
      scores,
      content,
    });
  }

  return ideas;
}

async function checkExistingHypothesisForIdea(ideaId: string): Promise<boolean> {
  const dir = join(ROOT, "Hypotheses");
  if (!existsSync(dir)) return false;

  const files = await readdir(dir);
  for (const file of files) {
    if (!file.startsWith("HY-") || !file.endsWith(".md")) continue;
    const content = await readFile(join(dir, file), "utf-8");
    if (content.includes(ideaId)) return true;
  }
  return false;
}

async function promoteIdeaToHypothesis(idea: IdeaEntry): Promise<string | null> {
  const avg = (idea.scores.feasibility + idea.scores.novelty + idea.scores.impact + idea.scores.elegance) / 4;

  // Only promote ideas with average score > 70
  if (avg < 70) return null;

  // Check if hypothesis already exists
  if (await checkExistingHypothesisForIdea(idea.id)) {
    console.log(`  ${fmt.DIM}↩ Hypothesis already exists for ${idea.id}${fmt.RESET}`);
    return null;
  }

  const id = await getNextId("Hypotheses", "HY");
  const slug = slugify(idea.title);
  const filename = `${id}—${slug}.md`;
  const filepath = join(ROOT, "Hypotheses", filename);

  const content = `---
id: ${id}
title: "${idea.title}"
status: draft
created: ${today()}
idea: ${idea.id}
tags: [auto-advanced]
prediction: ""
metric: ""
success_criteria: ""
---

## Hypothesis

If [implement "${idea.title}"], then [expected measurable outcome].

## Rationale

Auto-advanced from ${idea.id} (avg score: ${avg.toFixed(0)}/100).
Scores: feasibility=${idea.scores.feasibility}, novelty=${idea.scores.novelty}, impact=${idea.scores.impact}, elegance=${idea.scores.elegance}

## Testing Plan

- Define specific metric and measurement method
- Set baseline measurement before intervention
- Run experiment for defined duration
- Compare against success criteria

## Success Criteria

[To be defined — quantitative threshold for the measured metric]

## Risks

[To be assessed]
`;

  if (dryRun) {
    console.log(`  ${fmt.YELLOW}[DRY RUN]${fmt.RESET} Would create: Hypotheses/${filename}`);
    console.log(`    ${fmt.DIM}From ${idea.id} (avg score: ${avg.toFixed(0)})${fmt.RESET}`);
  } else {
    await writeFile(filepath, content, "utf-8");
    console.log(`  ${fmt.GREEN}✓${fmt.RESET} Created ${fmt.CYAN}${id}${fmt.RESET}: ${idea.title}`);
    console.log(`    ${fmt.DIM}← ${idea.id} (avg score: ${avg.toFixed(0)})${fmt.RESET}`);
  }

  return id;
}

// ── Main ────────────────────────────────────────────────

async function main(): Promise<{ newIdeas: string[]; newHypotheses: string[] }> {
  console.log(`\n${fmt.BOLD}Pipeline Advancer${fmt.RESET}\n`);

  const newIdeas: string[] = [];
  const newHypotheses: string[] = [];

  // Phase 1: Sources -> Ideas
  console.log(`  ${fmt.BOLD}Source → Idea promotion${fmt.RESET}`);
  const sources = await loadSources();
  console.log(`  ${fmt.DIM}${sources.length} active sources to evaluate${fmt.RESET}`);

  for (const source of sources) {
    const ids = await promoteSourceToIdea(source);
    newIdeas.push(...ids);
  }

  // Phase 2: Ideas -> Hypotheses
  console.log(`\n  ${fmt.BOLD}Idea → Hypothesis promotion${fmt.RESET}`);
  const ideas = await loadIdeas();
  const scoredIdeas = ideas.filter((i) => {
    const avg = (i.scores.feasibility + i.scores.novelty + i.scores.impact + i.scores.elegance) / 4;
    return avg > 0; // only consider scored ideas
  });
  console.log(`  ${fmt.DIM}${scoredIdeas.length} scored ideas to evaluate (${ideas.length} total)${fmt.RESET}`);

  for (const idea of scoredIdeas) {
    const id = await promoteIdeaToHypothesis(idea);
    if (id) newHypotheses.push(id);
  }

  console.log(`\n  ${fmt.BOLD}Advancer: ${newIdeas.length} new ideas, ${newHypotheses.length} new hypotheses${fmt.RESET}\n`);
  return { newIdeas, newHypotheses };
}

const result = await main();
export { result };
