---
name: peer-analysis-fi
description: >
  Produce a Peer Analysis HTML report for a target bank or other financial institution and its
  credit peers using Moody's GenAI MCP tools. Use whenever the user asks to compare a bank,
  insurer, or other financial institution against its peers, run a bank/FI peer comparison,
  benchmark capital adequacy, asset quality, or profitability against peers, or analyze relative
  credit positioning for a financial institution. Trigger even if they just name a bank/FI and
  mention "peers", "peer comparison", "capital ratio benchmarking", "bank peer analysis", "FI
  peer analysis", or "relative value" — as long as the target is a financial institution (bank,
  insurer, asset manager) rather than a non-financial corporate. If the target's sector is
  ambiguous, resolve it via `findEntity`/`getEntityProfile` before choosing this skill over the
  corporate `peer-analysis` skill.
---

# Peer Analysis Skill — Financial Institutions

Generates a professional HTML report (styled like a Moody's peer analysis PDF) for a target
financial institution (bank, insurer, or other FI) and up to 3 credit peers. Data is pulled from
multiple `Moodys MCP server` MCP tools and consolidated into a single HTML artifact covering
peer comparison, probability of default analysis, and ESG — using capital, asset-quality, profitability, and
liquidity metrics instead of the leverage/coverage metrics used for non-financial corporates.

This is a **sibling skill to `peer-analysis`, not a variant of it.** The two are kept separate
because the underlying data source itself changes: for entities in the Financial Institutions
sector, `getEntityFinancials_v2` routes to BankFocus rather than the Moody's/Eva pipeline used
for corporates, with a different field vocabulary (e.g. "Net interest income (expense)", "Total
assets (balance sheet)"). Forcing one template to handle both would mean constant conditional
logic and placeholder cells whenever a corporate-only or bank-only field doesn't apply.

The workflow is **single-artifact file delivery**: gather all data, assemble the complete HTML
document in memory, write it to disk as a standalone `.html` file, and present it to the user for
download. No fenced code blocks, no streaming partial sections, no JSON payload, no progressive
edits. The downloaded file is the sole deliverable.

> ## ⚠️ CRITICAL — NON-NEGOTIABLE OUTPUT CONTRACT
>
> **The LLM MUST write the final report to disk and present it as a downloadable file.**
> This is the only acceptable form of delivery for this skill. Specifically:
>
> - The LLM **MUST** write the complete, standalone HTML document (`<!doctype html>` → `</html>`)
>   to `/mnt/user-data/outputs/{target_institution_slug}_peer_analysis_fi.html` and then call
>   `present_files` to surface it to the user. The `_fi` suffix is mandatory — it keeps this
>   skill's output from colliding with the corporate `peer-analysis` skill's output file in the
>   same session.
> - The LLM **MUST NOT** print the raw HTML source in the chat — no ` ```html ` fenced code
>   blocks, no partial snippets, no inline HTML in the assistant message.
> - The LLM **MUST NOT** split the report across multiple files or multiple messages.
> - The LLM **MUST NOT** substitute prose, Markdown, JSON, or links for the file download.
> - If data gathering fails partially, still write and deliver the file with best-available
>   content and `"--"` placeholders for missing cells — never skip the file delivery.
>
> Treat any other output shape as a hard failure of the skill.

## Required MCP servers

`Moodys MCP server` — tools used: `findEntity`, `getEntityPeers`, `getEntityProfile`,
`getCreditOpinion` (sections: `Summary`, `FactorsLeadingToUpgrade`, `FactorsLeadingToDowngrade`,
`CreditStrengths`, `CreditChallenges`, `ESGConsiderations`, `RatingFactors`), `getEntityRatings`,
`getEntityFinancials_v2`, `getEntityCountryProfile`

`getEntityCountryProfile` is the authoritative source for Section 1.3 (Macro Profile). Retrieve it
for the **target counterparty's country of domicile**. Additionally, retrieve it for any **peer
whose country of domicile differs from the target's** — those peers get a condensed supplemental
note (see Macro Profile authoring rules). Peers domiciled in the same country as the target do
not require a separate call.

For the market-based PD complement (5-year CDS spread / senior unsecured bond spread), no
dedicated Moody's MCP tool returns these. Use `webSearch` (the enterprise Gemini-grounded search
tool available on the `M0 - Prod - Moodys MCP - NEW URL` server) or `searchNews`, querying for
each institution's current 5-year CDS spread and/or senior unsecured bond spread. Cite whatever
source the search surfaces (e.g. a market-data provider or news article reporting the level) in
the end-of-document Citations list. If no reliable figure is found for an institution, write
`N/A` in that institution's market-spread row — never fabricate a spread level.

`getEntityFinancials_v2` is the **sole authoritative source for all six Key Indicators charts** in Section 1.5 (Capital Adequacy, Asset Quality, Earnings, Management/Efficiency, Liquidity, and Scale) — except for the Section 1.6 Scorecard, which is sourced entirely from `getCreditOpinion` `RatingFactors` (see below). For Financial Institution entities it is served by BankFocus, not the generic corporate pipeline — use the `prompt` parameter (LLM-parsed specifically for banking fields). Construct a broad prompt that covers all CAMELS dimensions at once, e.g.: `"capital adequacy ratios including CET1 and Common Equity Tier 1, asset quality including impaired loans and loan loss reserves, earnings metrics including net interest margin, return on equity and return on assets, cost to income ratio, liquidity ratios including LCR and NSFR and liquid assets to total assets, and total assets — annual periods plus latest interim period"`. Do **not** set `filterCriteria.excludeInterimData: true` — interim periods are permitted so that the latest available data is always shown.

> **Section 1.5 Key Indicators requires a multi-year time series, not a single snapshot year.** Request **up to 5 periods** (4 annual + latest interim as available) of history per metric per institution in the same `prompt` call — do not truncate to only the latest year. If an institution has fewer than 3 periods of history available, use whatever is available (down to a floor of 2 periods) rather than padding with fabricated figures, and note the shorter window in that institution's chart caption.
>
> Charts are rendered 2 per row in a CSS grid layout, grouped by CAMELS factor pair. Use `viewBox="0 0 560 260"` (narrower than the full-width KI chart area) for each of the six panels so they fit cleanly at half-page width. The `560×260` viewBox is fixed — new elements must fit within the existing plot area (x: 60–530, y: 20–210) without expanding it.

`ProbabilityOfDefault - Prod - Moodys MCP - NEW URL` — PD tools:
- `getEntityProbabilityOfDefault` — retrieve Current PD, 1-year PD, 5-year cumulative PD, and
  implied rating for the target institution AND each peer. Used to build the PD comparison panel
  in Section 3. Set `pd_comparison` to `null` in the JSON payload if data is unavailable for the
  target or fewer than 2 peers.

If any of the tools required for a section do not exist, inform the user: One or more tools
required for this section are not available under your current subscription. Unlock more of the
expert insights, data, and analytics you trust. Get Link:https://www.moodys.com/web/en/us/capabilities/gen-ai/ai-ready-data.html
with us to learn more.

## Bundled files

- `assets/template.html` — self-contained static report shell (CSS + named section placeholders,
  including pre-shaped tables for a fixed target+3-peer layout, with bank-specific row labels
  already baked in). No embedded data, no inline script. Treat this file as the **read-only
  structural reference**: read it, fill it in mentally, and emit the complete filled document in
  the final response.

## Execution plan

**Wave 1** (`parents: []`) — `findEntity` for the target + all peers (single parallel batch).

**Wave 2** (`parents: [wave-1]`) — all data-gathering calls in parallel:
- `getCreditOpinion` (all narrative sections) per institution
- `getEntityFinancials_v2` / BankFocus per institution
- `getEntityRatings` per institution
- `getEntityCountryProfile` for target country + any differing peer countries
- `getEntityProbabilityOfDefault` per institution
- `webSearch` / `searchNews` for CDS / bond spreads
- `getEntityPeers` (if `peers` parameter is absent)

**After Wave 2:** the orchestrator assembles the complete HTML document and writes it to disk using `saveDocumentToArtifact` (or direct `Write` to the output path). No separate `task-populate` dispatch — the LLM itself is the assembler for this skill.

---

## CRITICAL: Decide how to respond before doing anything

**Check the conversation history before doing anything else.**

**If a report has already been generated this session** (prior turns show a completed HTML file delivery):
- **Follow-on question** → read the relevant section(s) of the delivered report (or re-query the data tools if needed) and answer directly. Do NOT regenerate the full report.
- **Regeneration / update request** → ask: "Would you like me to regenerate the full report, or update a specific section?" and wait before proceeding.

**If no report has been generated yet** → run the full pipeline as described in Steps 1–4 below.

---

## Template (shared)

Before emitting the HTML report, **read both**:
1. [`../../plugins/moodys-skills:template/SKILL.md`](../../plugins/moodys-skills:template/SKILL.md)
   — authoring rules (which classes / snippets are owned by the shared layer, allowed per-skill
   overrides, outlook-badge usage).
2. [`../../plugins/moodys-skills:template/assets/template.html`](../../plugins/moodys-skills:template/assets/template.html)
   — canonical CSS (inside `<style id="shared-template-css">`) and literal HTML markup snippets
   (inside `<template>` tags) for the document head, cover, TOC, section block, footer, and
   outlook-badge. (The sources/citations wrapper is **not** taken from the shared scaffold in
   this skill — see the override note below.)

**Lookup order — always check the shared template before inventing.** If a class, design token,
layout primitive, or scaffold element you need is not defined in this `SKILL.md` or already
present in this skill's `assets/template.html`, the shared template skill is authoritative. Do
not invent CSS, HTML scaffolds, or design tokens that the shared skill already provides; do not
silently restyle anything the shared skill owns (cover, TOC, section, footer, outlook-badge,
design tokens, reset, body / page base).

At emit time, copy the **contents** (not the `<style>` wrapper) of `<style id="shared-template-css">`
from the shared asset into this skill's `assets/template.html` reserved marker region between the
CSS-comment markers `/* BEGIN shared-template-css ... */` and `/* END shared-template-css */`. For
HTML scaffolds (head boilerplate, cover, TOC, footer), use the literal markup from the matching
`<template>` snippet in the shared asset. **Exception — sources/citations wrapper:** do NOT use
the shared `sources-section` scaffold; this skill's `assets/template.html` already contains the
correct wrapper (`<div class="sources-section" id="pa-sources-anchor">`) with the heading labeled
`"Citations"`. Use that local markup verbatim — never substitute the shared snippet, which renders
the heading as `"SOURCES"`.

This skill uses the **`cover-multi`** variant, same as the corporate skill, with the same
`**.page { max-width: 1050px }**` override to fit the multi-column scorecard/key-indicators
tables. Skill-specific CSS that stays local: `.sub-heading`, `.pa-table`, `.credit-drivers-table`,
`.sc-table`, `.rating-card`, `.esg-heatmap`, `.ki-fy-header`, and the chart helpers
(`.chart-container`, `.chart-title`, `.chart-legend`, `.chart-legend-item`,
`.chart-legend-swatch`). All outlook-badge usage in this skill must use the canonical pastel
variants (`stable` / `positive` / `negative` / `review` / `na`) defined by the shared skill — no
solid-fill or inline-color overrides. This skill flags the target entity on the cover with
`class="company-chip target"`; the chip wrappers themselves come from the shared cover-multi
snippet.

## Citations (shared)

Before emitting any `[n]` reference inline, any per-section recap block, or the end-of-document
Citations block, **read both**:
1. [`../../plugins/moodys-skills:citations/SKILL.md`](../../plugins/moodys-skills:citations/SKILL.md)
   — authoring rules (numbering, hyperlinking, source data shape, carve-outs).
2. [`../../plugins/moodys-skills:citations/assets/template.html`](../../plugins/moodys-skills:citations/assets/template.html)
   — canonical CSS (inside `<style id="shared-citations-css">`) and literal HTML markup snippets
   for inline references, the end-of-document Citations block, and the optional
   `.section-citations` recap.

At emit time, copy the **contents** (not the wrapper) of `<style id="shared-citations-css">` from
the shared asset into this skill's `assets/template.html` reserved marker region, between the
CSS-comment markers `/* BEGIN shared-citations-css … */` and `/* END shared-citations-css */`.

The prefix used for the end-of-document container in this skill is `pa`, so the container id is
`#pa-sources`. **This skill does not use the shared per-section `.section-citations` recap
blocks** — see the "Citations & sources" step below for the single-list-at-the-end rule. Internal
MCP tool names (e.g. `getEntityFinancials_v2`) are NEVER rendered inside `.source-meta` or in
any `.source-note` line. Always substitute the friendly product/data-source label (e.g.
"Moody's Ratings", "Moody's Rating Macro Profile", "Moody's Analytics BankFocus", "Moody's
Credit Opinion", "Moody's Analytics Probability of Default").

---

## Step 1 — Resolve the target institution and confirm sector

The target institution is supplied by the user via the `counterparty_name` parameter (collected
in the first pop-up window of the parameter wizard). Call `findEntity` with that value, then
`getEntityProfile` to confirm the entity's sector is Financial Institutions (bank, insurer, asset
manager, or similar).

If the entity resolves to a non-financial corporate, **stop and tell the user** the corporate
`peer-analysis` skill is the correct tool for that entity, rather than producing a report with
metrics that don't apply.

---

## Step 2 — Discover and resolve peers

The user may have pre-selected peers via the `peers` parameter (collected in the second pop-up
window of the parameter wizard). If the `peers` parameter is non-empty, use those institutions
directly (up to 3) instead of calling `getEntityPeers`. If the `peers` parameter is empty or
absent, call `getEntityPeers` for the target institution and select the top 3 peers returned.

You now have a set of up to **4 institutions** (1 target + up to 3 peers). For each peer, call
`findEntity` to resolve its canonical entity name and ID.

> **Operating-bank-subsidiary peers need a second, parent-level ID for qualitative sections.**
> Validated end-to-end: `getEntityPeers` frequently returns peers at the **operating-bank**
> level (e.g. "Citibank, N.A.", "Bank of America, N.A.", "U.S. Bank National Association")
> rather than the **holding-company** level (e.g. "Citigroup Inc.", "Bank of America
> Corporation", "U.S. Bancorp"). Ratings and BankFocus financials resolve cleanly at the
> operating-bank level and should stay there. But `getCreditOpinion`'s narrative sections
> (`CreditStrengths`, `CreditChallenges`, `FactorsLeadingToUpgrade`, `FactorsLeadingToDowngrade`)
> are usually authored at the holding-company level — requesting them for the operating-bank
> entity ID often returns an unstructured multi-issuer rating-action press release instead of a
> structured credit opinion, which cannot be parsed into per-institution Credit Drivers cells.
>
> To handle this: for every peer, in the same `findEntity` call from this step, also resolve the
> likely holding-company name (typically the operating-bank name minus ", N.A." / "National
> Association", e.g. "Citibank, N.A." → "Citigroup Inc.", "Bank of America, N.A." → "Bank of
> America Corporation"). Keep both entity IDs for that peer: the **operating-bank ID** for
> `getEntityRatings` and `getEntityFinancials_v2`, and the **holding-company ID** for the
> `getCreditOpinion` narrative sections in Step 4. If the holding-company `getCreditOpinion` call
> also fails to return structured sections, fall back to the operating-bank entity's own result
> and write `Not available` for any section still missing — never fabricate strengths/challenges.

---

## Step 3 — Read the template

Read `assets/template.html` (relative to this skill directory) once. Keep its exact structure —
CSS, `<head>`, section order, table skeletons (including all pre-shaped 4-institution
columns/rows), row labels, and element IDs — as the scaffold for the final artifact. Do **not**
copy it to the workspace and do **not** open it.

---

## Step 4 — Gather all data in parallel

For every institution in the set (target + up to 3 peers), fire **all of the following in a
single parallel batch** (one message, many tool calls):

> **Transient errors — retry once before treating data as unavailable.** Validated end-to-end:
> calls to `getEntityProfile`, `getEntityRatings`, and `getEntityProbabilityOfDefault`
> occasionally fail with a `"No approval received"` error on the first attempt and succeed
> immediately on retry. Treat this specific error as transient: retry the exact same call **once**
> before concluding the data is genuinely unavailable. Only after a retry failure should the
> corresponding cells fall back to `"--"` / `Not available`, or (for the PD tool specifically)
> trigger the `pd_comparison: null` fallback described below.

### Credit Opinion data (per institution)

Call `getCreditOpinion` requesting these sections. For the target, use its own entity ID. For
each peer, use the **holding-company entity ID** resolved in Step 2 if one was found; otherwise
use the operating-bank entity ID:

| Section parameter | Purpose |
|---|---|
| `Summary` | Institution description for the Peers Table |
| `FactorsLeadingToUpgrade` | Upgrade factors for Credit Drivers |
| `FactorsLeadingToDowngrade` | Downgrade factors for Credit Drivers |
| `CreditStrengths` | Credit strengths for Credit Drivers |
| `CreditChallenges` | Credit challenges for Credit Drivers |
| `RatingFactors` | Bank scorecard methodology data — source of Section 1.6 Scorecard rows (Capital, Asset Risk, Profitability, Funding Structure, Liquid Resources) |
| `ESGConsiderations` | ESG classification and E/S/G sub-scores |

> **The Section 1.6 Scorecard comes from `RatingFactors` — not BankFocus.** The `RatingFactors`
> table supplies **all** of Section 1.6's Scorecard rows (Capital, Asset Risk, Profitability,
> Funding Structure, Liquid Resources, Financial Profile, Adjusted BCA, Final Rating) — see the
> Section 1.6 sourcing note below for the full row mapping. The Scorecard is meant to reproduce
> Moody's own published table exactly and must not be sourced from `getEntityFinancials_v2`.
>
> **Section 1.5 Key Indicators (all six charts) are sourced exclusively from `getEntityFinancials_v2`
> / BankFocus** — including Asset Quality and Liquidity metrics. Use the best available ratio for
> each CAMELS dimension as described in the Required Fields table below.

### Financials (per institution) — bank-specific, via BankFocus

> **CRITICAL — `getEntityFinancials_v2` is the authoritative source for all quantitative data
> except NPL/Asset Risk, HQLA Ratio, and the Scorecard table (see Section 1.6 sourcing note
> below).** Call it **without** `filterCriteria.excludeInterimData` (i.e. allow interim periods)
> so that the most recent available data — whether a full fiscal year or an interim period — is
> returned. Use a `prompt` describing the exact banking fields needed, e.g.: `"CET1 ratio, net
> interest margin, cost to income ratio, and total assets for the most recent available period
> including interim"`. Do NOT rely solely on Key Indicators exhibits embedded in
> `getCreditOpinion` — those may reference an older period. After fetching financials, identify
> each institution's **latest available period** (annual or interim) with a non-null Total Assets
> value and use that period's data for the Key Indicators charts. LTM figures are **not permitted**.

Required fields per institution, **all from `getEntityFinancials_v2` / BankFocus** (used in the Section 1.5 KI charts). Select the best available ratio for each CAMELS dimension — the exact field name is flexible depending on what the institution reports; use your judgement to pick the most appropriate available figure:

| CAMELS dimension | Preferred ratio(s) — pick the best available |
|---|---|
| **C — Capital Adequacy** | "Common Equity / Core Tier 1 ratio (as reported)%" · "Total equity / Risk-weighted assets (RWAs)%" · CET1 ratio · Tier 1 capital ratio |
| **A — Asset Quality** | "Impaired loans / Gross customer loans & advances%" · "Non-performing loans / Total loans%" · "Loan loss reserves / Impaired loans%" |
| **E — Earnings** | "Net interest margin (average interest earning assets)%" · "Return on average equity (ROAE)%" · "Return on average assets (ROAA)%" |
| **M — Management / Efficiency** | "Cost-to-income (Efficiency) ratio%" |
| **L — Liquidity** | "Basel Liquidity Coverage Ratio (LCR)%" · "Basel Net Stable Funding Ratio (NSFR)%" · "Liquid assets / Total assets%" |
| **S — Scale** | Total assets (absolute, USD bn or local currency bn) · Operating revenues |

For each dimension, retrieve the time series covering **up to 4 annual periods** plus the **most recent interim period** (if available). If the preferred ratio is not populated for a given institution, fall back to the next best available in that dimension — note the substitution in the `#pa-ki-source-note`.

From `getCreditOpinion`'s `RatingFactors` section (still required for the Scorecard only):
- All five scorecard sub-factor Historic Ratio / Assigned Score pairs, Financial Profile,
  Adjusted BCA, and Final Rating — used entirely in the Section 1.6 Scorecard table (see below)

### Ratings (per institution)

Call `getEntityRatings` — retrieve the **full FI rating suite**, not just the long-term issuer
rating, since Section 1.2 (Peer Ratings) now presents all of the following per institution, in
this fixed order (write `N/A` for any field genuinely not applicable to that institution type,
e.g. Deposit Ratings for an asset manager — never leave the row silently blank):

| Field | Notes |
|---|---|
| Long-Term Rating | Rating class + rating date also captured for the card meta line |
| Outlook | Rendered as the canonical outlook-badge |
| Short-Term Rating | If published |
| Baseline Credit Assessment (BCA) | From `getEntityRatings` if present; otherwise fall back to the "Adjusted BCA" row's paired unadjusted BCA in the Credit Opinion `RatingFactors` table (Section 1.6 source) — if using the fallback, note it came from the Credit Opinion, not `getEntityRatings`, in the source note |
| Adjusted BCA | Same source priority as BCA |
| Counterparty Risk (CR) Assessment | From `getEntityRatings` |
| Counterparty Risk (CR) Rating | From `getEntityRatings` |
| Deposit Rating (Long-Term / Short-Term) | From `getEntityRatings`; `N/A` for non-deposit-taking institutions (insurers, asset managers) |

Also retrieve historical ratings (need at least the last 5 rating actions) to support the rating trajectory narrative in `#pa-ratings-analysis` (Section 3). **Do NOT build a chart from this data — Section 3 contains no chart of Moody's ratings.**

> **Consistent sourcing, run after run.** `getEntityRatings` is the primary and preferred source
> for every field above. Only fall back to the Credit Opinion `RatingFactors` table for BCA /
> Adjusted BCA, and only when `getEntityRatings` does not return them. Never mix sources for the
> same field across institutions in the same report — if the target's BCA comes from
> `getEntityRatings` but a peer's has to fall back to the Credit Opinion, that is fine (per
> institution), but do not substitute a Credit Opinion value for a field `getEntityRatings`
> already answered just because the two might disagree.

### Macro Profile (target counterparty + cross-country peers)

**Primary paragraph (`#pa-macro-profile`):** Call `getEntityCountryProfile` for the **target
counterparty's** country of domicile. Write a **single paragraph of 3–4 sentences** (~60–90
words) covering: sovereign rating and credit trend, growth/macro outlook headline, and the single
most relevant structural or external risk factor for that country. This section is intentionally
short — it is context for the credit comparison, not a standalone sovereign report.

**Supplemental paragraph (`#pa-macro-peers`) — conditional:** Only include this paragraph when
**at least one peer is domiciled in a different country than the target**. In that case:

- Call `getEntityCountryProfile` for each distinct peer country that differs from the target's.
- Write a **single short paragraph of 2–3 sentences** (~40–60 words) per differing-country peer
  (or group peers from the same foreign country together). Cover: sovereign rating and the single
  most relevant macro differentiator versus the target country. Introduce with the peer
  institution name(s) and their country, e.g. *"[Peer Name] (France): …"*
- If **all peers share the target's country**, leave `#pa-macro-peers` empty (the element will
  be hidden automatically via CSS).

