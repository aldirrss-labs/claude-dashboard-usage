import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM model_pricing ORDER BY model").all();
  return NextResponse.json({ pricing: rows });
}

export async function PUT(request: NextRequest) {
  const body = await request.json();
  const { model, input_price, cache_write_price, cache_read_price, output_price } = body;
  if (typeof model !== "string") {
    return NextResponse.json({ error: "model is required" }, { status: 400 });
  }
  const db = getDb();
  db.prepare(
    `INSERT INTO model_pricing (model, input_price, cache_write_price, cache_read_price, output_price, updated_at, source)
     VALUES (@model, @input_price, @cache_write_price, @cache_read_price, @output_price, datetime('now'), 'manual')
     ON CONFLICT(model) DO UPDATE SET
       input_price = @input_price, cache_write_price = @cache_write_price,
       cache_read_price = @cache_read_price, output_price = @output_price,
       updated_at = datetime('now'), source = 'manual'`
  ).run({ model, input_price, cache_write_price, cache_read_price, output_price });
  return NextResponse.json({ ok: true });
}
