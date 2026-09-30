#!/usr/bin/env node
// assemble.js — standalone skill output assembler
//
// Usage (run from the artifact directory, or pass dirs explicitly):
//   node <path/to>/assemble.js [skillDir [artifactDir]]
//
// Defaults:
//   skillDir    = dirname of this script's parent directory (assets/../)
//   artifactDir = process.cwd()
//
// What it does:
//   1. Reads all task-*.json files from artifactDir and builds a flat placeholder map
//   2. Injects system fields (report_date) into the map — see injectSystemFields below
//   3. Reads output.html if it exists, otherwise reads assets/template.html
//   4. Substitutes every {{ placeholder }} token with values from the map
//   5. If trace.otlp.jsonl exists, resolves <a class="cite-ref"> anchors,
//      injects per-section Sources blocks, a flat References section, and the hover bridge
//   6. Writes the result to output.html

'use strict';

const fs = require('fs');
const path = require('path');

const SKILL_DIR = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, '..');
const ARTIFACT_DIR = process.argv[3] ? path.resolve(process.argv[3]) : process.cwd();
const TEMPLATE_PATH = path.join(SKILL_DIR, 'assets', 'template.html');
const OUTPUT_PATH = path.join(ARTIFACT_DIR, 'output.html');
const TRACE_PATH = path.join(ARTIFACT_DIR, 'trace.otlp.jsonl');

// ─── Step 1: Read all task-*.json files ──────────────────────────────────────

// Fields this script always injects into the placeholder map itself, before
// substitution — no task needs to (or should) produce these. Keep in sync
// with bundleValidator.ts's ASSEMBLER_INJECTED allowlist.
function injectSystemFields(map) {
  if (!Object.prototype.hasOwnProperty.call(map, 'report_date')) {
    map.report_date = new Date().toISOString().slice(0, 10);
  }
}

function readTaskOutputs() {
  const files = fs.readdirSync(ARTIFACT_DIR).filter((f) => /^task-.+\.json$/.test(f));
  const map = {};
  for (const f of files) {
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(ARTIFACT_DIR, f), 'utf-8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        Object.assign(map, parsed);
      }
    } catch (e) {
      process.stderr.write(`[assemble] Warning: could not parse ${f}: ${e.message}\n`);
    }
  }
  injectSystemFields(map);
  return { files, map };
}

// ─── Step 2: Get base HTML ────────────────────────────────────────────────────

function getBaseHtml() {
  if (fs.existsSync(OUTPUT_PATH)) return fs.readFileSync(OUTPUT_PATH, 'utf-8');
  if (fs.existsSync(TEMPLATE_PATH)) return fs.readFileSync(TEMPLATE_PATH, 'utf-8');
  throw new Error(`Neither output.html nor template.html found.\n  output: ${OUTPUT_PATH}\n  template: ${TEMPLATE_PATH}`);
}

// ─── Step 3: Substitute {{ placeholder }} tokens ─────────────────────────────

function substitutePlaceholders(html, map) {
  return html.replace(/\{\{([^{}]+)\}\}/g, (whole, raw) => {
    const key = raw.trim();
    return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : whole;
  });
}

// ─── Citation resolution helpers ──────────────────────────────────────────────

// Port of extractMcpRecordSummaries (apps/shared/citationRecords.ts)
function extractMcpRecordSummaries(node) {
  const seen = new Set();
  const out = [];
  function walk(n) {
    if (n == null) return;
    if (typeof n === 'string') {
      const trimmed = n.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try { walk(JSON.parse(trimmed)); return; } catch {}
      }
      for (const m of n.matchAll(/\b([A-Z]{2,}_\d{5,})\b/g)) {
        const id = m[1];
        if (!seen.has(id)) { seen.add(id); out.push({ id }); }
      }
      return;
    }
    if (Array.isArray(n)) { for (const item of n) walk(item); return; }
    if (typeof n !== 'object') return;
    if (typeof n.id === 'string' && n.id.length >= 3 && !seen.has(n.id)) {
      seen.add(n.id);
      out.push({
        id: n.id,
        title: typeof n.title === 'string' ? n.title : undefined,
        source: typeof n.source === 'string' ? n.source : undefined,
        url: typeof n.url === 'string' ? n.url : undefined,
        date: typeof n.date === 'string' ? n.date : undefined,
      });
    }
    for (const v of Object.values(n)) walk(v);
  }
  walk(node);
  return out;
}

