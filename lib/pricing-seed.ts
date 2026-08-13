export interface PricingSeed {
  model: string;
  input_price: number; // USD per 1M input tokens
  cache_write_price: number; // USD per 1M cache-creation tokens
  cache_read_price: number; // USD per 1M cache-read tokens
  output_price: number; // USD per 1M output tokens
}

export const DEFAULT_PRICING: PricingSeed[] = [
  { model: "claude-opus-5", input_price: 15, cache_write_price: 18.75, cache_read_price: 1.5, output_price: 75 },
  { model: "claude-sonnet-5", input_price: 3, cache_write_price: 3.75, cache_read_price: 0.3, output_price: 15 },
  {
    model: "claude-haiku-4-5-20251001",
    input_price: 0.8,
    cache_write_price: 1,
    cache_read_price: 0.08,
    output_price: 4,
  },
  { model: "unknown", input_price: 0, cache_write_price: 0, cache_read_price: 0, output_price: 0 },
];
