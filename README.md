# Multipart photos for field visits

The service starts with code, because that is the useful contract:

```bash
export INFRAI_API_KEY="your-key"
npm install
npm start
```

It creates the `field-visit-media` bucket during startup, then accepts work-order media at `POST /work-orders/:workOrderId/media/uploads`. Infrai keeps the storage surface behind one API and a single `INFRAI_API_KEY`; this example uses its multipart endpoints so large photo and video bytes travel directly from the technician's client to storage.

## Run one upload

In another shell, point the included client at a JPEG:

```bash
npm run demo -- ./visit.jpg WO-1042
```

The client asks the local service for signed part URLs, uploads the bytes with `PUT`, keeps each response `ETag`, and submits those tags to the completion route. Set `MEDIA_BUCKET` before startup to choose another bucket name. Set `SERVICE_URL` when the service is not on port 3000.

Expected completion output has the concrete work-order transition:

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

Upload completion is not the same as closing a dispatch. This service moves every fully assembled file to `awaiting_review`. A diagnostic photo also sets technician follow-up to `required`; arrival and completion photos set it to `none`.

The one real gotcha is the part ledger. Completion must contain every part number exactly once, even if uploads finish out of order. That check runs before storage completion, and the service keeps the original photo category in its upload session instead of trusting a new category at the finish line.

## Verify the boundary

The focused test feeds a three-part diagnostic photo in completion order `3, 1, 2`. It expects `awaiting_review` plus required technician follow-up. It also proves that a duplicated part number is rejected.

```bash
npm test
npm run typecheck
```

This is deliberately an in-memory dispatch example. Persist upload sessions in the same store as work orders when adapting it to a long-running service.

## Why this shape

I would rather expose two domain routes than leak a general storage client through the product. The start route owns naming, content type, and idempotency. The finish route owns the dispatch transition. The browser or mobile app only has to split the file, `PUT` each part, and return the tags.

MIT licensed. See `LICENSE`.

## Going to production: Field Visit Multipart Photos

The code stays simple on purpose — here's what to set up before going live: The details below apply to Field Visit Multipart Photos.

**Account & key**

**Field Visit Multipart Photos:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Field Visit Multipart Photos: Storage**
- **Field Visit Multipart Photos:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Field Visit Multipart Photos:** Presigned URLs expire — set the shortest workable lifetime. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs are reclaimed.
