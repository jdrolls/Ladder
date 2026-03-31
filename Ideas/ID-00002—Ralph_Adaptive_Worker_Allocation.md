---
id: ID-00002
title: "Adaptive Worker Allocation Based on Discovery Yield"
status: draft
created: 2026-03-28
sources: [SR-00002]
phase: contemplate
domain: algorithmic-trading
tags: [ralph-trades, optimization, worker-allocation, meta-learning]
scores:
  feasibility: 75
  novelty: 65
  impact: 80
  elegance: 70
---

## Description

Instead of a fixed 6/10 split between eval and PA workers, dynamically allocate workers based on which mode is producing more verified winners per unit of compute. If eval mode has been finding more promising strategies lately, shift workers toward eval. If PA mode is successfully optimizing known strategies, shift toward PA. This is meta-optimization — optimizing the optimizer.

## Provenance

From SR-00002 observation that the 6/10 worker split is static while the relative productivity of each mode likely varies over time and market conditions.

## Connection

Addresses resource allocation efficiency in the discovery engine. A fixed split assumes both modes are equally productive at all times, which is unlikely.

## Next Steps

- Hypothesis: Dynamic worker allocation based on trailing 7-day winner yield will produce 20% more verified strategies than the fixed 6/10 split
- Need to define "winner yield" metric precisely (winners per worker-hour)
- Need to define reallocation frequency and bounds (e.g., min 3 workers per mode)
