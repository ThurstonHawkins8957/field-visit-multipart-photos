import { readFile } from "node:fs/promises";

const serviceUrl = process.env.SERVICE_URL ?? "http://localhost:3000";
const filePath = process.argv[2];
const workOrderId = process.argv[3] ?? "WO-1042";

if (!filePath) throw new Error("Run: npm run demo -- ./visit.jpg [work-order-id]");

const bytes = await readFile(filePath);
const startedResponse = await fetch(`${serviceUrl}/work-orders/${encodeURIComponent(workOrderId)}/media/uploads`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    technicianId: "tech-17",
    fileName: filePath.split("/").pop(),
    contentType: "image/jpeg",
    byteSize: bytes.byteLength,
    partCount: 1,
    photoKind: "completion",
  }),
});
if (!startedResponse.ok) throw new Error(await startedResponse.text());
const started = await startedResponse.json() as {
  uploadId: string;
  parts: Array<{ partNumber: number; uploadUrl: string; method: "PUT" }>;
};

const uploadedResponse = await fetch(started.parts[0].uploadUrl, {
  method: "PUT",
  body: bytes,
});
if (!uploadedResponse.ok) throw new Error(`Part upload failed with HTTP ${uploadedResponse.status}`);
const etag = uploadedResponse.headers.get("etag");
if (!etag) throw new Error("Part upload did not return an ETag");

const completedResponse = await fetch(
  `${serviceUrl}/work-orders/${encodeURIComponent(workOrderId)}/media/uploads/${encodeURIComponent(started.uploadId)}/complete`,
  {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ parts: [{ part_number: 1, etag }] }),
  },
);
if (!completedResponse.ok) throw new Error(await completedResponse.text());
console.log(JSON.stringify(await completedResponse.json(), null, 2));
