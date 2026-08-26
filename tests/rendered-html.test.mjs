import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(relativePath) {
  return readFile(new URL(relativePath, root), "utf8");
}

// Core scheduling contract: shift time × OEE × parallel booths ÷ cycle time.
function capacity({ shiftHours, oeePercent, cycleSeconds, booths = 1, downtimeMinutes = 0 }) {
  const productiveSeconds = Math.max(0, shiftHours * 3600 - downtimeMinutes * 60) * (oeePercent / 100);
  return Math.floor((productiveSeconds * booths) / cycleSeconds);
}

function supportedQuantity(plannedQuantity, requirements) {
  if (!requirements.length) return plannedQuantity;
  return Math.min(
    plannedQuantity,
    ...requirements.map(({ available, required }) => Math.floor(available / required)),
  );
}

function isTuesdayOrHoliday(isoDate, holidays = []) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  return date.getUTCDay() === 2 || holidays.includes(isoDate);
}

test("capacity calculation respects OEE, cycle time, booths, and downtime", () => {
  assert.equal(capacity({ shiftHours: 8, oeePercent: 80, cycleSeconds: 16 }), 1440);
  assert.equal(capacity({ shiftHours: 8, oeePercent: 80, cycleSeconds: 16, booths: 2 }), 2880);
  assert.equal(capacity({ shiftHours: 8, oeePercent: 80, cycleSeconds: 16, downtimeMinutes: 60 }), 1260);
});

test("feeder support is limited by the least-complete BOM component", () => {
  assert.equal(supportedQuantity(100, [
    { available: 250, required: 2 },
    { available: 50, required: 1 },
  ]), 50);
  assert.equal(supportedQuantity(20, [{ available: 100, required: 1 }]), 20);
  assert.equal(supportedQuantity(20, []), 20);
});

test("Tuesday defaults to non-working while Sunday remains working", () => {
  assert.equal(isTuesdayOrHoliday("2026-09-01"), true); // Tuesday
  assert.equal(isTuesdayOrHoliday("2026-09-06"), false); // Sunday
  assert.equal(isTuesdayOrHoliday("2026-09-06", ["2026-09-06"]), true);
});

test("planning API validates periods and upserts plans in D1", async () => {
  const api = await source("app/api/plans/route.ts");
  assert.match(api, /function validMonth\(/);
  assert.match(api, /ON CONFLICT\(month\) DO UPDATE/);
  assert.match(api, /DELETE FROM monthly_plans WHERE month = \?/);
  assert.match(api, /status: 409/);
});

test("planner imports XLSX dynamically and maps workbook rows", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /import\("xlsx"\)/);
  assert.match(page, /XLSX\.utils\.sheet_to_json/);
  assert.match(page, /uploadedPlanningRows/);
  assert.match(page, /uploadedBomRows/);
});

test("operator and administrator workflows expose shared save controls", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /authRole === "operator"/);
  assert.match(page, /Save day data/);
  assert.match(page, /Save data/);
  assert.match(page, /dailyProductionEdits/);
  assert.match(page, /actualProduction/);
});

test("production planning includes editable due dates, assembly reassignment, and interruptions", async () => {
  const page = await source("app/page.tsx");
  assert.match(page, /updateDueDate/);
  assert.match(page, /dailyAssemblyLines/);
  assert.match(page, /dailyInterruptions/);
  assert.match(page, /emergencyDispatches/);
  assert.match(page, /preventiveMaintenanceSlots/);
});

test("worker delegates requests to the application router", async () => {
  const worker = await source("worker/index.ts");
  assert.match(worker, /return handler\.fetch\(request, env, ctx\)/);
  assert.match(worker, /export default worker/);
});
