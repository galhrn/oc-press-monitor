/**
 * Typed API client (task P6.3).
 *
 * Every response is parsed through the **server's own zod schemas**, imported rather than
 * re-declared. That gives two things a hand-written interface cannot: a renamed field becomes
 * a compile error instead of an `undefined` three components deep, and a server that ships a
 * shape the client cannot handle fails loudly at the boundary rather than silently rendering
 * blanks.
 */
import {
  ApiErrorSchema,
  CompaniesResponseSchema,
  CompanyDetailResponseSchema,
  HealthResponseSchema,
  SummaryResponseSchema,
  type CompaniesResponse,
  type CompanyDetailResponse,
  type HealthResponse,
  type SummaryResponse,
} from '@oc/api/contract';
import type { z } from 'zod';

/** Thrown for every failure the UI can encounter, so error handling has one branch. */
export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string = 'E_REQUEST',
  ) {
    super(message);
    this.name = 'ApiRequestError';
  }
}

async function request<T>(path: string, schema: z.ZodType<T>, signal?: AbortSignal): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, { signal, headers: { accept: 'application/json' } });
  } catch (cause) {
    if (signal?.aborted) throw cause;
    throw new ApiRequestError(
      'Could not reach the API. Is it running on port 3000?',
      0,
      'E_NETWORK',
    );
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(body);
    throw new ApiRequestError(
      parsed.success ? parsed.data.error.message : `Request failed (${response.status})`,
      response.status,
      parsed.success ? parsed.data.error.code : 'E_HTTP',
    );
  }

  const result = schema.safeParse(body);
  if (!result.success) {
    // A shape mismatch is a contract break, not a rendering problem. Saying so here is what
    // stops it becoming a blank card nobody can explain.
    throw new ApiRequestError(
      `The API returned an unexpected shape for ${path}`,
      response.status,
      'E_CONTRACT',
    );
  }
  return result.data;
}

export const api = {
  health: (signal?: AbortSignal): Promise<HealthResponse> =>
    request('/health', HealthResponseSchema, signal),
  companies: (signal?: AbortSignal): Promise<CompaniesResponse> =>
    request('/api/companies', CompaniesResponseSchema, signal),
  company: (slug: string, signal?: AbortSignal): Promise<CompanyDetailResponse> =>
    request(`/api/companies/${encodeURIComponent(slug)}`, CompanyDetailResponseSchema, signal),
  summary: (signal?: AbortSignal): Promise<SummaryResponse> =>
    request('/api/summary', SummaryResponseSchema, signal),
};

/**
 * Narrows whatever a query surfaced into something displayable.
 *
 * TanStack types query errors as `unknown` unless the app registers a default, and a version
 * bump can quietly change that. Narrowing at the boundary is version-proof and stops
 * `String(error)` - or worse, `[object Object]` - reaching the screen.
 */
export function toMessage(error: unknown): string {
  if (error instanceof ApiRequestError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Something went wrong loading the dashboard.';
}
