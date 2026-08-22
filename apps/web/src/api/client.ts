import {
  ApiErrorSchema,
  ArchivedThreadsResponseSchema,
  ArchiveThreadResponseSchema,
  UnarchiveThreadResponseSchema,
  BrowseProjectResponseSchema,
  FilePreviewResponseSchema,
  FileTreeResponseSchema,
  GitDiffResponseSchema,
  GitStatusResponseSchema,
  ProjectMutationResponseSchema,
  ProjectsResponseSchema,
  RunMutationResponseSchema,
  SessionsResponseSchema,
  StartThreadResponseSchema,
  ThreadMutationResponseSchema,
  ThreadSnapshotSchema,
  WorkspacePreflightResponseSchema,
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

// `fetch` rejects with a bare `TypeError: Failed to fetch` when it never got
// a reply -- the workspace server stopped, was restarted, or the machine went
// to sleep. That string is the browser's, not ours, and it reached the reader
// verbatim inside a `role="alert"`: a developer sentence in the one place a
// non-developer most needs a next step. Everything else in this app maps a
// failure to a sentence with an action in it; this was the one hole.
//
// Mapped here rather than in `ErrorNotice` so every caller gets it -- queries
// and mutations alike -- and so the code is a real code the UI can branch on
// instead of a message match.
export const NETWORK_UNREACHABLE = "network_unreachable";
const NETWORK_UNREACHABLE_MESSAGE =
  "Can't reach the Pi workspace server — it may have stopped or be restarting. Your text is safe here; retry once it is back.";

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
  let response: Response;
  try {
    response = await fetch(path, {
      ...init,
      headers,
    });
  } catch (cause) {
    // An abort is the caller's own doing (a cancelled query, a navigation)
    // and must keep its identity so react-query does not report it as a
    // failure.
    if (cause instanceof DOMException && cause.name === "AbortError")
      throw cause;
    throw new ApiClientError(
      0,
      NETWORK_UNREACHABLE,
      NETWORK_UNREACHABLE_MESSAGE,
    );
  }
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
// The fallback route in, for when the native folder chooser cannot be used --
// it fails to open, opens behind the window, or lands on another desktop.
// Returns the same `{ project }` shape as every other project mutation; the
// browse route's `cancelled` outcome has no meaning here, because a typed
// path is either a project or an error.
export async function addProjectByPath(path: string) {
  return await request("/api/projects", ProjectMutationResponseSchema, {
    method: "POST",
    body: body({ path, idempotencyKey: commandId() }),
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
export async function getWorkspacePreflight(projectId: ProjectId) {
  return await request(
    `/api/projects/${projectId}/workspace-preflight`,
    WorkspacePreflightResponseSchema,
  );
}
export async function startThread(
  projectId: ProjectId,
  prompt: string,
  workspace:
    | { mode: "shared" }
    | {
        mode: "worktree";
        baseBranch: string;
        sourceChanges: "none" | "tracked_and_untracked";
        sourceStateToken?: string;
      },
  idempotencyKey: string,
) {
  return await request(
    `/api/projects/${projectId}/threads/start`,
    StartThreadResponseSchema,
    {
      method: "POST",
      body: body({ prompt, workspace, idempotencyKey }),
    },
  );
}
export async function archiveThread(projectId: ProjectId, threadId: ThreadId) {
  return await request(
    `/api/projects/${projectId}/threads/${threadId}/archive`,
    ArchiveThreadResponseSchema,
    { method: "POST", body: body({ idempotencyKey: commandId() }) },
  );
}
export async function unarchiveThread(
  projectId: ProjectId,
  threadId: ThreadId,
) {
  return await request(
    `/api/projects/${projectId}/threads/${threadId}/unarchive`,
    UnarchiveThreadResponseSchema,
    { method: "POST", body: body({ idempotencyKey: commandId() }) },
  );
}
export async function getArchivedThreads(projectId: ProjectId) {
  return await request(
    `/api/projects/${projectId}/archived-threads`,
    ArchivedThreadsResponseSchema,
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
export interface FileListingOptions {
  /** Bounded server-side substring search over the workspace-relative path. */
  search?: string;
  /** The directory to list, relative to the execution root; `""` is the root. */
  path?: string;
  /**
   * `"1"` fetches one level, which is what the tree asks for as the user
   * expands; `"full"` is the whole recursive listing, which only the flat
   * search mode wants (WSP-05 as revised by specification version 2).
   */
  depth?: "1" | "full";
  /** The explicit opt-in to seeing ignored paths. `.git` is never revealed. */
  showIgnored?: boolean;
}

export async function getFiles(
  projectId: ProjectId,
  threadId: ThreadId,
  options: FileListingOptions = {},
) {
  const query = new URLSearchParams({
    search: options.search ?? "",
    path: options.path ?? "",
    depth: options.depth ?? "full",
    showIgnored: options.showIgnored === true ? "true" : "false",
  });
  return await request(
    `/api/projects/${projectId}/threads/${threadId}/files?${query.toString()}`,
    FileTreeResponseSchema,
  );
}
export async function getFile(
  projectId: ProjectId,
  threadId: ThreadId,
  path: string,
) {
  return await request(
    `/api/projects/${projectId}/threads/${threadId}/file?path=${encodeURIComponent(path)}`,
    FilePreviewResponseSchema,
  );
}
export async function getStatus(projectId: ProjectId, threadId: ThreadId) {
  return await request(
    `/api/projects/${projectId}/threads/${threadId}/git/status`,
    GitStatusResponseSchema,
  );
}
export async function getDiff(
  projectId: ProjectId,
  threadId: ThreadId,
  path: string,
) {
  return await request(
    `/api/projects/${projectId}/threads/${threadId}/git/diff?path=${encodeURIComponent(path)}`,
    GitDiffResponseSchema,
  );
}

export function webSocketUrl(path: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}
