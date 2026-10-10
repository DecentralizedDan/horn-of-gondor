import {
  decodeCursor,
  deleteExpiredTransmissions,
  getLatestTransmission,
  getTransmissionById,
  insertTransmission,
  listTransmissions,
  updateRetention,
} from "./database";
import type { ApiError, Env } from "./types";
import { validateSettings, validateTransmission } from "./validation";

const MAX_BODY_BYTES = 16 * 1024;
const MAX_AUDIO_BYTES = 2 * 1_024 * 1_024;
const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PUBLIC_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "public, max-age=0, s-maxage=5",
};
const SECURITY_HEADERS = {
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "X-Robots-Tag": "noindex, nofollow, noarchive, nosnippet",
};

function jsonResponse(
  body: unknown,
  status = 200,
  headers: HeadersInit = {},
): Response {
  return Response.json(body, {
    status,
    headers: {
      ...SECURITY_HEADERS,
      ...headers,
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

function errorResponse(
  status: number,
  error: ApiError,
  headers: HeadersInit = {},
): Response {
  return jsonResponse({ error }, status, {
    "Cache-Control": "no-store",
    ...headers,
  });
}

async function secureTokenMatches(
  expected: string | undefined,
  authorization: string | null,
): Promise<boolean> {
  if (
    !expected ||
    !authorization ||
    !authorization.startsWith("Bearer ")
  ) {
    return false;
  }

  const presented = authorization.slice("Bearer ".length);
  if (!presented) {
    return false;
  }

  const encoder = new TextEncoder();
  const [expectedHash, presentedHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
    crypto.subtle.digest("SHA-256", encoder.encode(presented)),
  ]);

  const expectedBytes = new Uint8Array(expectedHash);
  const presentedBytes = new Uint8Array(presentedHash);
  let difference = 0;
  for (let index = 0; index < expectedBytes.length; index += 1) {
    difference |= expectedBytes[index] ^ presentedBytes[index];
  }

  return difference === 0;
}

async function requireAuthentication(
  request: Request,
  env: Env,
): Promise<Response | null> {
  const authenticated = await secureTokenMatches(
    env.INGEST_TOKEN,
    request.headers.get("Authorization"),
  );

  return authenticated
    ? null
    : errorResponse(401, {
        code: "unauthorized",
        message: "A valid upload token is required.",
      });
}

async function parseJsonBody(
  request: Request,
): Promise<
  | { ok: true; value: unknown }
  | { ok: false; response: Response }
> {
  const declaredLength = Number.parseInt(
    request.headers.get("Content-Length") ?? "0",
    10,
  );
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: errorResponse(413, {
        code: "payload_too_large",
        message: "The request body must not exceed 16 KiB.",
      }),
    };
  }

  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) {
    return {
      ok: false,
      response: errorResponse(413, {
        code: "payload_too_large",
        message: "The request body must not exceed 16 KiB.",
      }),
    };
  }

  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return {
      ok: false,
      response: errorResponse(400, {
        code: "invalid_json",
        message: "The request body must contain valid JSON.",
      }),
    };
  }
}

async function createTransmission(
  request: Request,
  env: Env,
): Promise<Response> {
  const authenticationError = await requireAuthentication(request, env);
  if (authenticationError) {
    return authenticationError;
  }

  const body = await parseJsonBody(request);
  if (!body.ok) {
    return body.response;
  }

  const validation = validateTransmission(body.value);
  if (!validation.ok) {
    return errorResponse(400, {
      code: "validation_error",
      message: "The request contains invalid fields.",
      details: validation.details,
    });
  }

  if (validation.value.audioAvailable) {
    const audio = await env.AUDIO.head(
      `audio/${validation.value.eventId}.wav`,
    );
    if (
      !audio ||
      audio.size !== validation.value.audioSizeBytes ||
      audio.httpMetadata?.contentType !== "audio/wav"
    ) {
      return errorResponse(400, {
        code: "audio_not_found",
        message:
          "The referenced audio must be uploaded before its transmission.",
      });
    }
  }

  const result = await insertTransmission(env.DB, validation.value);
  if (result.outcome === "conflict") {
    return errorResponse(409, {
      code: "event_conflict",
      message: "The event ID is already associated with different data.",
    });
  }

  return jsonResponse(
    {
      data: {
        eventId: result.transmission.eventId,
        receivedAt: result.transmission.receivedAt,
        duplicate: result.outcome === "duplicate",
      },
    },
    result.outcome === "created" ? 201 : 200,
    { "Cache-Control": "no-store" },
  );
}