// Port of humanReadableSource (apps/server/src/artifacts/citationSources.ts)
const SOURCE_NAMES = {
  findEntity: 'Entity Search',
  getEntityProfile: 'Entity Intelligence',
  getEntityPeers: 'Peer Analysis',
  getEntitySubsidiaries: 'Corporate Structure',
  getEntityUltimateOwners: 'Ultimate Owners',
  getEntityBeneficiaryOwners: 'Beneficiary Owners',
  getEntityManagersDirectors: 'Management & Directors',
  getCreditOpinion: "Moody's Credit Opinion",
  getEntityRatings: "Moody's Ratings",
  getEntityProbabilityOfDefault: 'Probability of Default',
  getEntityDocuments: "Moody's Research",
  searchEntityDocuments: "Moody's Research",
  getDocumentFullText: 'Document Library',
  searchCompanyFilings: 'Company Filings',
  searchEntityEarningsCall: 'Earnings Calls',
  searchPrecisReports: 'Précis Reports',
  searchLocalMyDocuments: 'Your Documents',
  searchMyDocuments: 'Your Documents',
  getEntityFinancials: 'Financial Data',
  getEntityFinancials_v2: 'Financial Data',
  getEntityStockData: 'Market Data',
  getEntityEsg: 'ESG Data',
  getEntitySectorOutlook: 'Sector Outlook',
  getEntityCountryProfile: 'Country Intelligence',
  searchNews: "Moody's News",
  webSearch: 'Web Search',
  calculator: 'Calculator',
};

function humanReadableSource(toolName) {
  const normalized = toolName
    .replace(/^mcp__moodys_mcp__/, '')
    .replace(/^moodys_mcp_/, '')
    .replace(/^mcp__skill_tools__/, '');
  return SOURCE_NAMES[normalized] ?? toolName;
}

// Port of collectToolCalls (apps/server/src/artifacts/citations.ts)
function collectToolCalls(traceText) {
  const byId = new Map();
  for (const line of traceText.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    let payload;
    try { payload = JSON.parse(t); } catch { continue; }
    for (const rs of payload.resourceSpans ?? []) {
      for (const ss of rs.scopeSpans ?? []) {
        for (const span of ss.spans ?? []) {
          if (!span.parentSpanId) continue;
          const attrs = span.attributes ?? [];
          const get = (key) => attrs.find((a) => a.key === key)?.value?.stringValue;
          const toolCallId = get('gen_ai.tool.call.id');
          if (!toolCallId) continue;
          const result = get('gen_ai.tool.call.result');
          const toolName = get('gen_ai.tool.name') ?? '';
          if (result !== undefined) byId.set(toolCallId, { toolName, result });
        }
      }
    }
  }
  return byId;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildDocUrl(pubId, page) {
  const p = page && page.trim() ? page.trim() : '1';
  return `https://dev.moodys.com/assistant/view-pdf?fileInfo=ATTACHED_DOCUMENT%7C${encodeURIComponent(pubId)}%7C${p}`;
}

// Matches unresolved anchors (no href yet) — strict attribute order, port of server-side regex
const CITE_ANCHOR_RE =
  /<a class="cite-ref" data-cite-key="([^"]+)" data-tool-use-id="([^"]+)"(?: data-chunk-id="([^"]+)")?(?: data-pub-id="([^"]+)")?(?: data-page="([^"]+)")?(?: data-doc-name="([^"]+)")?>(\[[^\]]+\])<\/a>/g;

// Matches any cite-ref opening tag (resolved or not)
const CITE_ANCHOR_OPEN_RE = /<a\s+class="cite-ref"[^>]*>/g;
const ATTR_TOOL_USE_ID_RE = /data-tool-use-id="([^"]+)"/;
const ATTR_CHUNK_ID_RE = /data-chunk-id="([^"]+)"/;
const ATTR_HREF_RE = /\shref="([^"]+)"/;