### Probability of Default + market-implied credit view (target + all peers)

Call `getEntityProbabilityOfDefault` for the target institution AND every resolved peer in a
single parallel batch. Retrieve:
- 1-year PD (%)
- 5-year cumulative PD (%)
- PD-implied rating

Compute the **peer average** for 1-year PD and 5-year cumulative PD (exclude the target).
Determine `pd_signal`:
- `"red"` — target 1-year PD is >2× peer average
- `"amber"` — target 1-year PD is 1.25–2× peer average
- `"green"` — target 1-year PD is ≤1.25× peer average

Build `pd_gap_1yr` label (e.g. `"+0.045pp above peer avg (2.1×)"`).

Then, for the same set of institutions, gather the **market-implied complement**: each
institution's current **5-year CDS spread (bps)** and/or **senior unsecured bond spread (bps)**,
via `webSearch` or `searchNews` (see "Required MCP servers" above — no dedicated Moody's MCP tool
returns these). This is a market-perspective cross-check next to the modeled PD, not a
replacement for it — keep the two visually distinct in the panel (see Section 3 below). Write
`N/A` for any institution where no reliable current figure is found.

Set `pd_comparison` to `null` if the PD tool is unavailable or data is missing for the target or
fewer than 2 peers — the panel is suppressed automatically.

