import type { Contact, ContactInput, ContactPatch } from "@strada/shared";
import { getAccessToken } from "./auth";

const baseUrl = (
  import.meta.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3001"
).replace(/\/+$/, "");

/** A failed request, carrying per-field messages when the server rejected the body. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export class NotSignedInError extends ApiError {
  constructor() {
    super("Your session has ended. Sign in again.", 401);
    this.name = "NotSignedInError";
  }
}

interface ApiRequest {
  method: "GET" | "POST" | "PATCH" | "DELETE";
  path: string;
  body?: unknown;
}

async function send({ method, path, body }: ApiRequest): Promise<Response> {
  const token = await getAccessToken();
  if (!token) throw new NotSignedInError();

  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function request<T>(req: ApiRequest): Promise<T> {
  let response = await send(req);

  // One retry on 401. A token can expire in the moment between being handed out and
  // being read upstream; asking again forces a refresh. Retrying only once means a
  // genuinely signed-out user surfaces immediately instead of looping.
  if (response.status === 401) {
    response = await send(req);
  }

  if (response.status === 401) throw new NotSignedInError();

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}) as Record<string, unknown>);
    throw new ApiError(
      typeof payload.error === "string" ? payload.error : "Something went wrong.",
      response.status,
      payload.fields as Record<string, string> | undefined,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const contactsApi = {
  list: () =>
    request<{ contacts: Contact[] }>({ method: "GET", path: "/api/contacts" }).then(
      (r) => r.contacts,
    ),

  create: (input: ContactInput) =>
    request<{ contact: Contact }>({
      method: "POST",
      path: "/api/contacts",
      body: input,
    }).then((r) => r.contact),

  update: (id: string, patch: ContactPatch) =>
    request<{ contact: Contact }>({
      method: "PATCH",
      path: `/api/contacts/${id}`,
      body: patch,
    }).then((r) => r.contact),

  remove: (id: string) =>
    request<{ contact: Contact }>({
      method: "DELETE",
      path: `/api/contacts/${id}`,
    }).then((r) => r.contact),
};
