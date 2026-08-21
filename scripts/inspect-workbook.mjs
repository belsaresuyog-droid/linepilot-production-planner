import fs from "node:fs/promises";
import path from "node:path";
import { FileBlob, SpreadsheetFile } from "@oai/artifact-tool";

const source = "/Users/maitreyeeumrani/inheritance/IdealGasSprings/Product family - 818 & 1021 - Part nos and cycle time.xlsx";
const outDir = path.resolve("workbook-preview");
await fs.mkdir(outDir, { recursive: true });

const workbook = await SpreadsheetFile.importXlsx(await FileBlob.load(source));
const overview = await workbook.inspect({
  kind: "workbook,sheet,table,region",
  maxChars: 18000,
  tableMaxRows: 18,
  tableMaxCols: 14,
  tableMaxCellChars: 120,
});
console.log(overview.ndjson);

for (const sheet of workbook.worksheets.items) {
  const used = sheet.getUsedRange(true);
  console.log(`SHEET_META ${JSON.stringify({ name: sheet.name, address: used?.address ?? null })}`);
  if (used) {
    const preview = await workbook.render({ sheetName: sheet.name, autoCrop: "all", scale: 1.25, format: "png" });
    const safe = sheet.name.replace(/[^a-z0-9_-]+/gi, "_");
    await fs.writeFile(path.join(outDir, `${safe}.png`), new Uint8Array(await preview.arrayBuffer()));
  }
}