Hold all results in context for Step 5 synthesis.

---

## Narrative Voice — Comparative-Analytical Framing (applies throughout)

All narrative prose in this report shifts from descriptive to **comparative-analytical**. Wherever a metric or fact about the target institution is stated, the same sentence or the immediately following one must address what differentiates the target from peers and why that difference matters to the credit profile.

- **Do not** write sentences that only restate a data point already visible in a table or chart (e.g. "ROAE was 6.83% in FY2025") without a comparative or credit-relevance clause attached.
- Every material metric must answer: (a) how does this compare to peers, and (b) why does this gap matter for credit quality or rating trajectory.
- Applies most heavily to the Executive Summary, Credit Drivers narrative, and Conclusions.
- This is a rewrite of framing and emphasis, not a request for more data — keep prose disciplined; cut neutral description that does not serve differentiation or credit relevance.
- Apply the comparative clause only where the metric is material to the rating — incidental facts (dates, business segments, geographic footprint) do not require a forced comparison.

---

## Step 5 — Synthesize + emit the complete artifact

After data is gathered, assemble the complete filled HTML document and write it to disk, then
present it to the user for download.

The assembled document **must**:

- Be a complete, standalone HTML document (doctype → `</html>`) that renders without external
  dependencies.
- Preserve the template's `<head>` (CSS, fonts), section order, table skeletons, row labels, and
  element IDs exactly. Only the empty targets defined below are populated.

