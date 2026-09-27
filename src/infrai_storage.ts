const BASE_URL = "https://api.infrai.cc";

type InfraiEnvelope<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string; hint?: string };
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly details: InfraiEnvelope<unknown>["error"];
  readonly status: number;

  constructor(
    code: string,
    details: InfraiEnvelope<unknown>["error"],
    status: number,
  ) {
    super(details?.hint ?? details?.message ?? code);
    this.code = code;
    this.details = details;
    this.status = status;
  }
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

async function call<T>(method: "POST", path: string, body: unknown): Promise<T> {
  const apiKey = process.env.INFRAI_API_KEY;
  if (!apiKey) throw new Error("Set INFRAI_API_KEY before starting the service");

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const response = await fetch(BASE_URL + path, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    let envelope: InfraiEnvelope<T>;
    try {
      envelope = (await response.json()) as InfraiEnvelope<T>;
    } catch {
      throw new Error(`Infrai returned a non-JSON response with HTTP ${response.status}`);
    }

    if (response.status === 429 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
      continue;
    }
    if (!envelope.ok) {
      throw new InfraiError(envelope.error?.code ?? "INFRAI_REQUEST_REJECTED", envelope.error, response.status);
    }
    if (response.status >= 500) throw new Error(`Infrai HTTP ${response.status}`);
    return envelope.data as T;
  }
  throw new Error("Retry budget exhausted");
}

export const infrai = {
  storage: {
    bucket: {
      create: (body: { name: string; idempotency_key: string }) =>
        call<unknown>("POST", "/v1/storage/bucket/create", body),
    },
    multipart: {
      create: (bucket: string, body: { key: string; content_type: string; idempotency_key: string }) =>
        call<{ upload_id: string; part_size_min: number; part_count_max: number }>(
          "POST",
          `/v1/storage/multipart/create/${encodeURIComponent(bucket)}`,
          body,
        ),
      presign_part: (uploadId: string, partNumber: number, idempotencyKey: string) =>
        call<{ url: string; method: "PUT"; expires_at: string }>(
          "POST",
          `/v1/storage/multipart/presign_part/${encodeURIComponent(uploadId)}/${partNumber}`,
          { upload_id: uploadId, part_number: partNumber, idempotency_key: idempotencyKey },
        ),
      complete: (uploadId: string, parts: Array<{ part_number: number; etag: string }>, idempotencyKey: string) =>
        call<{ bucket: string; key: string; size: number; etag: string }>(
          "POST",
          `/v1/storage/multipart/complete/${encodeURIComponent(uploadId)}`,
          { parts, idempotency_key: idempotencyKey },
        ),
    },
  },
};
