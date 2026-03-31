---
id: ID-00003
title: "Category-Specific Claude Prompts for Prediction Markets"
status: draft
created: 2026-03-28
sources: [SR-00003]
phase: contemplate
domain: prediction-markets
tags: [polytrader, prompt-engineering, calibration, category-optimization]
scores:
  feasibility: 90
  novelty: 50
  impact: 85
  elegance: 60
---

## Description

Instead of using a single generic prompt for all prediction market categories, create category-specific prompt variants that provide relevant domain context. Political markets get polling methodology context, crypto markets get on-chain data framing, weather markets get climatological base rates, etc. The hypothesis is that domain-specific context reduces systematic estimation bias.

## Provenance

From SR-00003 observation that calibration varies significantly by market category, and that sports markets were so poorly calibrated they had to be filtered entirely. If some categories are structurally harder for Claude, domain-specific prompting may help.

## Connection

Directly addresses the core product — Claude's probability estimation accuracy. Even a 2-3% improvement in calibration across major categories could flip the system from negative to positive expected value.

## Next Steps

- Hypothesis: Category-specific prompts improve Brier scores by 10%+ in political and crypto markets
- Need to accumulate enough closed trades per category to measure (minimum ~50 per category)
- Start with the two highest-volume categories where we have the most data