Write in professional financial/credit analysis language. Always reference specific institutions
by name. The target institution is **always the first column / first row** in every table.

Attribute substantive claims with numbered citation references, per the shared citations rules.

### Cover / header fields (write first)

- `#pa-report-date`, `#pa-footer-date` — e.g. `July 1, 2026` (plain text)
- `#pa-target-company` — canonical name of the target (plain text)
- `#pa-peer-count` — integer count of peers resolved in Step 2 (plain text)
- `#pa-company-chips` — `<span class="company-chip target">Target</span>` followed by one
  `<span class="company-chip">Peer</span>` per peer (space-separated; target first)
- `#pa-cover-img-right`, `#pa-cover-img-bottom` — optional, same rules as the corporate skill.
  Leave as-is if no images are available.

### Executive Summary → `#pa-exec-summary` (write second, after the cover — but only once the rest of the analysis is drafted)

Write this **last in your own reasoning process**, even though it renders first in the document —
it is a synthesis of everything else, so draft it after Sections 1–3 are substantively done, then
place the result in `#pa-exec-summary`.

**Length guardrail: ~280–300 words.** The `exec-summary-box` remains a single prose block — do not convert to bullets or sub-sections. If a relevant comparison doesn't fit without exceeding the cap, prioritize the comparison and trim neutral description.

Emit a **single `<p>` paragraph** (~280–300 words) directly inside `<p id="pa-exec-summary">`. The paragraph must read as a coherent prose narrative and must cover, in order, using **comparative-analytical framing** throughout:

1. **Relative rating position** — where the target sits vs. its peer set and *why* (be specific about the driver: governance/complexity, capital, asset quality, etc., not just the direction). State the specific rating gap and the factor(s) that explain it.
2. **Strongest and weakest relative factors** — the one dimension where the target leads peers and the one where it lags, each with a supporting figure **and a credit-relevance clause** (e.g. why the lead is durable, or why the lag constrains the rating).
3. **Market vs. modeled view and any decisive macro/ESG context** — whether PD-implied and market-implied (CDS/bond spread) signals corroborate or diverge from the assigned rating, and any macro or ESG differentiator that materially conditions the relative positioning — not just that it exists, but what it implies for the credit gap.

Use `<strong>` to bold the target institution name and the key metrics/drivers on first reference,
e.g.: `<strong>Citigroup</strong> sits one notch below peer average, reflecting franchise
complexity and governance factors; its <strong>CET1 of 13.5%</strong> leads the peer set while
a cost/income ratio of 67% remains the principal drag relative to the ~58% peer median, constraining
the profitability uplift needed for an upgrade.` May carry inline citations.

Do not restate the full Conclusion narrative — this is a distilled headline paragraph, not a prose summary. Each sentence must add comparative insight, not just label a fact.

### Section 2 — Peers Comparison Table & Analysis

**1) Peers Table** → `<tbody id="pa-peers-table">`

One `<tr>` per institution. Two columns: institution name + a substantive description paragraph
sourced from `Summary` (headquarters, business model — retail/commercial/universal bank, insurer
line of business, etc. — and approximate total assets). May carry inline citations.

**2) Peer Ratings** → `#pa-rating-cards`

Emit one `<div class="rating-card">` per institution (target first). Each card carries the
institution name (with `<span class="rc-target-tag">Target</span>` appended for the target only),
followed by one `<div class="rc-row">` per field, **in this fixed order**, so the layout is
identical run after run:

```html
<div class="rating-card">
  <div class="rc-name">Citigroup Inc. <span class="rc-target-tag">Target</span></div>
  <div class="rc-row"><span class="rc-label">Long-Term Rating</span><span class="rc-value">A1</span></div>
  <div class="rc-row"><span class="rc-label">Outlook</span><span class="outlook-badge stable">Stable</span></div>
  <div class="rc-row"><span class="rc-label">Short-Term Rating</span><span class="rc-value">P-1</span></div>
  <div class="rc-row"><span class="rc-label">BCA / Adj. BCA</span><span class="rc-value">baa1 / a3</span></div>
  <div class="rc-row"><span class="rc-label">CR Assessment</span><span class="rc-value">A1(cr)</span></div>
  <div class="rc-row"><span class="rc-label">CR Rating</span><span class="rc-value">A1</span></div>
  <div class="rc-row"><span class="rc-label">Deposit Rating (LT/ST)</span><span class="rc-value">A1 / P-1</span></div>
</div>
```