async function latestTransmission(
  request: Request,
  env: Env,
): Promise<Response> {
  const transmission = await getLatestTransmission(env.DB);
  const etag = transmission
    ? `"${transmission.eventId}:${transmission.receivedAt}:${transmission.audioAvailable ? 1 : 0}"`
    : '"empty"';

  if (request.headers.get("If-None-Match") === etag) {
    return new Response(null, {
      status: 304,
      headers: {
        ...SECURITY_HEADERS,
        ...PUBLIC_HEADERS,
        ETag: etag,
      },
    });
  }

  return jsonResponse(
    { data: transmission },
    200,
    {
      ...PUBLIC_HEADERS,
      ETag: etag,
    },
  );
}

async function transmissionHistory(
  request: Request,
  env: Env,
): Promise<Response> {
  const url = new URL(request.url);
  const limitParameter = url.searchParams.get("limit");
  const limit = limitParameter === null ? 50 : Number(limitParameter);

  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    return errorResponse(
      400,
      {
        code: "validation_error",
        message: "The limit must be an integer from 1 through 100.",
        details: [
          {
            field: "limit",
            message: "Must be an integer from 1 through 100.",
          },
        ],
      },
      PUBLIC_HEADERS,
    );
  }

  const cursorParameter = url.searchParams.get("cursor");
  const cursor =
    cursorParameter === null ? null : decodeCursor(cursorParameter);
  if (cursorParameter !== null && cursor === null) {
    return errorResponse(
      400,
      {
        code: "invalid_cursor",
        message: "The pagination cursor is invalid.",
      },
      PUBLIC_HEADERS,
    );
  }

  const sinceParameter = url.searchParams.get("since");
  let sinceMs: number | null = null;
  if (sinceParameter !== null) {
    sinceMs = Date.parse(sinceParameter);
    if (
      Number.isNaN(sinceMs) ||
      new Date(sinceMs).toISOString() !== sinceParameter
    ) {
      return errorResponse(
        400,
        {
          code: "validation_error",
          message:
            "The since value must be an RFC 3339 UTC timestamp with millisecond precision.",
          details: [
            {
              field: "since",
              message:
                "Must be an RFC 3339 UTC timestamp with millisecond precision.",
            },
          ],
        },
        PUBLIC_HEADERS,
      );
    }
  }

  const result = await listTransmissions(env.DB, limit, cursor, sinceMs);
  return jsonResponse(
    {
      data: result.transmissions,
      pagination: {
        nextCursor: result.nextCursor,
        hasMore: result.hasMore,
      },
    },
    200,
    PUBLIC_HEADERS,
  );
}

async function updateSettings(
  request: Request,
  env: Env,
): Promise<Response> {
  const authenticationError = await requireAuthentication(request, env);
  if (authenticationError) {
    return authenticationError;
  }

  const body = await parseJsonBody(request);
  if (!body.ok) {
    return body.response;
  }

  const validation = validateSettings(body.value);
  if (!validation.ok) {
    return errorResponse(400, {
      code: "validation_error",
      message: "The request contains invalid fields.",
      details: validation.details,
    });
  }

  const settings = await updateRetention(
    env.DB,
    validation.value.retentionDays,
    validation.value.audioRetentionDays,
  );
  return jsonResponse(
    { data: settings },
    200,
    { "Cache-Control": "no-store" },
  );
}

