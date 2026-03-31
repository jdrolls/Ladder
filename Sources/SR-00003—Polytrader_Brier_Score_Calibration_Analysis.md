---
id: SR-00003
title: "Polytrader Brier Score Calibration by Market Category"
type: telemetry
url: ""
status: active
created: 2026-03-28
tags: [polytrader, brier-score, calibration, prediction-markets, claude-estimation]
domain: "prediction-markets"
relevance: "Polytrader's Claude-based probability estimation shows varying calibration across market categories — identifying weak categories is key to improving edge"
---

## Summary

Polytrader uses Claude AI to estimate probabilities for prediction market events on Polymarket and Kalshi. Early data (7 days, ~17 scored estimations) shows calibration varies significantly by market category. Sports markets were identified as poisoning the learning signal and were filtered out. The system raised min_spread from 2% to 5% and confidence threshold from 0.5 to 0.6 after initial analysis.

## Key Points

- Claude probability estimation is the core edge — calibration IS the product
- Sports markets identified as poor fit (removed from learning metrics)
- Price anchoring in the prompt was identified as "biggest edge destroyer" and removed
- Current P&L: -5.1% after 7 days ($10K bankroll) — early but directionally concerning
- 464 open trades across 91 markets, 2,106 mispricings detected
- Need 12-18 months of calibration data for reliable conclusions

## Connection to Problems

If Claude's probability estimates are systematically biased in certain categories, the bot will consistently lose money in those categories while potentially being profitable in others. Category-level calibration analysis is the highest-leverage improvement.

## Potential Ideas

- Build category-specific Brier score dashboards to identify strong/weak domains
- Test category-specific prompts that provide domain context (e.g., political polling methodology for political markets)
- Implement dynamic position sizing based on historical calibration per category