Row order is fixed: Long-Term Rating → Outlook → Short-Term Rating → BCA/Adj. BCA → CR Assessment
→ CR Rating → Deposit Rating. Use `N/A` in the value span for any field not applicable to that
institution type — never drop the row, since column alignment across cards depends on every card
having the same row set. Immediately below `#pa-rating-cards`, add one `.source-note` line stating
the source per the sourcing-priority rule above, e.g.: `Source: Moody's Ratings (all fields);
Credit Opinion Rating Factors used as fallback for BCA/Adjusted BCA where primary ratings data
did not return a value.`

**3) Macro Profile** → `#pa-macro-profile` + `#pa-macro-peers` (conditional)

**`#pa-macro-profile`:** Write a **single paragraph of 3–4 sentences** (~60–90 words) focused
exclusively on the **target counterparty's** country of domicile. Cover: (1) sovereign rating and
credit trend, (2) growth/macro outlook headline, and (3) the single most relevant structural or
external risk factor.

**`#pa-macro-peers` (conditional):** Include only when at least one peer is domiciled in a
**different country** than the target. Write a short paragraph (2–3 sentences, ~40–60 words per
foreign-country peer or peer group from the same country) noting the sovereign rating and the
single most relevant macro differentiator versus the target. Introduce each foreign-country peer
by name and country, e.g. *"[Peer Name] (France): …"* If all peers share the target's country,
leave this element empty — it will be hidden automatically.

Immediately below both paragraphs, one `.source-note` line: `Source: Moody's Rating Macro Profile.`

**4) Credit Drivers** — 4 rows × 4 institution columns, pre-shaped `<table>` with per-cell IDs

Write the 4 institution header cells (`#pa-cd-col-1..4`), then the 16 body cells
(`#pa-cd-r{1..4}-c{1..4}`) synthesized from `FactorsLeadingToUpgrade`, `FactorsLeadingToDowngrade`,
`CreditStrengths`, `CreditChallenges` respectively.

> **MANDATORY FORMAT — bullet points only.** Every one of the 16 body cells (`#pa-cd-r{1..4}-c{1..4}`)
> **MUST** be rendered as an HTML unordered list: `<ul><li>…</li></ul>`. Plain prose, run-on
> sentences, or bare text are **not acceptable** in any Credit Drivers cell — no exceptions.
> The minimum is 2 bullets per cell; the maximum is 4. If a section is missing for an institution,
> write a single `<li>Not available</li>`.

> **Do not copy/paste Credit Opinion text into these cells.** Each bullet must be a compressed,
> paraphrased restatement of the underlying driver in your own words — not a sentence lifted or
> lightly reworded from the source. Distill each source section down to its distinct factors rather
> than reproducing full sentences; if the source lists five overlapping points, collapse them into
> 2–3 bullets that capture the distinct ideas. This is a synthesis table, not a source excerpt.
> Quantitative support is covered by the Key Indicators charts immediately below, not by a fifth
> row here.

> **Upgrade / Downgrade deduplication — per institution column only.** Before finalising the
> "Upgrade factors" and "Downgrade factors" `<li>` items for each institution:
>
> - Check each downgrade factor against the upgrade factors already listed for the **same** institution column (and vice versa). If a downgrade factor is simply the inverse or negation of an upgrade factor already listed (e.g. upgrade: "sustained execution of the transformation program" → downgrade: "delay or setback in the transformation program"), **do not include both**. Keep the factor in whichever direction is more analytically informative or more consistent with the rating agency's language, and drop the mirrored restatement.
> - Each factor (upgrade or downgrade) must represent a **distinct** credit consideration, not the same underlying driver in opposite polarity.
> - This deduplication rule applies **per institution column** only — do not compare factors across different institutions' columns.
> - This rule applies **only** to the "Upgrade factors" / "Downgrade factors" rows (rows 1–2) — it does **not** apply to "Credit strengths (qualitative)" / "Credit challenges (qualitative)" rows (rows 3–4), which may legitimately show a strength and a related challenge from different angles.
> - Guardrail: deduplication removes only mirrored/opposite-polarity redundancy. If, after deduplication, a cell would be left with fewer than 2 factors, keep the original list rather than forcing an overly short one. Do not modify the `<ul>/<li>` HTML structure — only the text of each `<li>`.

**5) Key Indicators — Peer Trend Charts** → `#pa-ki-charts`

This section now shows a **multi-year trend**, not a single-year snapshot — the goal is to let
the reader see trajectory, not just relative level, across the peer set.

Charts are organized by **CAMELS methodology** (Capital Adequacy, Asset Quality, Management /
Efficiency, Earnings, Liquidity, Sensitivity). Emit all content **inside** `#pa-ki-charts` in
this order:

1. A `<div class="ki-fy-header">` banner (spans both grid columns) stating the period range and
   the CAMELS framing, e.g. `KEY INDICATORS — FY2021–H1 2025 TREND | CAMELS Framework — Institution vs. Peers`.
   Use the earliest period on the left and the most recent period (which may be interim) on the right.
2. For each CAMELS factor group, emit a `<div class="ki-camels-label">` divider (also full-width,
   spans both grid columns automatically via CSS) immediately before its chart(s).
3. Then the `.chart-container` panel(s) for that factor (each panel fills one grid column; two
   panels placed consecutively occupy one full row).

**Chart order — 6 panels in 3 rows of 2, grouped by CAMELS factor:**

| Row | Charts (left → right) | CAMELS factor | Shared `.ki-camels-label` divider |
|-----|----------------------|---------------|----------------------------------|
| 1 | Capital Adequacy ratio `%` · Asset Quality ratio `%` | **C**apital Adequacy + **A**sset Quality | `C — Capital Adequacy / A — Asset Quality` |
| 2 | Earnings metric `%` · Efficiency ratio `%` | **E**arnings + **M**anagement Efficiency | `E — Earnings / M — Management & Efficiency` |
| 3 | Liquidity ratio `%` · Scale metric | **L**iquidity + Scale | `L — Liquidity / S — Scale` |

Use the actual metric name retrieved from BankFocus as the `.chart-title` (e.g. "Common Equity Tier 1 Ratio %" or "Impaired Loans / Gross Loans %"), not a fixed generic label — this makes the chart accurate when a fallback ratio was used.

> The "S — Sensitivity" CAMELS factor covers market-risk / interest-rate sensitivity, which is
> not reliably available as a standalone time-series. Total Assets or Operating Revenues is
> presented as the scale indicator — label the divider `S — Scale` rather than "Sensitivity"
> to be accurate about what the metric actually measures.

**Corrected emit sequence inside `#pa-ki-charts` (2 charts per row):**

```
ki-fy-header                            ← spans both columns
ki-camels-label "C — Capital Adequacy / A — Asset Quality"   ← spans both columns
chart-container [Capital Adequacy ratio]   ← column 1, row 1
chart-container [Asset Quality ratio]      ← column 2, row 1
ki-camels-label "E — Earnings / M — Management & Efficiency" ← spans both columns (new row)
chart-container [Earnings metric]          ← column 1, row 2
chart-container [Cost/Income ratio]        ← column 2, row 2
ki-camels-label "L — Liquidity / S — Scale"                  ← spans both columns (new row)
chart-container [Liquidity ratio]          ← column 1, row 3
chart-container [Scale metric]             ← column 2, row 3
```

