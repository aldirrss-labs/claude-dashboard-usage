import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";

interface ScrapedPrice {
  model: string;
  input_price: number;
  cache_write_price: number;
  cache_read_price: number;
  output_price: number;
}

const MODEL_NAME_MAP: Record<string, string> = {
  "Claude Opus 5": "claude-opus-5",
  "Claude Sonnet 5": "claude-sonnet-5",
  "Claude Haiku 4.5": "claude-haiku-4-5-20251001",
};

function parsePricingHtml(html: string): ScrapedPrice[] {
  const results: ScrapedPrice[] = [];
  for (const [label, modelId] of Object.entries(MODEL_NAME_MAP)) {
    const labelIndex = html.indexOf(label);
    if (labelIndex === -1) continue;
    const window = html.slice(labelIndex, labelIndex + 2000);
    const prices = [...window.matchAll(/\$([0-9]+(?:\.[0-9]+)?)/g)].map((m) => Number(m[1]));
    if (prices.length < 2) continue;
    const [input, output] = prices;
    results.push({
      model: modelId,
      input_price: input,
      output_price: output,
      cache_write_price: Number((input * 1.25).toFixed(3)),
      cache_read_price: Number((input * 0.1).toFixed(3)),
    });
  }
  return results;
}

export async function POST() {
  try {
    const res = await fetch("https://www.anthropic.com/pricing", { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Fetch failed with status ${res.status}`);
    const html = await res.text();
    const scraped = parsePricingHtml(html);

    if (scraped.length === 0) {
      return NextResponse.json(
        { ok: false, error: "No known models found on pricing page; existing prices unchanged." },
        { status: 502 }
      );
    }

    const db = getDb();
    const upsert = db.prepare(
      `INSERT INTO model_pricing (model, input_price, cache_write_price, cache_read_price, output_price, updated_at, source)
       VALUES (@model, @input_price, @cache_write_price, @cache_read_price, @output_price, datetime('now'), 'synced')
       ON CONFLICT(model) DO UPDATE SET
         input_price = @input_price, cache_write_price = @cache_write_price,
         cache_read_price = @cache_read_price, output_price = @output_price,
         updated_at = datetime('now'), source = 'synced'`
    );
    const tx = db.transaction((rows: ScrapedPrice[]) => {
      for (const row of rows) upsert.run(row);
    });
    tx(scraped);

    return NextResponse.json({ ok: true, updated: scraped.map((s) => s.model) });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : "Unknown error; existing prices unchanged." },
      { status: 502 }
    );
  }
}
