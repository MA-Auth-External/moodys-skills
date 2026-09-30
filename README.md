# Moody's Skills

A collection of AI agent skills that leverage [Moody's MCP tools](https://www.moodys.com) to produce professional financial analysis and reports. Each skill is a self-contained prompt-driven workflow that an AI coding agent (Cursor, Claude Code, OpenAI Codex, etc.) can follow end-to-end.

This repo ships as a **dual-format plugin**: it includes both a [Claude Code](https://docs.claude.com/en/docs/claude-code) manifest (`.claude-plugin/plugin.json`) and an [OpenAI Codex](https://developers.openai.com/codex/plugins/build) manifest (`.codex-plugin/plugin.json`). The skills, MCP config, and assets are shared between both — `SKILL.md` frontmatter and `.mcp.json` use the same schema across platforms.

## Quick start

### Claude Code

1. Install the plugin by pointing Claude Code at this directory (or install from a marketplace if available).
2. Ensure MCP access — the plugin ships with `.mcp.json` for the required Moody's servers. Provide valid API credentials.
3. Trigger a skill — ask Claude naturally. Each `SKILL.md` defines trigger phrases in its frontmatter.

### OpenAI Codex

1. Install the plugin in one of two ways:
   - **Direct install:** `codex plugin install MA-Auth-External/moodys-skills`
   - **Via marketplace:** `codex plugin marketplace add MA-Auth-External/moodys-skills` — registers this repo as a marketplace source (see `.agents/plugins/marketplace.json`), then install "Moody's Skills" from the marketplace picker.
2. Ensure MCP access — the same `.mcp.json` is used; provide valid API credentials.
3. Trigger a skill — ask Codex naturally. Codex auto-discovers skills via the `skills` pointer in `.codex-plugin/plugin.json`.

## Plugin structure

```
plugin/
├── .claude-plugin/
│   └── plugin.json          # Claude Code manifest
├── .codex-plugin/
│   └── plugin.json          # OpenAI Codex manifest
├── .agents/
│   └── plugins/
│       └── marketplace.json # Codex marketplace entry (optional install path)
├── .mcp.json                # Shared MCP server configuration
├── README.md                # This file
└── skills/
    └── <skill-name>/
        ├── SKILL.md          # Skill definition (trigger, steps, schema)
        └── assets/           # Templates, images, or other bundled files
```

## Available skills

| Skill | Description | MCP Server |
|-------|-------------|------------|
| [Earnings Brief](skills/earnings-brief/SKILL.md) | Generates a Moody's-styled HTML report comparing earnings call transcripts across 2–5 companies, enriched with credit ratings, sector outlook, and news. | `Moodys MCP server` |
| [Peer Analysis](skills/peer-analysis/SKILL.md) | Produces an HTML peer analysis report comparing a target company against up to 3 credit peers, with structured sub-tables and a ratings overview. | `Moodys MCP server` |
| [Issuer Brief](skills/issuer-brief/SKILL.md) | Generates a comprehensive Public Information Book (PIB) HTML report covering company overview, financials, peer comparison, industry, strategy, management, credit profile, risks, and ESG. | `Moodys MCP server` |
| [Rating Analysis](skills/rating-analysis/SKILL.md) | Builds a self-contained HTML rating pitch report combining sector analysis, company credit overview, SWOT, peer comparison, and ESG. Includes inline Chart.js charts and styled tables; no additional dependencies beyond a browser. | `Moodys MCP server` |
| [Sector Brief](skills/sector-brief/SKILL.md) | Produces a research-driven HTML sector brief report combining Moody's sector outlook with broader industry research. | `Moodys MCP server` |

## How skills work

Each skill is defined by a `SKILL.md` file with two parts:

- **YAML frontmatter** — `name`, `description`, and trigger phrases that tell the agent when to activate the skill.
- **Markdown body** — step-by-step instructions the agent follows: which MCP tools to call, how to synthesize the data, and what artifact to produce.

Skills can bundle supporting assets (HTML templates, schemas, images) in an `assets/` directory alongside the `SKILL.md`.

The `SKILL.md` format is identical for Claude Code and OpenAI Codex, so the same skill files work for both platforms without modification.

## Adding a new skill

1. Create a new directory under `skills/` with a short, kebab-case name (e.g. `skills/credit-monitor/`).
2. Add a `SKILL.md` with YAML frontmatter (`name`, `description`) and detailed step-by-step instructions.
3. Place any templates or static files in an `assets/` subdirectory.
4. Update the **Available skills** table in this README.

## MCP servers

The plugin's `.mcp.json` declares the MCP servers that skills depend on. Currently configured:

| Server | Type | Endpoint |
|--------|------|----------|
| `Moodys MCP server` | HTTP | `https://api.moodys.com/genai-ready-data/Credit/mcp` |

Individual skills list their required server and the specific tools they call in their `SKILL.md`.

## License

Licensed under the Apache License 2.0. See [LICENSE](LICENSE).