There are **3 `ki-camels-label` dividers** (one per pair-row) and **6 `chart-container` panels** — 2 charts per visual row, 3 rows total.

**Chart type: multi-series line chart (all panels).** Build each panel as an inline SVG line chart with `viewBox="0 0 560 260"` (the `560×260` viewBox is **fixed** — do not change it; all chart elements must fit within the existing plot area x: 60–530, y: 20–210). Use `<polyline>` per institution, `<circle>` markers at each data point, light horizontal gridlines, period labels on the x-axis. The chart type is not converted to bars or any other type.

- X-axis: the periods actually retrieved (**up to 4 annual periods + latest interim**, if available), most recent on the right. Label each point with its period identifier (e.g. `FY2024`, `H1 2025`).
- One line per institution — target `#0066cc` (drawn last/on top), peers `#7ca8d8` / `#e0a0a0` / `#c9a0e0`, no separate AVERAGE line. Highlight each line's most recent point with a slightly larger filled circle.
- `.chart-title` above each panel names the specific metric retrieved. Do **not** add a source note inside the chart panel itself — the shared `#pa-ki-source-note` covers all panels.
- If an institution has fewer periods of data than the others, its line simply starts later on the x-axis — do not interpolate or backfill missing periods. If fewer than 2 periods exist for an institution, note it in the `#pa-ki-source-note`.
- If a fallback ratio was used for a dimension, use the actual field name as the chart title and note the substitution in `#pa-ki-source-note`.

**Additional SVG elements per chart (inside the existing `560×260` plot area):**

**(a) Directionality label** — immediately after the `.chart-title`, add a small `<div class="chart-direction-label">` with the appropriate text:
- `"▲ Higher is generally favorable"` for metrics where a higher value is better (CET1, NIM, ROAE, ROAA, LCR, NSFR, Liquid Assets Ratio)
- `"▼ Lower is generally favorable"` for metrics where a lower value is better (NPL ratio, impaired loans ratio, cost-to-income ratio)
- Omit for pure scale metrics such as Total Assets (no directional signal is universal)
- **Guardrail:** text ≤ 30 characters, same reduced font size (~9px), no redesign of the chart header.

**(b) Peer median reference line** — add a dashed horizontal `<line>` spanning x: 60–530 at the y-coordinate corresponding to the median value of all four institutions for each FY period, **or** a single straight reference line at the final-period cross-sectional median if the full-period median series is noisy. Render as: `stroke="#aaaaaa"`, `stroke-width="1"`, `stroke-dasharray="4,3"`. Label it `"Peer median"` with a `<text>` element at the right edge (x≈532, same y, `font-size="8"`, `fill="#aaaaaa"`). Include `"Peer median"` as an entry in the `.chart-legend` with a grey dashed swatch. **Guardrail:** stroke-width ≤ 1px, no circle markers on this line (the 4 bank lines have them — the median does not). This ensures the peer comparison lines remain the primary visual focus.

**(c) Regulatory benchmark line (where applicable)** — for metrics with a known, publicly disclosed regulatory minimum, add a labeled reference line or shaded threshold zone:
- **CET1 / Tier 1 Capital ratio**: horizontal `<line>` at the applicable minimum (Basel III Pillar 1 minimum 4.5% for CET1, plus the G-SIB surcharge if the institution is a G-SIB; use only the Pillar 1 floor if surcharge is not publicly determinable). Label: `"Reg. minimum"`.
- **LCR**: horizontal `<line>` at y = 100% (Basel III minimum). Label: `"Min. 100%"`.
- **NSFR**: horizontal `<line>` at y = 100% (Basel III minimum). Label: `"Min. 100%"`.
- Render as: `stroke="#cc6600"`, `stroke-width="0.8"`, `stroke-dasharray="2,2"`, label in matching color `font-size="8"`.
- **Only include where a defensible, publicly disclosed benchmark exists — never fabricate one.** Omit for Asset Quality, Earnings, Efficiency, and Scale charts (no universal regulatory floor).

**(d) Management target band (where publicly disclosed)** — if the target institution has publicly disclosed a capital or ratio operating target/range (e.g. a CET1 management buffer stated in an investor presentation or annual report), render it as a subtle shaded band (`<rect>` with `fill="rgba(0,100,200,0.06)"` and a `<text>` label `font-size="8"`). **Omit if not publicly disclosed — never fabricate a target.**
- **Guardrail:** maximum **one** additional line/band between (c) and (d) combined per chart, unless both can coexist without overlapping the 4 bank lines + median. If they would overlap, prioritize (c) the regulatory benchmark and omit (d).

**Guardrail for (b)–(d):** all reference elements are visually subordinate to the four peer lines. The 4 bank lines with circle markers remain the primary visual focus.

**(e) Interpretive callout (`div.chart-insight`)** — immediately **below** each `.chart-container` (as a sibling element, **never** inside the `<svg>` or the `.chart-container`), add a `<div class="chart-insight">` block with 2–3 short bullet points covering:
1. How the target compares to the peer median / regulatory minimum at the latest FY — stated comparatively (e.g. "Target CET1 leads peer median by ~150 bps")
2. Whether the trend is improving / stable / deteriorating (based on the visible direction over the period shown)
3. Whether this constitutes a relative strength, relative weakness, or emerging risk for the target's credit profile

**Guardrail:** factual and analytical tone; do not restate numbers already readable in the chart; no unsupported causal claims. These bullets are outside the chart container and do not enlarge it. The 2-column grid (`#pa-ki-charts`) is unchanged. The `.chart-insight` element is placed **outside** `#pa-ki-charts` — emit it as a sibling immediately after the matching `.chart-container` using the CSS grid's natural flow, so it appears below its chart in the visual layout.

**Source note** → `#pa-ki-source-note`, immediately after the `#pa-ki-charts` grid (as a sibling `<div>`, not inside the grid):

Keep it to **one or two short lines only**:
- Standard single-source case (all metrics from BankFocus): `Source: Bank Focus.`
- If any metric came from a different source, list it: e.g. `Source: Bank Focus. LCR and NSFR sourced from Moody's Ratings where BankFocus data was unavailable.`
- **If institutions have different latest periods**, append: `Note: Latest available period differs across institutions — [Institution A]: H1 2025; [Institution B]: FY 2024.`
- If a ratio substitution was made for any dimension, briefly note it: e.g. `Note: NSFR used for [Institution B] in place of LCR (not available).`

Do **not** repeat this note inside any chart panel — this single block covers all panels.

> **PERIOD SYNCHRONY**: Always show the **latest available period per institution**, including interim periods — do not truncate to annual-only. If different institutions have different latest periods across any chart, include the period-difference note in `#pa-ki-source-note`. The Scorecard in Section 1.6 is sourced entirely from the Credit Opinion's own effective date — do not force alignment between the KI charts and the Scorecard; label each section with its own actual source date.

**6) Scorecards** — 8 rows × 8 sub-columns (4 institutions × Historic Ratio/Assigned Score), pre-shaped `<table>`

> **Sourcing — Moody's Credit Opinion Scorecard only.** This table is built **entirely** from
> the `RatingFactors` section of each institution's `getCreditOpinion` result. Do not pull any
> value in this table from `getEntityFinancials_v2` / BankFocus, even if a similar-looking figure
> is available there — the point of this table is to reproduce Moody's own published scorecard,
> not a BankFocus-derived approximation of it. Use the **target's own entity ID** and the
> **holding-company entity ID** resolved for each peer in Step 2 (the same ID used for the
> Credit Drivers narrative sections), since the scorecard is part of the same Credit Opinion
> document as those sections.

