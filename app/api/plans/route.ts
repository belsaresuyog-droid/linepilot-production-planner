import { env } from "cloudflare:workers";

const createTableSql = `CREATE TABLE IF NOT EXISTS monthly_plans (
  month TEXT PRIMARY KEY NOT NULL,
  payload TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
)`;

async function ensureSchema() {
  if (!env.DB) throw new Error("Production planning database is unavailable.");
  await env.DB.prepare(createTableSql).run();
}

function validMonth(value: string | null) {
  return Boolean(value && (/^\d{4}-(0[1-9]|1[0-2])$/.test(value) || /^\d{4}-\d{2}-\d{2}_\d{4}-\d{2}-\d{2}$/.test(value)));
}

function rangesOverlap(first: string, second: string) {
  const [firstStart, firstEnd] = first.split("_");
  const [secondStart, secondEnd] = second.split("_");
  return Boolean(firstEnd && secondEnd && firstStart <= secondEnd && secondStart <= firstEnd);
}

async function findOverlap(candidate: string, exclude?: string) {
  const result = await env.DB.prepare("SELECT month FROM monthly_plans WHERE instr(month, '_') > 0").all<{ month: string }>();
  return (result.results ?? []).find((row) => row.month !== exclude && row.month !== candidate && rangesOverlap(candidate, row.month))?.month ?? null;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("list") === "1") {
      await ensureSchema();
      const result = await env.DB.prepare("SELECT month FROM monthly_plans WHERE instr(month, '_') > 0 ORDER BY month").all<{ month: string }>();
      return Response.json({ ranges: (result.results ?? []).map((row) => row.month) });
    }
    const month = url.searchParams.get("month");
    if (!validMonth(month)) return Response.json({ error: "Valid month is required." }, { status: 400 });
    await ensureSchema();
    const row = await env.DB.prepare("SELECT payload, updated_at FROM monthly_plans WHERE month = ?").bind(month).first<{ payload: string; updated_at: string }>();
    return Response.json({ plan: row ? JSON.parse(row.payload) : null, updatedAt: row?.updated_at ?? null });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load plan." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  try {
    const body = await request.json() as { month?: string; plan?: unknown };
    if (!validMonth(body.month ?? null) || !body.plan) return Response.json({ error: "Month and plan are required." }, { status: 400 });
    const payload = JSON.stringify(body.plan);
    if (payload.length > 1_000_000) return Response.json({ error: "Plan is too large." }, { status: 413 });
    await ensureSchema();
    const existing = await env.DB.prepare("SELECT month FROM monthly_plans WHERE month = ?").bind(body.month).first<{ month: string }>();
    const overlap = existing ? null : await findOverlap(body.month!);
    if (overlap) return Response.json({ error: `Planning period overlaps ${overlap.replace("_", " to ")}.` }, { status: 409 });
    await env.DB.prepare(`INSERT INTO monthly_plans (month, payload, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(month) DO UPDATE SET payload = excluded.payload, updated_at = CURRENT_TIMESTAMP`)
      .bind(body.month, payload).run();
    return Response.json({ saved: true, month: body.month });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to save plan." }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json() as { oldMonth?: string; newMonth?: string };
    if (!validMonth(body.oldMonth ?? null) || !validMonth(body.newMonth ?? null)) return Response.json({ error: "Valid existing and updated periods are required." }, { status: 400 });
    await ensureSchema();
    const overlap = await findOverlap(body.newMonth!, body.oldMonth);
    if (overlap) return Response.json({ error: `Planning period overlaps ${overlap.replace("_", " to ")}.` }, { status: 409 });
    const result = await env.DB.prepare("UPDATE monthly_plans SET month = ?, updated_at = CURRENT_TIMESTAMP WHERE month = ?").bind(body.newMonth, body.oldMonth).run();
    if (!result.meta.changes) return Response.json({ error: "Planning period was not found." }, { status: 404 });
    return Response.json({ updated: true, month: body.newMonth });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update planning period." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const month = new URL(request.url).searchParams.get("month");
    if (!validMonth(month)) return Response.json({ error: "Valid planning period is required." }, { status: 400 });
    await ensureSchema();
    const result = await env.DB.prepare("DELETE FROM monthly_plans WHERE month = ?").bind(month).run();
    const remaining = await env.DB.prepare("SELECT month FROM monthly_plans WHERE instr(month, '_') > 0 ORDER BY month").all<{ month: string }>();
    return Response.json({ deleted: true, month, deletedRows: result.meta.changes ?? 0, ranges: (remaining.results ?? []).map((row) => row.month) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to remove planning period." }, { status: 500 });
  }
}
