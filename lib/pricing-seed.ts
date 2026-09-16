export interface PricingSeed {
  model: string;
  input_price: number; // USD per 1M input tokens
  cache_write_price: number; // USD per 1M cache-creation tokens (5-minute write)
  cache_read_price: number; // USD per 1M cache-read tokens
  output_price: number; // USD per 1M output tokens
}

// Source of truth: https://platform.claude.com/docs/en/about-claude/pricing
// (verified 2026-09-16). cache_write_price is the 5-minute write (1.25x input);
// cache_read_price is 0.1x input on every model except Fable/Mythos 5.1, which
// price cache hits at 0.025x input.
export const DEFAULT_PRICING: PricingSeed[] = [
  // Fable / Mythos tier
  { model: "claude-fable-5-1", input_price: 10, cache_write_price: 12.5, cache_read_price: 0.25, output_price: 50 },
  { model: "claude-mythos-5-1", input_price: 10, cache_write_price: 12.5, cache_read_price: 0.25, output_price: 50 },
  { model: "claude-fable-5", input_price: 10, cache_write_price: 12.5, cache_read_price: 1, output_price: 50 },
  { model: "claude-mythos-5", input_price: 10, cache_write_price: 12.5, cache_read_price: 1, output_price: 50 },

  // Opus tier
  { model: "claude-opus-5", input_price: 5, cache_write_price: 6.25, cache_read_price: 0.5, output_price: 25 },
  { model: "claude-opus-4-8", input_price: 5, cache_write_price: 6.25, cache_read_price: 0.5, output_price: 25 },
  { model: "claude-opus-4-7", input_price: 5, cache_write_price: 6.25, cache_read_price: 0.5, output_price: 25 },
  { model: "claude-opus-4-6", input_price: 5, cache_write_price: 6.25, cache_read_price: 0.5, output_price: 25 },
  { model: "claude-opus-4-5", input_price: 5, cache_write_price: 6.25, cache_read_price: 0.5, output_price: 25 },
  { model: "claude-opus-4-1", input_price: 15, cache_write_price: 18.75, cache_read_price: 1.5, output_price: 75 },
  { model: "claude-opus-4", input_price: 15, cache_write_price: 18.75, cache_read_price: 1.5, output_price: 75 },

  // Sonnet tier
  { model: "claude-sonnet-5", input_price: 2, cache_write_price: 2.5, cache_read_price: 0.2, output_price: 10 },
  { model: "claude-sonnet-4-6", input_price: 3, cache_write_price: 3.75, cache_read_price: 0.3, output_price: 15 },
  { model: "claude-sonnet-4-5", input_price: 3, cache_write_price: 3.75, cache_read_price: 0.3, output_price: 15 },
  { model: "claude-sonnet-4", input_price: 3, cache_write_price: 3.75, cache_read_price: 0.3, output_price: 15 },

  // Haiku tier
  { model: "claude-haiku-4-5", input_price: 1, cache_write_price: 1.25, cache_read_price: 0.1, output_price: 5 },
  { model: "claude-haiku-3-5", input_price: 0.8, cache_write_price: 1, cache_read_price: 0.08, output_price: 4 },

  { model: "unknown", input_price: 0, cache_write_price: 0, cache_read_price: 0, output_price: 0 },
];

/**
 * Reduce a model id as it appears in a session log to the canonical id used as
 * the `model_pricing` primary key.
 *
 * Claude Code writes whatever the API returned, which is not always the bare
 * model id: context-window variants carry a bracket suffix (`claude-opus-5[1m]`),
 * dated snapshots carry a trailing date (`claude-haiku-4-5-20251001`,
 * `claude-opus-4-5@20251101`), and Bedrock/Vertex ids carry vendor or region
 * prefixes. Without this, any such variant misses the pricing table and is
 * silently costed at $0 via the `unknown` row.
 */
export function normalizeModelId(model: string): string {
  let id = model.trim().toLowerCase();
  id = id.replace(/\[[^\]]*\]$/, ""); // claude-opus-5[1m]
  id = id.replace(/^(?:us|eu|apac|global)\./, ""); // bedrock region prefix
  id = id.replace(/^anthropic\./, ""); // bedrock vendor prefix
  id = id.replace(/-v\d+:\d+$/, ""); // bedrock version suffix
  id = id.replace(/@\d{8}$/, ""); // vertex dated snapshot
  id = id.replace(/-\d{8}$/, ""); // api dated snapshot
  return id;
}