Write the institution headers (`#pa-sc-col-1..4`, plain institution names — no period label,
since the table is not FY-based). The "Historic Ratio" / "Assigned Score" sub-header labels are
static text already present in the template — do not overwrite them.

Then write the 64 body cells for these 8 rows, sourced from the `RatingFactors` table's five
standard scorecard sub-factors, plus the three outcome rows:

- Row 1 — Capital: Tangible Common Equity / Risk-Weighted Assets
- Row 2 — Asset Risk: Problem Loans / Gross Loans
- Row 3 — Profitability: Net Income / Tangible Assets
- Row 4 — Funding Structure: Less-Stable Funds / Tangible Banking Assets
- Row 5 — Liquid Resources: Core Banking Liquidity / Tangible Banking Assets
- Row 6 — Financial Profile (combined score)
- Row 7 — Adjusted BCA
- Row 8 — Final Rating (long-term rating)

For Rows 1–5, populate both sub-columns per institution: `-hist` = the "Historic Ratio" value
from that factor's row in the RatingFactors table (e.g. `13.7%`), `-score` = the "Assigned Score"
value from the same row (e.g. `baa1`). For Rows 6–8, there is no historic ratio — write `—` in
the `-hist` cell and put the outcome value in the `-score` cell (Financial Profile score, e.g.
`a3`; Adjusted BCA, e.g. `a2`; Final Rating, the institution's actual long-term rating from
`getEntityRatings`, e.g. `A1`). Write `N/A` in any cell whose source value is genuinely absent
from the RatingFactors table for that institution — do not estimate or infer.

**Source note** → `#pa-sc-source-note`, immediately below the table:

One short line, e.g.: `Source: Moody's Credit Opinion Rating Factors (scorecard).` Keep
this brief — it is a provenance footnote only; the full citation with report title, date, and
link belongs in the end-of-document Citations section, not repeated here.

### Section 3 — Probability of Default Analysis

**HARD RULE — no ratings chart:** Section 3 contains **no SVG chart, no bar chart, no visual of any kind showing Moody's Long-Term Issuer Ratings or any Moody's-assigned rating notches.** Rating notch visuals are already covered in Section 1 (rating cards) and Section 6 (Scorecard). This section renders PD data as **per-institution cards** in `#pa-pd-panel`, plus the prose paragraph `#pa-ratings-analysis`. If you find yourself writing `<svg>`, a `chart-container` div, or a comparison table in Section 3, stop — that is wrong.

**Section title** (written into the section `<h2>` or equivalent heading element):
- If `pd_comparison` is not `null`: `"Probability of Default Analysis"` followed immediately
  by a small colour badge: `<span class="pd-signal-badge pd-signal-{pd_signal}"></span>`
  (amber/red/green dot, CSS-driven). The badge is omitted when `pd_comparison` is `null`.
- If `pd_comparison` is `null`: `"Probability of Default"` (plain, no badge); the `#pa-pd-panel`
  is left empty and no table is rendered.

**`#pa-pd-panel` — PD institution cards** (only when `pd_comparison` is not `null`):

Render one `<div class="pd-card">` per institution inside `#pa-pd-panel` (target first, then
peers, left-to-right). The container `#pa-pd-panel` is a flexbox row (CSS already applied in the
template) — cards sit side by side and wrap on narrow viewports.

Each card structure:

```html
<div class="pd-card pd-card-target">   <!-- add pd-card-target only for the target institution -->
  <div class="pd-card-name">
    Institution Name <span class="rc-target-tag">Target</span>  <!-- rc-target-tag only for target -->
  </div>
  <div class="pd-row">
    <span class="pd-label">1-Year PD</span>
    <span class="pd-value">0.12%</span>
  </div>
  <div class="pd-row">
    <span class="pd-label">5-Year Cumul. PD</span>
    <span class="pd-value">0.55%</span>
  </div>
  <div class="pd-row">
    <span class="pd-label">Implied Rating</span>
    <span class="pd-value">A2</span>
  </div>
  <!-- Target card only: PD Signal row -->
  <div class="pd-row">
    <span class="pd-label">PD Signal</span>
    <span class="pd-signal-cell">
      <span class="pd-signal-green">▼ +0.04 pp vs. peers</span>
    </span>
  </div>
  <div class="pd-row">
    <span class="pd-label">5Y CDS Spread</span>
    <span class="pd-value">72 bps</span>
  </div>
</div>
```

**Per-card rules:**
- Use `class="pd-card pd-card-target"` (blue top border) for the target; `class="pd-card"` for peers.
- The `rc-target-tag` span and the PD Signal row appear **only** on the target card — omit both from peer cards.
- For the PD Signal span, pick `pd-signal-green` / `pd-signal-amber` / `pd-signal-red` to match the computed `pd_signal`.
- Write `N/A` as the `pd-value` text for any field genuinely unavailable — do not drop the row.
- For 5Y CDS Spread: write `N/A` if no reliable current figure was found; never fabricate a spread level.
- A peer-average summary row may be added at the bottom of each peer card (e.g. `<div class="pd-row"><span class="pd-label">vs. Peer avg (1Y)</span><span class="pd-value">…</span></div>`) if it adds analytical value — not required.

Add one `.source-note` line immediately below `#pa-pd-panel` (as a sibling, not inside a card):
`Source: Moody's Analytics Probability of Default (modeled PD); market spreads per web/news
search, see Citations.`

**`#pa-ratings-analysis` — analysis paragraph** (always present, even when `pd_comparison` is `null`):

Write **one `<p>` of 3–4 sentences (~60–80 words)**. Cover all three of the following in order:

1. **(a) Rating trajectory vs. peers** — describe the target's recent rating trend (stable,
   improving, under pressure) and how it compares to the peer group's collective trajectory.
   Reference specific rating levels or outlook changes where available.
2. **(b) PD signal corroboration** — state whether the modeled PD signal corroborates or diverges
   from the Moody's-assigned rating. If `pd_comparison` is `null`, note that PD data was not
   available and the assessment relies solely on the rating history.
3. **(c) Notable peer divergence** — identify any peer whose PD-implied signal or rating trend
   diverges meaningfully from the group, and briefly explain why (if discernible from the data).

### Section 4 — ESG: Heatmap Only

Emit only the colour-coded ESG heatmap (`#pa-esg-heatmap`) — institution, CIS, E, S, G scores,
colour-coded by severity — immediately followed by the analysis in `#pa-esg-analysis`.

**HARD RULE — single paragraph:** `#pa-esg-analysis` MUST contain exactly **one `<p>` element**.
Do NOT split into two or more paragraphs under any circumstances. The paragraph must cover all
ESG factors in a unified narrative (~60–100 words), addressing:

- The target's overall CIS score **and how it compares to the peer set** — state whether the target's ESG risk exposure is higher, lower, or broadly in line with peers, and what that difference means for the relative credit assessment.
- The Environmental sub-score and the specific factor(s) driving it (e.g. carbon transition, physical climate risk, green asset exposure).
- The Social sub-score and key driver (e.g. customer relations, workforce management, data privacy).
- The Governance sub-score and key driver (e.g. management credibility, financial policy, board structure).
- Any decisive macro/regulatory ESG context that materially conditions the above.

Weave all five points into a single flowing paragraph — no bullet points, no sub-headings, no
numbered lists inside `#pa-esg-analysis`. Do not emit a plain ESG table. The comparison to peers on the overall CIS score is required (one sentence); detailed per-sub-score peer comparisons are not required and should be omitted to keep within the word limit.

### Section 5 — Conclusions → `#pa-conclusion`

