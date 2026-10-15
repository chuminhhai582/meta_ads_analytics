---
name: meta-ads
description: >-
  Workflows, best practices, and guidelines for managing Facebook & Instagram Ads
  via Meta Marketing API and the Meta Ads MCP server. Use for ad analytics, reporting,
  campaign inspection, and optimization.
---

# Meta Ads Skill & Optimization Guide

This skill provides context and instructions on using the Meta Ads MCP tools to inspect, report, and optimize advertising campaigns on Facebook and Instagram.

## Core Metrics & Formulas

- **Spend**: Total amount of money spent within the timeframe.
- **ROAS (Return on Ad Spend)**: `Purchase Conversion Value / Spend`.
  - Target: > 3.0x is generally strong, 2.0x-3.0x is acceptable/breakeven depending on margin, < 1.5x needs review.
- **CPA (Cost per Acquisition / Purchase / Lead)**: `Spend / Conversions`.
- **CTR (Link Click-Through Rate)**: `Link Clicks / Impressions * 100%`.
  - Benchmark: Feed ads usually aim for > 1.2% - 2.0%.
- **CPC (Cost Per Click)**: `Spend / Clicks`.
- **CPM (Cost Per Mille / 1,000 Impressions)**: `Spend / (Impressions / 1000)`.
- **Frequency**: Average number of times each person saw the ad.
  - Alert: Frequency > 3.5 within 7-14 days indicates Ad Fatigue (Creative bão hòa).

## Key MCP Tools Available

- `get_account_insights`: Pull account-level metrics (spend, impressions, roas, clicks) by `date_preset`.
- `get_campaign_insights`: Pull campaign-level performance data.
- `get_adset_insights`: Inspect ad set delivery, targeting efficiency, and budget utilization.
- `get_ad_insights`: Ad-level metrics (identifying winning creatives vs burning creatives).
- `list_campaigns`: View active/paused campaigns, objective, and daily/lifetime budget.
- `list_adsets`: View targeting, schedule, and bidding parameters.
- `list_ads`: View ad creatives and status.

## AI Optimization Framework

1. **Winning Ads (Scale)**: High ROAS, low CPA, CTR > 1.5%. Suggest scaling budget by 15-20% every 48 hours to avoid resetting the learning phase.
2. **Underperforming Ads (Cut/Pause)**: Spend exceeds 2-3x target CPA with 0 conversions or ROAS < 1.0. Suggest pausing or replacing copy/creative.
3. **Creative Fatigue**: High frequency (> 3.0), rising CPA, falling CTR. Recommend introducing new video/image angles or lookalike refreshing.
