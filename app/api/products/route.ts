import { env } from "cloudflare:workers";

const createTableSql = `CREATE TABLE IF NOT EXISTS product_catalog (
  id TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

type CatalogPayload = { customProducts: unknown[]; deletedProductIds: number[] };

async function ensureSchema() {
  if (!env.DB) throw new Error("Product database is unavailable.");
  await env.DB.prepare(createTableSql).run();
}

export async function GET() {
  try {
    await ensureSchema();
    const row = await env.DB.prepare("SELECT payload FROM product_catalog WHERE id = ?").bind("master").first<{ payload: string }>();
    const catalog: CatalogPayload = row ? JSON.parse(row.payload) : { customProducts: [], deletedProductIds: [] };
    return Response.json(catalog);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load products." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as CatalogPayload;
    if (!Array.isArray(body.customProducts) || !Array.isArray(body.deletedProductIds)) {
      return Response.json({ error: "Invalid product catalog." }, { status: 400 });
    }
    const payload = JSON.stringify(body);
    if (payload.length > 2_000_000) return Response.json({ error: "Product catalog is too large." }, { status: 413 });
    await ensureSchema();
    await env.DB.prepare(`INSERT INTO product_catalog (id, payload, updated_at)
      VALUES ('master', ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP`)
      .bind(payload).run();
    return Response.json({ saved: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save products." }, { status: 500 });
  }
}