// Matches any complete cite-ref anchor (resolved or unresolved, any attribute order after class)
const FULL_CITE_ANCHOR_RE = /<a\s+class="cite-ref"([^>]*)>(\[[^\]]*\])<\/a>/g;

function injectSectionSourceBlocks(html, resolved) {
  const byChunkId = new Map();
  for (const r of resolved) {
    if (r.chunkId) byChunkId.set(r.chunkId, r);
  }

  const SECTION_OPEN_RE = /<[a-zA-Z][^>]*\sdata-cite-section="([^"]+)"[^>]*>/g;
  const ranges = [];
  for (const m of html.matchAll(SECTION_OPEN_RE)) {
    const openEnd = m.index + m[0].length;
    const closeStart = html.indexOf('</section>', openEnd);
    if (closeStart === -1) continue;
    ranges.push({ openEnd, closeStart });
  }
  if (ranges.length === 0) return html;

  let result = html;
  for (const { openEnd, closeStart } of [...ranges].sort((a, b) => b.openEnd - a.openEnd)) {
    const sectionContent = result.slice(openEnd, closeStart);

    // Assign sequential numbers by order of first unique source (chunkId, then href as fallback).
    // Agent cite-key numbers are ignored entirely — the assembler owns the numbering.
    const keyToN = new Map();
    const sourceList = [];

    for (const m of sectionContent.matchAll(FULL_CITE_ANCHOR_RE)) {
      const attrs = m[1];
      const chunkId = attrs.match(ATTR_CHUNK_ID_RE)?.[1];
      const existingHref = attrs.match(ATTR_HREF_RE)?.[1];
      const key = chunkId ?? existingHref;
      if (!key || keyToN.has(key)) continue;

      const r = chunkId ? byChunkId.get(chunkId) : undefined;
      const href = r?.href ?? existingHref;
      if (!href && !r?.title && !r?.source) continue;

      const n = sourceList.length + 1;
      keyToN.set(key, n);
      sourceList.push({ n, href, title: r?.title, source: r?.source });
    }

    if (sourceList.length === 0) continue;

    // Rewrite every cite-ref anchor in the section with the new sequential number.
    let rewrittenSection = sectionContent.replace(FULL_CITE_ANCHOR_RE, (full, attrs) => {
      const chunkId = attrs.match(ATTR_CHUNK_ID_RE)?.[1];
      const existingHref = attrs.match(ATTR_HREF_RE)?.[1];
      const key = chunkId ?? existingHref;
      const n = key ? keyToN.get(key) : undefined;
      if (n === undefined) return full;
      const newAttrs = attrs.replace(/\bdata-cite-key="[^"]*"/, `data-cite-key="${n}"`);
      return `<a class="cite-ref"${newAttrs}>[${n}]</a>`;
    });

    // Remove any existing aside and append the freshly-built one.
    rewrittenSection = rewrittenSection.replace(/<aside class="section-sources">[\s\S]*?<\/aside>/g, '');

    const items = sourceList
      .map(({ n, href, title, source }) => {
        const label = escapeHtml(
          title ? `${title}${source ? ` — ${source}` : ''}` : source ?? String(n),
        );
        return href
          ? `<li value="${n}"><a href="${escapeHtml(href)}" target="_blank" rel="noopener">${label}</a></li>`
          : `<li value="${n}">${label}</li>`;
      })
      .join('\n');

    const aside = `\n<aside class="section-sources"><h4>Sources</h4><ol>\n${items}\n</ol></aside>\n`;
    result = result.slice(0, openEnd) + rewrittenSection + aside + result.slice(closeStart);
  }

  return result;
}

// ─── Step 4: Resolve citations ────────────────────────────────────────────────

