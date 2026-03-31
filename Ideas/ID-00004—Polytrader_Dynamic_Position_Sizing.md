---
id: ID-00004
title: "Calibration-Weighted Position Sizing for Polytrader"
status: draft
created: 2026-03-28
sources: [SR-00003]
phase: contemplate
domain: prediction-markets
tags: [polytrader, position-sizing, risk-management, calibration]
scores:
  feasibility: 85
  novelty: 60
  impact: 75
  elegance: 80
---

## Description

Size positions based on historical calibration performance per market category. Categories where Claude has demonstrated better calibration (lower Brier scores) get larger position sizes. Categories with poor or unknown calibration get smaller sizes or are excluded entirely. This is a Kelly Criterion-adjacent approach where the "edge" is measured by calibration quality.

## Provenance

From SR-00003 — if calibration varies by category, position sizing should reflect that confidence. Currently all positions are sized uniformly (5% max per market) regardless of category track record.

## Connection

Risk management optimization. Even if overall calibration is imperfect, concentrating capital where calibration is strongest maximizes expected value while limiting exposure to weak categories.

## Next Steps

- Hypothesis: Calibration-weighted sizing improves risk-adjusted returns (Sharpe) by 25% vs uniform sizing
- Requires minimum 30 closed trades per category to establish calibration baseline
- Paper trade the weighted approach alongside current uniform approach for comparison
