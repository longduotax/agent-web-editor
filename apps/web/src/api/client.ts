import {
  ApiErrorSchema,
  BrowseProjectResponseSchema,
  FilePreviewResponseSchema,
  FileTreeResponseSchema,
  GitDiffResponseSchema,
  GitStatusResponseSchema,
  ProjectMutationResponseSchema,
  ProjectsResponseSchema,
  RunMutationResponseSchema,
  SessionsResponseSchema,
  ThreadMutationResponseSchema,
  ThreadSnapshotSchema,
  type ProjectId,
  type RunId,
  type ThreadId,
} from "@pi-web/contracts";
import { z } from "zod";

export class ApiClientError extends Error {
  public constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

async function request<T>(
  path: string,
  schema: z.ZodType<T>,
  init: RequestInit = {},
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body !== undefined) {
    headers.set("Content-Type", "application/json");
    headers.set("X-Pi-Web-Request", "1");
  }
  const response = await fetch(path, {
    ...init,
    headers,
  });
  const value: unknown = await response.json().catch(() => undefined);
  if (!response.ok) {
    const parsed = ApiErrorSchema.safeParse(value);
    throw new ApiClientError(
      response.status,
      parsed.success ? parsed.data.error.code : "invalid_response",
      parsed.success
        ? parsed.data.error.message
        : "The server returned an invalid error response.",
    );
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new ApiClientError(
      502,
      "invalid_response",
      "The server returned malformed data.",
    );
  return parsed.data;
}

export function commandId(): string {
  return crypto.randomUUID();
}
const body = (value: unknown): string => JSON.stringify(value);

export async function getWorkspace() {
  return await request("/api/projects", ProjectsResponseSchema);
}
export async function browseProject() {
  return await request("/api/projects/browse", BrowseProjectResponseSchema, {
    method: "POST",
    body: body({ idempotencyKey: commandId() }),
  });
}
export async function removeProject(projectId: ProjectId) {
  return await request(
    `/api/projects/${projectId}`,
    z.object({ removed: z.literal(true) }),
    { method: "DELETE", body: body({ idempotencyKey: commandId() }) },
  );
}
export async function setExpanded(
  projectId: ProjectId,
  sidebarExpanded: boolean,
) {
  return await request(
    `/api/projects/${projectId}`,
    ProjectMutationResponseSchema,
    {
      method: "PATCH",
      body: body({ sidebarExpanded, idempotencyKey: commandId() }),
    },
  );
}
export async function createThread(projectId: ProjectId) {
  return await request(
    `/api/projects/${projectId}/threads`,
    ThreadMutationResponseSchema,
    { method: "POST", body: body({ idempotencyKey: commandId() }) },
  );
}
export async function renameThread(
  projectId: ProjectId,
  threadId: ThreadId,
  title: string,
) {
  return await request(
    `/api/projects/${projectId}/threads/${threadId}`,
    ThreadMutationResponseSchema,
    { method: "PATCH", body: body({ title, idempotencyKey: commandId() }) },
  );
}
export async function discoverSessions(projectId: ProjectId) {
  return await request(
    `/api/projects/${projectId}/sessions`,
    SessionsResponseSchema,
  );
}
export async function importThread(
  projectId: ProjectId,
  runtimeSessionId: string,
) {
  return await request(
    `/api/projects/${projectId}/threads/import`,
    ThreadMutationResponseSchema,
    {
      method: "POST",
      body: body({ runtimeSessionId, idempotencyKey: commandId() }),
    },
  );
}
export async function getSnapshot(projectId: ProjectId, threadId: ThreadId) {
  return await request(
    `/api/projects/${projectId}/threads/${threadId}`,
    ThreadSnapshotSchema,
  );
}
export async function prompt(
  projectId: ProjectId,
  threadId: ThreadId,
  promptText: string,
) {
  return await request(
    `/api/projects/${projectId}/threads/${threadId}/prompt`,
    RunMutationResponseSchema,
    {
      method: "POST",
      body: body({ prompt: promptText, idempotencyKey: commandId() }),
    },
  );
}
export async function steer(
  projectId: ProjectId,
  threadId: ThreadId,
  promptText: string,
) {
  return await request(
    `/api/projects/${projectId}/threads/${threadId}/steer`,
    RunMutationResponseSchema,
    {
      method: "POST",
      body: body({ prompt: promptText, idempotencyKey: commandId() }),
    },
  );
}
export async function stop(projectId: ProjectId, threadId: ThreadId) {
  return await request(
    `/api/projects/${projectId}/threads/${threadId}/stop`,
    RunMutationResponseSchema,
    { method: "POST", body: body({ idempotencyKey: commandId() }) },
  );
}
export async function markViewed(
  projectId: ProjectId,
  threadId: ThreadId,
  runId: RunId,
) {
  return await request(
    `/api/projects/${projectId}/threads/${threadId}/runs/${runId}/viewed`,
    z.object({ viewed: z.literal(true) }),
    { method: "POST", body: body({ idempotencyKey: commandId() }) },
  );
}
export async function getFiles(projectId: ProjectId, search = "") {
  return await request(
    `/api/projects/${projectId}/files?search=${encodeURIComponent(search)}`,
    FileTreeResponseSchema,
  );
}
export async function getFile(projectId: ProjectId, path: string) {
  return await request(
    `/api/projects/${projectId}/file?path=${encodeURIComponent(path)}`,
    FilePreviewResponseSchema,
  );
}
export async function getStatus(projectId: ProjectId) {
  return await request(
    `/api/projects/${projectId}/git/status`,
    GitStatusResponseSchema,
  );
}
export async function getDiff(projectId: ProjectId, path: string) {
  return await request(
    `/api/projects/${projectId}/git/diff?path=${encodeURIComponent(path)}`,
    GitDiffResponseSchema,
  );
}

export function webSocketUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}
