# Validation review and feedback

Reviewed 9 November 2026. This review uses the previously recorded 2023-01-01 to 2024-06-30 validation period. The final holdout remains sealed.

## What we checked

The four existing fixture tests passed. A separate calculation using the same verified input bars and independently written position/accounting logic reproduced BTC equity within 3×10⁻²⁵ USDT and ETH to decimal precision. This cross-check confirms the implementation of the specified simplified arithmetic. It does not independently verify the vendor prices, executable fills, or profitability.

| Measure | BTC rule | BTC buy-and-hold | ETH rule | ETH buy-and-hold |
|---|---:|---:|---:|---:|
| Net modeled return | 242.83% | 278.91% | 28.35% | 187.01% |
| Maximum daily-close drawdown | 15.24% | 20.13% | 36.45% | 29.10% |
| Filled entries/exits | 42 | 1 | 82 | 1 |
| Days invested | 342 | 547 | 299 | 547 |
| Simulated fees (USDT) | 4.75 | 0.05 | 4.65 | 0.05 |

Fee totals are absolute amounts on a compounding account. Exposure is not constant, so this comparison alone does not isolate prediction skill.

Doubling both modeled fees and the combined spread/slippage allowance produces 221.89% for BTC and 13.50% for ETH. With one extra daily bar of delay, the previously recorded returns are 187.09% and 57.58%. These are individual stress scenarios, not historically measured fill costs. The delay scenario shifts signal evaluation by one bar and fills at the following open, it is not a measurement of a fixed latency in minutes.

## Limits that affect the decision

- Daily bars cannot demonstrate that an order based on the completed close was filled at the very next daily open. A finer-resolution dataset and explicitly timed order model are needed for a realistic latency study.
- The $50 simulation permits fractional units without exchange minimum notional, quantity steps or dust, and uses hypothetical cost settings. Venue-specific eligibility remains unverified.
- Both the rule and buy-and-hold are marked to the final close if still invested. This excludes a final liquidation fee, half-spread and slippage. Cash is also a quote-token balance, without modeled token depeg, interest or tax.
- Existing fixture tests do not fully establish boundaries, all independent cost components, or reproducibility of code revisions. Validation script mutates global settings and overwrites its result file. Save and hash the exact code, specification and input manifest before opening the holdout.
- Both positive returns satisfy the previously stated positive-return validation gate. BTC beat buy-and-hold on daily-close drawdown but lagged on return. ETH lagged on return and had a larger daily-close drawdown. That evidence does not establish a trading edge.
- The prior validation was already run and the results are known. Do not change the rule or thresholds in response and call this validation untouched. Additional scenario checks are exploratory.

## Decision to review

Recommended: keep the final holdout sealed while we harden the reproducibility record and test realistic timing using finer-resolution development/validation data. Preserve the original frozen strategy and published validation result. Then run the holdout once under the original protocol and separately disclose any timing sensitivity.

Please give feedback in the PR conversation:
1. Do you agree that the next step should focus on execution timing and reproducibility?
2. Should the BTC and ETH rules both remain in the final comparison, given ETH's weaker validation result?

The original protocol selected a candidate independently for each asset and a positive-return validation gate. Excluding ETH now would be a new, post-result decision and should be documented as such.