function resolveCitations(html, traceText, threadId) {
  const toolCalls = collectToolCalls(traceText);

  const matches = Array.from(html.matchAll(CITE_ANCHOR_RE));
  const alreadyHasHoverBridge = html.includes('data-mdc-cite-hover="1"');
  const alreadyHasOurSectionSources = html.includes('<li value="');
  const hasDuplicateSources = [...html.matchAll(/<aside class="section-sources">[\s\S]*?<\/aside>/g)].some((m) => {
    const pairs = [...m[0].matchAll(/<a href="([^"]+)"[^>]*>([^<]*)<\/a>/g)].map((a) => `${a[1]}||${a[2]}`);
    return pairs.length !== new Set(pairs).size;
  });
  if (matches.length === 0 && alreadyHasHoverBridge && alreadyHasOurSectionSources && !hasDuplicateSources) {
    return { html, resolvedCount: 0, unresolvedCount: 0 };
  }

  const patches = [];
  let resolved = [];
  const seenResolvedKeys = new Set();

  for (const m of matches) {
    const [full, citeKey, toolUseId, chunkId, pubId, page, docName, bracketLabel] = m;
    const call = toolCalls.get(toolUseId);
    let href, title, date;
    const source = call ? humanReadableSource(call.toolName) : (pubId ? 'Your Documents' : undefined);

    if (call && chunkId) {
      const records = extractMcpRecordSummaries(call.result);
      const record = records.find((r) => r.id === chunkId);
      href = record?.url;
      title = record?.title;
      date = record?.date;
    }
    if (!href && pubId) href = buildDocUrl(pubId, page);
    if (!title && pubId) {
      title = docName ? (page ? `${docName} — Page ${page}` : docName) : `Document — Page ${page ?? '?'}`;
    }

    if (href) {
      const attrs = [
        `data-cite-key="${escapeHtml(citeKey)}"`,
        `data-tool-use-id="${escapeHtml(toolUseId)}"`,
        ...(chunkId ? [`data-chunk-id="${escapeHtml(chunkId)}"`] : []),
        ...(pubId ? [`data-pub-id="${escapeHtml(pubId)}"`] : []),
        ...(page ? [`data-page="${escapeHtml(page)}"`] : []),
        ...(docName ? [`data-doc-name="${escapeHtml(docName)}"`] : []),
        `href="${escapeHtml(href)}"`,
        'target="_blank"',
        'rel="noopener"',
      ].join(' ');
      patches.push({
        start: m.index,
        end: m.index + full.length,
        replacement: `<a class="cite-ref" ${attrs}>${bracketLabel}</a>`,
      });
    }

    // Deduplicate by chunkId (or pubId for doc-based anchors, falling back to citeKey).
    // Using citeKey alone was wrong — every section starts numbering from 1, so deduping
    // by citeKey caused all but the first section's [1] to be dropped from byChunkId.
    const dedupeKey = chunkId ?? (pubId ? `pub:${pubId}` : null) ?? citeKey;
    if (!seenResolvedKeys.has(dedupeKey)) {
      seenResolvedKeys.add(dedupeKey);
      resolved.push({ citeKey, href, title, source, chunkId: chunkId ?? undefined, date, chunkSource: call?.toolName });
    }
  }

  // Supplementary scan: harvest already-resolved anchors for section sources injection
  {
    const seenChunks = new Set(resolved.map((r) => r.chunkId).filter(Boolean));
    for (const m of html.matchAll(CITE_ANCHOR_OPEN_RE)) {
      const tag = m[0];
      const chunkId = tag.match(ATTR_CHUNK_ID_RE)?.[1];
      if (!chunkId || seenChunks.has(chunkId)) continue;
      seenChunks.add(chunkId);
      const toolUseId = tag.match(ATTR_TOOL_USE_ID_RE)?.[1];
      const call = toolUseId ? toolCalls.get(toolUseId) : undefined;
      const records = call ? extractMcpRecordSummaries(call.result) : [];
      const record = records.find((r) => r.id === chunkId);
      const existingHref = tag.match(ATTR_HREF_RE)?.[1];
      const href = record?.url ?? existingHref;
      const title = record?.title;
      const source = call ? humanReadableSource(call.toolName) : undefined;
      if (!href && !title && !source) continue;
      const citeKeyMatch = tag.match(/data-cite-key="([^"]+)"/);
      resolved.push({
        citeKey: citeKeyMatch?.[1] ?? chunkId,
        href,
        title,
        source,
        chunkId,
        date: record?.date,
        chunkSource: call?.toolName,
      });
    }
  }

  resolved = resolved.filter((r) => r.href || r.title || r.source);
  const resolvedCount = patches.length;
  const unresolvedCount = matches.length - patches.length;

  if (resolved.length === 0 && patches.length === 0) return { html, resolvedCount: 0, unresolvedCount: matches.length };

  let updatedHtml = html;
  for (const p of patches.sort((a, b) => b.start - a.start)) {
    updatedHtml = updatedHtml.slice(0, p.start) + p.replacement + updatedHtml.slice(p.end);
  }

  updatedHtml = injectSectionSourceBlocks(updatedHtml, resolved);

  const hoverDataByChunkId = {};
  for (const r of resolved) {
    if (r.chunkId) {
      hoverDataByChunkId[r.chunkId] = {
        title: r.title ?? '',
        url: r.href ?? '',
        source: r.source ?? '',
        date: r.date ?? '',
        chunkSource: r.chunkSource ?? '',
      };
    }
  }

  const hoverScript = `
<script data-mdc-cite-hover="1">(function(){
  if(window.__mdcCiteHover)return;window.__mdcCiteHover=true;
  var THREAD=${JSON.stringify(threadId)};
  var DATA=${JSON.stringify(hoverDataByChunkId)};
  function emit(type,el){
    var chunkId=el.getAttribute('data-chunk-id');
    if(!chunkId)return;
    var d=DATA[chunkId]||{};
    var r=el.getBoundingClientRect();
    window.parent.postMessage({type:type,threadId:THREAD,chunkId:chunkId,
      chunkSource:d.chunkSource||'',title:d.title||'',url:d.url||'',
      date:d.date||'',source:d.source||'',
      rect:{top:r.top,left:r.left,bottom:r.bottom,right:r.right,width:r.width,height:r.height}},'*');
  }
  document.addEventListener('mouseover',function(e){
    var el=e.target&&e.target.closest&&e.target.closest('a.cite-ref[data-chunk-id]');
    if(el)emit('mdc:cite-hover',el);
  });
  document.addEventListener('mouseout',function(e){
    var el=e.target&&e.target.closest&&e.target.closest('a.cite-ref[data-chunk-id]');
    if(el)window.parent.postMessage({type:'mdc:cite-hover-end'},'*');
  });
})();</script>`;

  const inject = alreadyHasHoverBridge ? '' : hoverScript;
  const withRefs = inject
    ? /<\/body>/i.test(updatedHtml)
      ? updatedHtml.replace(/<\/body>/i, `${inject}</body>`)
      : updatedHtml + inject
    : updatedHtml;

  return { html: withRefs, resolvedCount, unresolvedCount };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

