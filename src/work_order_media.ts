import express, { type NextFunction, type Request, type Response } from "express";
import { z } from "zod";
import { InfraiError, infrai } from "./infrai_storage.js";
import { decideCompletedUpload, type PhotoKind } from "./media_decision.js";

const BUCKET = process.env.MEDIA_BUCKET ?? "field-visit-media";

const startBody = z.object({
  technicianId: z.string().min(1).max(80),
  fileName: z.string().min(1).max(180).regex(/^[a-zA-Z0-9._-]+$/),
  contentType: z.enum(["image/jpeg", "image/png", "video/mp4"]),
  byteSize: z.number().int().positive(),
  partCount: z.number().int().min(1).max(1000),
  photoKind: z.enum(["arrival", "diagnostic", "completion"]),
}).strict();

const completeBody = z.object({
  parts: z.array(z.object({
    part_number: z.number().int().positive(),
    etag: z.string().min(1),
  }).strict()).min(1),
}).strict();

type UploadSession = {
  workOrderId: string;
  technicianId: string;
  photoKind: PhotoKind;
  partCount: number;
  objectKey: string;
};

const sessions = new Map<string, UploadSession>();

function idempotencyKey(...pieces: Array<string | number>): string {
  return pieces.join(":");
}

export async function createService(): Promise<express.Express> {
  await infrai.storage.bucket.create({
    name: BUCKET,
    idempotency_key: "field-visit-media-bucket-v1",
  });

  const app = express();
  app.use(express.json({ limit: "32kb" }));

  app.post("/work-orders/:workOrderId/media/uploads", async (request, response, next) => {
    try {
      const input = startBody.parse(request.body);
      const workOrderId = z.string().min(1).max(80).parse(request.params.workOrderId);
      const objectKey = `work-orders/${workOrderId}/${input.technicianId}/${input.fileName}`;
      const requestKey = idempotencyKey(workOrderId, input.technicianId, input.fileName, input.byteSize);
      const created = await infrai.storage.multipart.create(BUCKET, {
        key: objectKey,
        content_type: input.contentType,
        idempotency_key: requestKey,
      });

      if (input.partCount > created.part_count_max) {
        throw new RangeError(`partCount must not exceed ${created.part_count_max}`);
      }

      const parts = await Promise.all(
        Array.from({ length: input.partCount }, async (_, index) => {
          const partNumber = index + 1;
          const signed = await infrai.storage.multipart.presign_part(
            created.upload_id,
            partNumber,
            idempotencyKey(requestKey, partNumber),
          );
          return { partNumber, uploadUrl: signed.url, method: signed.method };
        }),
      );

      sessions.set(created.upload_id, {
        workOrderId,
        technicianId: input.technicianId,
        photoKind: input.photoKind,
        partCount: input.partCount,
        objectKey,
      });

      response.status(201).json({
        uploadId: created.upload_id,
        objectKey,
        minimumPartBytes: created.part_size_min,
        dispatchStatus: "uploading",
        parts,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/work-orders/:workOrderId/media/uploads/:uploadId/complete", async (request, response, next) => {
    try {
      const input = completeBody.parse(request.body);
      const parts = input.parts.map((part) => ({
        part_number: part.part_number!,
        etag: part.etag!,
      }));
      const workOrderId = z.string().min(1).max(80).parse(request.params.workOrderId);
      const uploadId = z.string().min(1).parse(request.params.uploadId);
      const session = sessions.get(uploadId);
      if (!session || session.workOrderId !== workOrderId) {
        response.status(404).json({ error: "Upload session not found" });
        return;
      }

      const decision = decideCompletedUpload(
        session.photoKind,
        session.partCount,
        parts.map((part) => part.part_number),
      );
      const object = await infrai.storage.multipart.complete(
        uploadId,
        parts,
        idempotencyKey(uploadId, "complete"),
      );
      sessions.delete(uploadId);

      response.json({
        workOrderId,
        technicianId: session.technicianId,
        photoKind: session.photoKind,
        objectKey: session.objectKey,
        object,
        ...decision,
      });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) {
      response.status(400).json({ error: "Invalid request", issues: error.issues });
      return;
    }
    if (error instanceof RangeError) {
      response.status(400).json({ error: error.message });
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      response.status(status).json({ error: error.code, message: error.message });
      return;
    }
    console.error(error);
    response.status(502).json({ error: "Storage request failed" });
  });

  return app;
}

const port = Number(process.env.PORT ?? 3000);
createService()
  .then((app) => app.listen(port, () => console.log(`Work-order media service listening on http://localhost:${port}`)))
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
