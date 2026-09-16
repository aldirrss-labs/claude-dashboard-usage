export interface ScrapedPrice {
  model: string;
  input_price: number;
  cache_write_price: number;
  cache_read_price: number;
  output_price: number;
}

// The marketing page at anthropic.com/pricing renders its table client-side, so
// the prices are not in the HTML a plain fetch gets back. The docs site serves
// the same table as plain Markdown, which is both fetchable and stable to parse.
export const PRICING_URL = "https://platform.claude.com/docs/en/about-claude/pricing.md";

// Display name on the pricing page -> model id used as the model_pricing key.
// Keep in sync with lib/pricing-seed.ts.
const MODEL_NAME_MAP: Record<string, string> = {
  "Claude Fable 5.1": "claude-fable-5-1",
  "Claude Mythos 5.1": "claude-mythos-5-1",
  "Claude Fable 5": "claude-fable-5",
  "Claude Mythos 5": "claude-mythos-5",
  "Claude Opus 5": "claude-opus-5",
  "Claude Opus 4.8": "claude-opus-4-8",
  "Claude Opus 4.7": "claude-opus-4-7",
  "Claude Opus 4.6": "claude-opus-4-6",
  "Claude Opus 4.5": "claude-opus-4-5",
  "Claude Opus 4.1": "claude-opus-4-1",
  "Claude Opus 4": "claude-opus-4",
  "Claude Sonnet 5": "claude-sonnet-5",
  "Claude Sonnet 4.6": "claude-sonnet-4-6",
  "Claude Sonnet 4.5": "claude-sonnet-4-5",
  "Claude Sonnet 4": "claude-sonnet-4",
  "Claude Haiku 4.5": "claude-haiku-4-5",
  "Claude Haiku 3.5": "claude-haiku-3-5",
};

/**
 * Strip the decoration the docs table puts around a model name: a parenthesised
 * availability/deprecation link, a plain Markdown link, and whitespace.
 */
function cleanModelLabel(cell: string): string {
  return cell
    .replace(/\(\[[^\]]*\]\([^)]*\)\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .trim();
}

/**
 * Parse the "Model pricing" table. Its columns are:
 *   model | base input | 5m cache write | 1h cache write | cache hit | output
 *
 * The 1h-write column is dropped — the schema stores a single cache-write price
 * and Claude Code's default caching is the 5-minute TTL. Cache-hit cells carry a
 * footnote marker (e.g. "$0.25 / MTok1"); the number regex stops at the end of
 * the numeric literal, so the marker is harmless.
 */
export function parsePricingMarkdown(markdown: string): ScrapedPrice[] {
  const results: ScrapedPrice[] = [];
  const seen = new Set<string>();

  for (const line of markdown.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1);
    if (cells.length < 6) continue;

    const modelId = MODEL_NAME_MAP[cleanModelLabel(cells[0])];
    // Several later tables (batch pricing, tool-use token counts) repeat the
    // same model names; `seen` keeps the first match, which is the price table.
    if (!modelId || seen.has(modelId)) continue;

    const amounts = cells.slice(1, 6).map((cell) => {
      const match = cell.match(/\$\s*([0-9]+(?:\.[0-9]+)?)/);
      return match ? Number(match[1]) : NaN;
    });
    if (amounts.some(Number.isNaN)) continue;

    seen.add(modelId);
    results.push({
      model: modelId,
      input_price: amounts[0],
      cache_write_price: amounts[1],
      cache_read_price: amounts[3],
      output_price: amounts[4],
    });
  }

  return results;
}
