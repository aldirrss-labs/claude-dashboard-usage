import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { PRICING_URL, parsePricingMarkdown, type ScrapedPrice } from "@/lib/pricing-sync";

export async function POST() {
  try {
    const res = await fetch(PRICING_URL, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) throw new Error(`Fetch failed with status ${res.status}`);
    const markdown = await res.text();
    const scraped = parsePricingMarkdown(markdown);

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
