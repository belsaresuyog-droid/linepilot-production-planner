import fs from "node:fs/promises";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const source = "/Users/maitreyeeumrani/inheritance/IdealGasSprings/Product family - 818 & 1021 - Part nos and cycle time.xlsx";
const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(source));
const sheet = workbook.worksheets.getItem("Master list");
const values = sheet.getRange("A1:AO161").values;
const group = values[0];
const detail = values[1];
const headers = group.map((value, index) => ({
  index,
  group: value == null ? "" : String(value).trim(),
  detail: detail[index] == null ? "" : String(detail[index]).trim(),
}));

const machines = headers.slice(4).map((header) => ({
  key: `m${header.index - 3}`,
  name: header.detail || header.group || `Process ${header.index - 3}`,
  section: header.group || "Production line",
}));

const rows = values.slice(2).filter((row) => row[0]).map((row, index) => {
  const materialCode = String(row[0]).trim();
  const family = materialCode.split("-")[0];
  const cycleTimes = machines.map((machine, machineIndex) => Number(row[machineIndex + 4]) || 0);
  const bottleneckSeconds = Math.max(...cycleTimes);
  const bottleneckIndex = cycleTimes.indexOf(bottleneckSeconds);
  return {
    id: index + 1,
    materialCode,
    family,
    segment: String(row[1] ?? "").trim(),
    bomAvailable: String(row[2] ?? "").trim().toLowerCase() === "yes",
    orderQty: Number(row[3]) || 0,
    cycleTimes,
    totalCycleSeconds: cycleTimes.reduce((sum, value) => sum + value, 0),
    bottleneckSeconds,
    bottleneckMachine: machines[bottleneckIndex]?.name ?? "—",
  };
});

const families = [...new Set(rows.map((row) => row.family))].sort();
const data = {
  source: "Product family - 818 & 1021 - Part nos and cycle time.xlsx",
  importedAt: "2026-08-01",
  machines,
  families,
  products: rows,
};

await fs.mkdir("public", { recursive: true });
await fs.writeFile("public/planner-data.json", JSON.stringify(data, null, 2));
console.log(JSON.stringify({ headers, machines: machines.length, rows: rows.length, families, sample: rows.slice(0, 3) }, null, 2));
