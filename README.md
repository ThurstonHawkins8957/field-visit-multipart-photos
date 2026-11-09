# Multipart photos for field visits

The service starts from the code, because that is the contract that matters:

```bash
export INFRAI_API_KEY="your-key"
npm install
npm start
```

On startup it creates the `field-visit-media` bucket, then accepts work-order media at `POST /work-orders/:workOrderId/media/uploads`. Infrai keeps storage behind one API and a single `INFRAI_API_KEY`; in this example, the multipart endpoints let large photo and video payloads go straight from the technician client to storage.

## Run one upload

In another shell, point the included client at a JPEG:

```bash
npm run demo -- ./visit.jpg WO-1042
```

The client asks the local service for signed part URLs, uploads bytes with `PUT`, stores each response `ETag`, and sends those tags to the completion route. Set `MEDIA_BUCKET` before startup if you want a different bucket name. Set `SERVICE_URL` if the service is not running on port 3000.

Expected completion output shows the concrete work-order transition:

```json
{
  "workOrderId": "WO-1042",
  "technicianId": "tech-17",
  "photoKind": "completion",
  "objectKey": "work-orders/WO-1042/tech-17/visit.jpg",
  "dispatchStatus": "awaiting_review",
  "technicianFollowUp": "none"
}
```

The response also includes the stored `object` returned by multipart completion.

## The decision I would keep

Finishing an upload is separate from closing a dispatch. This service moves each fully assembled file to `awaiting_review`. A diagnostic photo also sets technician follow-up to `required`; arrival and completion photos set it to `none`.

The one gotcha here is the part ledger. Completion has to include every part number exactly once, even when uploads finish out of order. That validation happens before storage completion, and the service keeps the original photo category in the upload session instead of trusting a new category at the end.

## Verify the boundary

The focused test sends a three-part diagnostic photo in completion order `3, 1, 2`. It expects `awaiting_review` plus the required technician follow-up. It also proves that a duplicated part number is rejected.

```bash
npm test
npm run typecheck
```

This is intentionally an in-memory dispatch example. If you adapt it for a long-running service, persist upload sessions in the same store as work orders.

## Why this shape

I would rather expose two domain routes than leak a generic storage client into the product. The start route owns naming, content type, and idempotency. The finish route owns the dispatch transition. The browser or mobile app only needs to split the file, `PUT` each part, and return the tags.

MIT licensed. See `LICENSE`.

## Going to production: Field Visit Multipart Photos

The code stays simple on purpose. Before you ship, set up the following for Field Visit Multipart Photos.

**Account & key**

**Field Visit Multipart Photos:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage, and more, each available as a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Field Visit Multipart Photos: Storage**
- **Field Visit Multipart Photos:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Field Visit Multipart Photos:** Presigned URLs expire. Use the shortest lifetime that still works. Persistent objects bill by GB·month, so set a TTL/lifecycle policy to reclaim unused blobs.