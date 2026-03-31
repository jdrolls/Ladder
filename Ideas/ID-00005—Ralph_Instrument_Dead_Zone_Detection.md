---
id: ID-00005
title: "Instrument Dead Zone Detection for Ralph Discovery"
status: draft
created: 2026-03-28
sources: [SR-00002]
phase: contemplate
domain: algorithmic-trading
tags: [ralph-trades, instrument-selection, discovery-efficiency]
scores:
  feasibility: 90
  novelty: 55
  impact: 70
  elegance: 75
---

## Description

Track which of Ralph's 32 instruments consistently fail to produce winning strategies, and deprioritize or exclude them from the discovery process. If certain instruments (e.g., low-liquidity commodities) have never produced a winner after N thousand evaluations, compute spent exploring them is wasted. Redirect that compute to instruments with higher discovery yield.

## Provenance

From SR-00002 — with 32 instruments, some will inevitably be better suited to the strategy types Ralph can discover. Identifying "dead zones" early saves compute and accelerates discovery on productive instruments.

## Connection

Discovery efficiency optimization. Similar to ID-00002 (adaptive worker allocation) but applied to the instrument dimension rather than the mode dimension.

## Next Steps

- Hypothesis: Excluding the bottom 25% of instruments by discovery yield increases winner production rate by 15%
- Need to define "dead zone" threshold (e.g., zero winners after 1000+ evaluations)
- Risk: market regime changes could make currently dead instruments productive — need periodic re-evaluation