function main() {
  const { files, map } = readTaskOutputs();
  process.stdout.write(`[assemble] ${files.length} task files → ${Object.keys(map).length} placeholder values\n`);

  let html = getBaseHtml();
  const unfilledBefore = (html.match(/\{\{[^{}]+\}\}/g) ?? []).length;

  html = substitutePlaceholders(html, map);

  const unfilledAfter = (html.match(/\{\{[^{}]+\}\}/g) ?? []).length;
  process.stdout.write(
    `[assemble] Placeholder substitution: ${unfilledBefore} tokens → ${unfilledBefore - unfilledAfter} filled, ${unfilledAfter} remaining\n`,
  );

  const threadId = path.basename(ARTIFACT_DIR);

  if (fs.existsSync(TRACE_PATH)) {
    const traceText = fs.readFileSync(TRACE_PATH, 'utf-8');
    const citeMatches = (html.match(CITE_ANCHOR_RE) ?? []).length;
    process.stdout.write(`[assemble] Resolving ${citeMatches} citation anchors from trace\n`);
    const { html: resolved, resolvedCount, unresolvedCount } = resolveCitations(html, traceText, threadId);
    html = resolved;
    process.stdout.write(`[assemble] Citations: ${resolvedCount} resolved, ${unresolvedCount} unresolved\n`);
  } else {
    process.stdout.write(`[assemble] No trace.otlp.jsonl — skipping citation resolution (server resolves at end-of-run)\n`);
  }

  fs.writeFileSync(OUTPUT_PATH, html, 'utf-8');
  process.stdout.write(`[assemble] Wrote output.html (${html.length} bytes)\n`);
}

main();
