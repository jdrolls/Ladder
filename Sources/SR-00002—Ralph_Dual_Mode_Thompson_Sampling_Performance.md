---
id: SR-00002
title: "Ralph Dual-Mode Thompson Sampling Performance Patterns"
type: telemetry
url: ""
status: active
created: 2026-03-28
tags: [ralph-trades, thompson-sampling, bayesian-optimization, strategy-discovery]
domain: "algorithmic-trading"
relevance: "Ralph v5.1 runs dual-mode discovery (eval + PA optimization) across 32 instruments — patterns in which modes/instruments produce winners can improve the discovery engine itself"
---

## Summary

Ralph Trades v5.1 uses dual-mode Thompson Sampling + Bayesian Optimization to discover profitable futures trading strategies. The eval mode (6 workers) explores broadly while PA mode (10 workers) optimizes within Apex Trader Funding constraints. Observing which mode produces more verified winners, and on which instruments, could reveal systematic biases in the discovery process.

## Key Points

- Dual-mode engine: eval (broad exploration) vs PA (constrained optimization)
- 16 parallel workers split 6/10 between modes
- 32 active instruments across commodities, indices, currencies
- 50K account sizing with mode-specific winner criteria
- Thompson Sampling balances exploration vs exploitation — but is the balance optimal?

## Connection to Problems

The discovery engine is the core of Ralph — if the search process itself has biases or inefficiencies, every strategy it produces is suboptimal. Understanding discovery patterns is meta-optimization.

## Potential Ideas

- Analyze winner production rates by mode (eval vs PA) to determine if the 6/10 worker split is optimal
- Track which instruments consistently produce winners vs which are "dead zones" for the discovery engine
- Build a feedback loop where discovery patterns inform the Thompson Sampling priors