**Key Takeaways block (insert first, before the prose paragraphs):**

Emit a compact `<div class="key-takeaways">` block at the very top of `#pa-conclusion`, before any `<p>` paragraph. This is distinct from the methodology Scorecard in Section 2.6 (which shows Moody's rating-factor scores by ratio) — do not merge or duplicate that content; this block is a plain-language, peer-relative summary, not a methodology scorecard.

Structure: an HTML table inside `.key-takeaways` with three columns — **Dimension**, **vs. Peer Group**, **Key reason (3–8 words)**. Maximum **7 rows**, one per material credit dimension. Use only these dimensions: Capital, Asset Quality, Profitability, Efficiency, Liquidity, Market-implied Risk, ESG. For each row, populate "vs. Peer Group" with exactly one of: `<span class="kt-stronger">Stronger</span>`, `<span class="kt-weaker">Weaker</span>`, or `<span class="kt-aligned">Broadly Aligned</span>`.

**Prioritise by materiality:** order the rows so that dimensions with the greatest impact on the rating or rating trajectory appear first — not in a fixed template order. Identify which gaps vs. peers are most decision-relevant (e.g. a factor explicitly tied to upgrade/downgrade potential in the rating agency's language) and surface those at the top. Dimensions where the target is broadly aligned with peers appear last.

**Keep each line terse** — the block's purpose is to let a reader get the answer in seconds before drilling into the narrative below.

**Guardrail:** use CSS class `key-takeaways` — do not use or reuse `sc-table`. Do not expand beyond 7 rows.

**Prose paragraphs (follow the Key Takeaways block):**

Write **two `<p>` paragraphs** (3–4 lines each, ~50–80 words per paragraph), may carry inline citations. Apply **comparative-analytical framing** (see the global narrative voice rule): replace descriptive sentences with their comparative version; do not lengthen the section — the goal is to substitute, not add.

- **Paragraph 1:** Relative credit positioning — state how the target stands vs. peers on its most material dimensions (capital adequacy, asset quality, and the top factor from the Key Takeaways), citing specific ratios **with peer context** (e.g. "CET1 of X% vs. a peer median of Y%"). Identify the target's principal competitive strength or structural advantage within the peer set and why it is credit-relevant.
- **Paragraph 2:** Forward-looking positioning — link to the upgrade/downgrade framework, note the key risk factors or catalysts that could change the target's relative standing **vs. peers**, and close with a concise overall assessment of the target's credit trajectory relative to the peer group.

Do not reproduce the Executive Summary. This section synthesises the full analysis — ratings, financials, PD, ESG, and macro — into a final verdict on the target's relative position.

### Citations & sources (write last)

> **Citations live in exactly one place: the end-of-document Citations block.** This skill does
> **not** use the shared per-section `.section-citations` recap blocks — do not emit
> `#pa-cite-peers`, `#pa-cite-ratings`, `#pa-cite-esg`, or any other partial/mid-document source
> list. Inline `[n]` reference markers within prose are still used per the shared citations
> rules, but every `[n]` must resolve only in the single `#pa-sources` list at the bottom of the
> document — never repeat a mini source list under an individual section or table.

- `#pa-sources` — end-of-document Citations rows, `[1], [2], …` order, canonical row markup.
  Internal MCP tool names are NEVER rendered in `.source-meta` or in any `.source-note` line —
  use the friendly product/data-source name instead (e.g. "Moody's Ratings", "Moody's Rating
  Macro Profile", "Moody's Analytics BankFocus", "Moody's Credit Opinion", "Moody's Analytics
  Probability of Default"). Include one row for each distinct web/news source used for the
  market-implied CDS/bond spread figures (Step 4), in addition to the standard Moody's
  tool-derived rows.

---

## Element → content mapping

| Element ID | Content type |
|---|---|
| `#pa-report-date`, `#pa-footer-date` | Plain text date |
| `#pa-target-company` | Plain text (canonical target name) |
| `#pa-peer-count` | Plain text integer |
| `#pa-company-chips` | `<span class="company-chip target">` + `<span class="company-chip">`s |
| `#pa-exec-summary` | Single `<p>` paragraph of 3–4 sentences (60–90 words), may carry inline citations |
| `<tbody id="pa-peers-table">` | `<tr>` rows (institution name + description) with inline citations |
| `#pa-rating-cards` | `.rating-card` blocks, one per institution (target first), fixed 7-row field order |
| `#pa-macro-profile` | Single `<p>` paragraph of 3–4 sentences (60–90 words), target counterparty's country only |
| `#pa-macro-peers` | **Conditional** `<p>`: short paragraph (2–3 sentences, 40–60 words per foreign-country peer/group) summarising macro differentiators for peers domiciled in a different country than the target; leave empty (hidden) if all peers share the target's country |
| `#pa-macro-source-note` | One-line plain text data-provenance footnote |
| `#pa-cd-col-1..4` | Plain text (institution names) |
| `#pa-cd-r{1..4}-c{1..4}` | **MUST** be `<ul><li>…</li></ul>` bullet points (2–4 per cell); plain prose is not permitted. Paraphrased — never copy/paste source text. Missing section → `<li>Not available</li>` |
| `#pa-ki-charts` | CSS grid (2 columns). Contents: one `.ki-fy-header` banner (period range including any interim) + three `.ki-camels-label` dividers (each `grid-column:1/-1`) + six `.chart-container` line-chart panels in CAMELS order — Row 1: Capital Adequacy ratio / Asset Quality ratio, Row 2: Earnings metric / Cost-to-Income ratio (Management/Efficiency), Row 3: Liquidity ratio / Scale metric. All six panels sourced from `getEntityFinancials_v2` / BankFocus; use best available ratio per CAMELS dimension (see Required Fields table). Up to 4 annual periods + latest interim on x-axis; no source note inside individual panels |
| `#pa-ki-source-note` | One-line plain text data-provenance footnote |
| `#pa-sc-col-1..4` | Plain text institution names (no period sub-label) |
| `#pa-sc-r{1..8}-c{1..4}-hist/-score` | Plain text scorecard cell values ("—" for hist on rows 6–8) |
| `#pa-sc-source-note` | One-line plain text data-provenance footnote |
| `#pa-conclusion` | `<div class="key-takeaways">` table (max 7 rows, dimensions ordered by materiality; columns: Dimension / vs. Peer Group / Key reason) followed by two `<p>` paragraphs (3–4 lines each, ~50–80 words per paragraph, comparative framing). May carry inline citations. |
| `#pa-pd-panel` | Section 3 PD institution cards — one `<div class="pd-card">` per institution (target first, `pd-card-target` class for blue top border). Each card has `.pd-row` entries for 1-Year PD, 5-Year Cumul. PD, Implied Rating, PD Signal (target only, with `pd-signal-green/amber/red` badge), and 5Y CDS Spread. Empty when `pd_comparison` is `null`. **No SVG chart. No ratings bar chart. No comparison table.** |
| `#pa-ratings-analysis` | One `<p>` paragraph with inline citations |
| `#pa-esg-heatmap` | Colour-coded heatmap table |
| `#pa-esg-analysis` | Exactly **one `<p>` paragraph** (~60–100 words) — HARD RULE: single paragraph, no splits. Covers all ESG factors in one unified narrative: overall CIS score, E sub-score + driver, S sub-score + driver, G sub-score + driver, and any decisive macro/regulatory ESG context. No bullet points, no sub-headings inside this element. No peer comparisons. |
| `#pa-sources` | `.source-item` rows — the only citation list in the document |

If fewer than 3 peers are returned, leave unused column/row IDs empty. Do not collapse or remove
cells — the pre-shaped table simply keeps those cells blank.