async function uploadTransmissionAudio(
  request: Request,
  env: Env,
  eventId: string,
): Promise<Response> {
  const authenticationError = await requireAuthentication(request, env);
  if (authenticationError) {
    return authenticationError;
  }
  if (!UUID_V4.test(eventId)) {
    return errorResponse(400, {
      code: "validation_error",
      message: "The event ID must be a UUID v4.",
    });
  }
  const contentType = request.headers
    .get("Content-Type")
    ?.split(";", 1)[0]
    .trim()
    .toLowerCase();
  if (contentType !== "audio/wav") {
    return errorResponse(400, {
      code: "validation_error",
      message: 'Audio uploads must use Content-Type "audio/wav".',
    });
  }
  const declaredLength = Number.parseInt(
    request.headers.get("Content-Length") ?? "0",
    10,
  );
  if (
    Number.isFinite(declaredLength) &&
    declaredLength > MAX_AUDIO_BYTES
  ) {
    return errorResponse(413, {
      code: "payload_too_large",
      message: "Audio must not exceed 2 MiB.",
    });
  }

  const audio = await request.arrayBuffer();
  if (audio.byteLength < 44 || audio.byteLength > MAX_AUDIO_BYTES) {
    return errorResponse(audio.byteLength > MAX_AUDIO_BYTES ? 413 : 400, {
      code:
        audio.byteLength > MAX_AUDIO_BYTES
          ? "payload_too_large"
          : "validation_error",
      message:
        audio.byteLength > MAX_AUDIO_BYTES
          ? "Audio must not exceed 2 MiB."
          : "Audio must contain a valid WAV header.",
    });
  }
  const header = new Uint8Array(audio, 0, 12);
  const signature = new TextDecoder().decode(header);
  if (
    signature.slice(0, 4) !== "RIFF" ||
    signature.slice(8, 12) !== "WAVE"
  ) {
    return errorResponse(400, {
      code: "validation_error",
      message: "Audio must contain a valid WAV header.",
    });
  }

  await env.AUDIO.put(`audio/${eventId}.wav`, audio, {
    httpMetadata: { contentType: "audio/wav" },
  });
  return jsonResponse(
    { data: { eventId, sizeBytes: audio.byteLength } },
    201,
    { "Cache-Control": "no-store" },
  );
}

async function transmissionAudio(
  env: Env,
  eventId: string,
): Promise<Response> {
  if (!UUID_V4.test(eventId)) {
    return errorResponse(404, {
      code: "not_found",
      message: "The requested audio does not exist.",
    });
  }
  const transmission = await getTransmissionById(env.DB, eventId);
  if (!transmission?.audioAvailable) {
    return errorResponse(404, {
      code: "not_found",
      message: "The requested audio does not exist.",
    });
  }
  const audio = await env.AUDIO.get(`audio/${eventId}.wav`);
  if (!audio) {
    return errorResponse(404, {
      code: "not_found",
      message: "The requested audio does not exist.",
    });
  }

  return new Response(audio.body, {
    status: 200,
    headers: {
      ...SECURITY_HEADERS,
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
      "Content-Length": String(audio.size),
      "Content-Type": "audio/wav",
      ETag: audio.httpEtag,
    },
  });
}

function methodNotAllowed(allowed: string): Response {
  return errorResponse(
    405,
    {
      code: "method_not_allowed",
      message: `This endpoint requires ${allowed}.`,
    },
    { Allow: allowed },
  );
}

async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (pathname === "/api/v1/transmissions/latest") {
    return request.method === "GET"
      ? latestTransmission(request, env)
      : methodNotAllowed("GET");
  }

  if (pathname === "/api/v1/transmissions") {
    if (request.method === "GET") {
      return transmissionHistory(request, env);
    }
    if (request.method === "POST") {
      return createTransmission(request, env);
    }
    return methodNotAllowed("GET, POST");
  }

  if (pathname === "/api/v1/settings") {
    return request.method === "PUT"
      ? updateSettings(request, env)
      : methodNotAllowed("PUT");
  }

  const audioMatch = pathname.match(
    /^\/api\/v1\/transmissions\/([0-9a-f-]+)\/audio$/,
  );
  if (audioMatch) {
    if (request.method === "GET") {
      return transmissionAudio(env, audioMatch[1]);
    }
    if (request.method === "PUT") {
      return uploadTransmissionAudio(request, env, audioMatch[1]);
    }
    return methodNotAllowed("GET, PUT");
  }

  return errorResponse(
    404,
    {
      code: "not_found",
      message: "The requested API endpoint does not exist.",
    },
    PUBLIC_HEADERS,
  );
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return await handleApiRequest(request, env);
    } catch (error) {
      console.error("Horn of Gondor API request failed.", error);
      return errorResponse(503, {
        code: "storage_unavailable",
        message: "The service is temporarily unavailable.",
      });
    }
  },

  async scheduled(_controller, env, context): Promise<void> {
    context.waitUntil(
      deleteExpiredTransmissions(env).catch((error: unknown) => {
        console.error("Horn of Gondor retention cleanup failed.", error);
      }),
    );
  },
} satisfies ExportedHandler<Env>;
