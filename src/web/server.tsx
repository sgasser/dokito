import { createHash } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { type Context, Hono } from "hono";
import { secureHeaders } from "hono/secure-headers";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { renderToStaticMarkup } from "react-dom/server";
import { loadConfig } from "../core/config";
import { DokitoError, fail, normalizeError } from "../core/error";
import { validateRelativePath } from "../core/files";
import type { LocalConfig } from "../core/types";
import {
  DokitoApp,
  DokitoErrorPage,
  DokitoNavigationFragment,
  DokitoWelcomePage,
} from "./app";
import clientScript from "./client.generated.js" with { type: "text" };
import type { WebDashboardData } from "./data";
import {
  loadFocusView,
  loadProjectsView,
  loadProjectView,
  loadResourcesView,
  loadSearchView,
  loadTasksView,
  paletteIndex,
  WorkspaceStore,
} from "./data";
import { defaultArea, requireArea } from "./data/workspace";
import { FONT_FILES } from "./fonts";
import {
  parseFocusQuery,
  parseProjectsQuery,
  parseResourcesQuery,
  parseSearchQuery,
  parseTasksQuery,
} from "./request";
import { AREA_PREFIX, routes } from "./routes";

const WEB_HOSTNAME = "127.0.0.1";
const WEB_REQUEST_HOSTNAMES = new Set([WEB_HOSTNAME, "localhost", "[::1]"]);
const DEFAULT_PORT = 4176;
const DEFAULT_PORT_ATTEMPTS = 10;
const HEALTH_PATH = "/health";
const SCRIPT_PATH = "/app.js";
const FAVICON_PATH = "/favicon.svg";
const INDEX_PATH = "/index.json";
const NAVIGATION_HEADER = "x-dokito-navigation";
const HEALTH_SERVICE = "dokito-web";
const HEALTH_PROTOCOL_VERSION = 2;
const BAD_REQUEST_CODES = new Set([
  "document_area_required",
  "task_status_invalid",
  "web_query_invalid",
]);
const NOT_FOUND_CODES = new Set([
  "area_not_found",
  "document_not_found",
  "project_not_found",
  "task_not_found",
  "asset_not_found",
]);
export interface WebServerInput {
  configPath: string;
  port?: number;
  /** Identifies a CLI-managed detached runtime. Foreground servers omit it. */
  runtimeId?: string;
  /** Optional snapshot factory for embedding and request-path tests. */
  workspaceStore?: WorkspaceStore;
}

interface WebEnv {
  Variables: {
    workspaceStore: WorkspaceStore;
  };
}

type WebContext = Context<WebEnv>;

export type WebRequestHandler = (request: Request) => Promise<Response>;

interface WebServerOptions {
  hostname: string;
  port: number;
  reusePort: false;
  development: false;
  fetch: WebRequestHandler;
}

type WebServerFactory = (options: WebServerOptions) => Bun.Server<undefined>;

type WebServerProbe = (
  hostname: string,
  port: number,
  instanceId: string,
) => Promise<boolean>;

interface WebHealth {
  service: "dokito-web";
  protocolVersion: number;
  instanceId: string;
  runtimeId?: string;
  pid?: number;
}

export interface WebServerResult {
  hostname: string;
  port: number;
  url: URL;
  reused: boolean;
  server?: Bun.Server<undefined>;
}

export function webInstanceId(configPath: string): string {
  return createHash("sha256")
    .update(path.resolve(configPath))
    .digest("hex")
    .slice(0, 16);
}

function errorCode(error: unknown): string | undefined {
  return typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

export function candidateWebServerPorts(port?: number): number[] {
  if (port !== undefined) {
    return [port];
  }
  return Array.from(
    { length: DEFAULT_PORT_ATTEMPTS },
    (_, index) => DEFAULT_PORT + index,
  );
}

export function normalizeWebServerStartError(
  error: unknown,
  attemptedPorts: readonly number[],
): DokitoError {
  const normalized = normalizeError(error);
  const causeCode = errorCode(error);
  const firstPort = attemptedPorts[0];
  const lastPort = attemptedPorts.at(-1);
  const target =
    attemptedPorts.length === 1
      ? `at http://${WEB_HOSTNAME}:${firstPort}`
      : `on ports ${firstPort}-${lastPort}`;

  return new DokitoError(
    "web_start_failed",
    `Could not start Dokito Web ${target}. The port may be in use or the environment may block local listening sockets.`,
    {
      hostname: WEB_HOSTNAME,
      attemptedPorts: [...attemptedPorts],
      ...(causeCode ? { causeCode } : {}),
      causeMessage: normalized.message,
    },
  );
}

function htmlResponse(markup: string, status = 200): Response {
  return new Response(`<!doctype html>${markup}`, {
    status,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function navigationResponse(markup: string): Response {
  return new Response(markup, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      [NAVIGATION_HEADER]: "1",
    },
  });
}

function notFoundResponse(): Response {
  return htmlResponse(
    renderToStaticMarkup(
      <DokitoErrorPage
        code="page_not_found"
        message="This address does not exist. Return to the overview to continue."
      />,
    ),
    404,
  );
}

function assetResponse(body: string, type: string): Response {
  return new Response(body, {
    headers: { "content-type": `${type}; charset=utf-8` },
  });
}

const IMAGE_TYPES = {
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
} as const;

async function localImageResponse(
  workspaceStore: WorkspaceStore,
  areaId: string,
  relativePath: string,
  ifNoneMatch?: string,
): Promise<Response> {
  let safePath: string;
  try {
    safePath = validateRelativePath(relativePath).replaceAll("\\", "/");
  } catch {
    throw new DokitoError(
      "asset_not_found",
      `Image not found in Area '${areaId}': ${relativePath}`,
    );
  }
  const extension = path.extname(safePath).toLocaleLowerCase();
  fail(
    Object.hasOwn(IMAGE_TYPES, extension),
    "asset_not_found",
    `Image not found in Area '${areaId}': ${relativePath}`,
  );
  const area = requireArea(
    (await workspaceStore.snapshot({ area: areaId })).scope,
  );
  let target = area.root;
  for (const segment of safePath.split("/").filter(Boolean)) {
    target = path.join(target, segment);
    let info: Awaited<ReturnType<typeof lstat>>;
    try {
      info = await lstat(target);
    } catch {
      throw new DokitoError(
        "asset_not_found",
        `Image not found in Area '${areaId}': ${relativePath}`,
      );
    }
    fail(
      !info.isSymbolicLink(),
      "asset_not_found",
      `Image not found in Area '${areaId}': ${relativePath}`,
    );
  }
  const info = await lstat(target);
  fail(
    info.isFile(),
    "asset_not_found",
    `Image not found in Area '${areaId}': ${relativePath}`,
  );
  const etag = `"${createHash("sha256")
    .update(
      [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(":"),
    )
    .digest("hex")
    .slice(0, 20)}"`;
  const headers = {
    "cache-control": "private, no-cache",
    "content-type": IMAGE_TYPES[extension as keyof typeof IMAGE_TYPES],
    etag,
  };
  if (ifNoneMatch === etag) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(Bun.file(target), {
    headers,
  });
}

function webErrorStatus(error: DokitoError): number {
  if (BAD_REQUEST_CODES.has(error.code)) {
    return 400;
  }
  if (NOT_FOUND_CODES.has(error.code)) {
    return 404;
  }
  return 500;
}

export async function readWebHealth(
  hostname: string,
  port: number,
): Promise<WebHealth | null> {
  try {
    const response = await fetch(`http://${hostname}:${port}${HEALTH_PATH}`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(500),
    });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as Record<string, unknown>;
    if (
      body.service !== HEALTH_SERVICE ||
      body.protocolVersion !== HEALTH_PROTOCOL_VERSION ||
      typeof body.instanceId !== "string"
    ) {
      return null;
    }
    return {
      service: HEALTH_SERVICE,
      protocolVersion: HEALTH_PROTOCOL_VERSION,
      instanceId: body.instanceId,
      ...(typeof body.runtimeId === "string"
        ? { runtimeId: body.runtimeId }
        : {}),
      ...(typeof body.pid === "number" && Number.isInteger(body.pid)
        ? { pid: body.pid }
        : {}),
    };
  } catch {
    return null;
  }
}

async function probeDokitoWeb(
  hostname: string,
  port: number,
  instanceId: string,
): Promise<boolean> {
  return (await readWebHealth(hostname, port))?.instanceId === instanceId;
}

/**
 * Routes are a table, not a chain of conditionals: each one names the thing it
 * addresses and hands the loader exactly the arguments that thing needs.
 */
function createWebApp(input: Omit<WebServerInput, "port">): Hono<WebEnv> {
  const app = new Hono<WebEnv>();
  const instanceId = webInstanceId(input.configPath);
  const workspaceStore =
    input.workspaceStore ?? new WorkspaceStore(input.configPath);

  /*
   * The enhancement script is served from this origin and nowhere else: no
   * inline scripts, no third-party origins, no network egress beyond the local
   * server. Responses are not cached, and every response says so.
   */
  app.use(async (c, next) => {
    c.set("workspaceStore", workspaceStore);
    await next();
  });
  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        fontSrc: ["'self'"],
        imgSrc: ["'self'"],
        styleSrc: ["'unsafe-inline'"],
        formAction: ["'self'"],
        baseUri: ["'none'"],
        frameAncestors: ["'none'"],
      },
      referrerPolicy: "no-referrer",
      strictTransportSecurity: false,
    }),
  );
  app.use(async (c, next) => {
    await next();
    if (!c.res.headers.has("cache-control")) {
      c.header("cache-control", "no-store");
    }
    c.header("x-dokito-web", String(HEALTH_PROTOCOL_VERSION));
  });
  app.use(async (c, next) => {
    const hostname = new URL(c.req.url).hostname.toLocaleLowerCase("en-US");
    if (!WEB_REQUEST_HOSTNAMES.has(hostname)) {
      return c.text("Misdirected Request.\n", 421);
    }
    return next();
  });

  const render = async (
    c: WebContext,
    data: Promise<WebDashboardData>,
  ): Promise<Response> => {
    const resolved = await data;
    return c.req.header(NAVIGATION_HEADER) === "1"
      ? navigationResponse(
          renderToStaticMarkup(<DokitoNavigationFragment data={resolved} />),
        )
      : htmlResponse(renderToStaticMarkup(<DokitoApp data={resolved} />));
  };

  const workspace = (c: WebContext) => ({
    configPath: input.configPath,
    workspaceStore: c.var.workspaceStore,
  });

  /*
   * Where every new install starts. Deliberately not `roots.length === 0`: an
   * Area whose path has gone missing also leaves no roots, and welcoming there
   * would hide a broken registration behind a first-run screen. Taking the
   * config rather than a snapshot lets each caller answer from what it holds.
   */
  const hasNoRegisteredArea = (config: LocalConfig): boolean =>
    Object.keys(config.areas).length === 0;

  const welcomePage = (): Response =>
    htmlResponse(
      renderToStaticMarkup(<DokitoWelcomePage configPath={input.configPath} />),
    );

  const redirectToDefaultArea = async (
    c: WebContext,
    pathFor: (area: string) => string,
  ): Promise<Response> => {
    const snapshot = await c.var.workspaceStore.snapshot();
    if (hasNoRegisteredArea(snapshot.scope.config)) {
      return welcomePage();
    }
    const area = defaultArea(snapshot.scope, await snapshot.navigation());
    const query = new URL(c.req.url).search;
    return c.redirect(`${pathFor(area.manifest.id)}${query}`);
  };

  app.onError((error, c) => {
    const normalized = normalizeError(error);
    const status = webErrorStatus(normalized);
    if (c.req.path.endsWith(".txt")) {
      return c.text(`${normalized.message}\n`, status as ContentfulStatusCode);
    }
    if (c.req.path.endsWith(".json")) {
      return c.json({ error: normalized.code }, status as ContentfulStatusCode);
    }
    return htmlResponse(
      renderToStaticMarkup(
        <DokitoErrorPage code={normalized.code} message={normalized.message} />,
      ),
      status,
    );
  });

  app.notFound(() => notFoundResponse());

  app.get(HEALTH_PATH, (c) =>
    c.json(
      {
        service: HEALTH_SERVICE,
        protocolVersion: HEALTH_PROTOCOL_VERSION,
        instanceId,
        ...(input.runtimeId
          ? { runtimeId: input.runtimeId, pid: process.pid }
          : {}),
      },
      200,
    ),
  );

  app.get(SCRIPT_PATH, () => assetResponse(clientScript, "text/javascript"));
  app.get(FAVICON_PATH, () =>
    assetResponse(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#18181b"/><path fill="#fafafa" d="M9 8h7.2c4.4 0 7.3 3.2 7.3 8s-2.9 8-7.3 8H9V8Zm4.2 3.6v8.8H16c2 0 3.2-1.7 3.2-4.4S18 11.6 16 11.6h-2.8Z"/></svg>',
      "image/svg+xml",
    ),
  );

  app.get("/fonts/:name", async (c) => {
    // A plain index would answer for `constructor` and every other name on
    // Object.prototype, and hand Bun.file a function.
    const name = c.req.param("name");
    const file = Object.hasOwn(FONT_FILES, name)
      ? FONT_FILES[name as keyof typeof FONT_FILES]
      : undefined;
    if (!file) {
      return c.text("Not found.\n", 404);
    }
    return new Response(Bun.file(file), {
      headers: { "content-type": "font/woff2" },
    });
  });

  app.get(INDEX_PATH, async (c) => {
    const requestedArea = c.req.query("area");
    let area = requestedArea;
    if (!area) {
      const snapshot = await c.var.workspaceStore.snapshot();
      // An empty index, because a 404 would make every consumer special-case
      // the first run.
      if (hasNoRegisteredArea(snapshot.scope.config)) {
        return c.json([]);
      }
      area = defaultArea(snapshot.scope, await snapshot.navigation()).manifest
        .id;
    }
    return c.json(
      await paletteIndex({
        ...workspace(c),
        area,
      }),
    );
  });

  /*
   * Focus. The one destination that does not redirect to an Area: it is about
   * every Area in scope, so `/focus` is the whole address.
   */
  app.get("/focus", async (c) => {
    // Focus needs the welcome too: its own empty state reads "nothing due",
    // which describes finished work rather than an empty workspace. Its loader
    // builds the snapshot, so this asks the config instead of resolving twice.
    if (hasNoRegisteredArea(await loadConfig(input.configPath))) {
      return welcomePage();
    }
    const query = parseFocusQuery(c.req.query());
    return render(
      c,
      loadFocusView({
        ...workspace(c),
        ...(query.includePaused ? { includePaused: true } : {}),
      }),
    );
  });

  // Tasks
  const tasks = (c: WebContext, area?: string, task?: string) => {
    const query = parseTasksQuery(c.req.query());
    return render(
      c,
      loadTasksView({
        ...workspace(c),
        ...(area ? { area } : {}),
        ...(task ? { task } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.project ? { project: query.project } : {}),
        ...(query.repository ? { repository: query.repository } : {}),
      }),
    );
  };
  app.get("/tasks", (c) => redirectToDefaultArea(c, routes.tasks));
  app.get(`${AREA_PREFIX}/:area/tasks`, (c) => tasks(c, c.req.param("area")));
  app.get(`${AREA_PREFIX}/:area/tasks/:task`, (c) =>
    tasks(c, c.req.param("area"), c.req.param("task")),
  );

  // Resources
  const resources = (
    c: WebContext,
    area?: string,
    document?: string,
  ): Promise<Response> => {
    const query = parseResourcesQuery(c.req.query());
    return render(
      c,
      loadResourcesView({
        ...workspace(c),
        ...(area ? { area } : {}),
        ...(document ? { document } : {}),
        ...(query.archived ? { archived: true } : {}),
      }),
    );
  };
  app.get("/resources", (c) => redirectToDefaultArea(c, routes.resources));
  app.get("/", (c) => redirectToDefaultArea(c, routes.resources));
  app.get(`${AREA_PREFIX}/:area`, (c) => resources(c, c.req.param("area")));
  app.get(`${AREA_PREFIX}/:area/resources`, (c) =>
    resources(c, c.req.param("area")),
  );
  app.get(`${AREA_PREFIX}/:area/resources/*`, (c) => {
    const document = areaPathOf(c.req.path, c.req.param("area"), "resources");
    if (document === undefined) {
      return notFoundResponse();
    }
    return resources(c, c.req.param("area"), document);
  });
  app.get(`${AREA_PREFIX}/:area/assets/*`, (c) => {
    const asset = areaPathOf(c.req.path, c.req.param("area"), "assets");
    return asset === undefined
      ? notFoundResponse()
      : localImageResponse(
          c.var.workspaceStore,
          c.req.param("area"),
          asset,
          c.req.header("if-none-match"),
        );
  });

  // Projects
  const projects = (c: WebContext, area?: string) => {
    const query = parseProjectsQuery(c.req.query());
    return render(
      c,
      loadProjectsView({
        ...workspace(c),
        ...(area ? { area } : {}),
        ...(query.repository ? { repository: query.repository } : {}),
        ...(query.includeClosed ? { includeClosed: true } : {}),
      }),
    );
  };
  app.get("/projects", (c) => redirectToDefaultArea(c, routes.projects));
  app.get(`${AREA_PREFIX}/:area/projects`, (c) =>
    projects(c, c.req.param("area")),
  );
  app.get(`${AREA_PREFIX}/:area/projects/:project`, (c) => {
    return render(
      c,
      loadProjectView({
        ...workspace(c),
        area: c.req.param("area"),
        project: c.req.param("project"),
      }),
    );
  });
  // Search
  const search = (c: WebContext, area?: string) => {
    const query = parseSearchQuery(c.req.query());
    return render(
      c,
      loadSearchView({
        ...workspace(c),
        ...(area ? { area } : {}),
        ...(query.document ? { document: query.document } : {}),
        ...(query.documentArea ? { documentArea: query.documentArea } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.sort ? { sort: query.sort } : {}),
        ...(query.query ? { query: query.query } : {}),
      }),
    );
  };
  app.get("/search", (c) => redirectToDefaultArea(c, routes.search));
  app.get(`${AREA_PREFIX}/:area/search`, (c) => search(c, c.req.param("area")));

  return app;
}

/**
 * The document path is whatever follows `/area/<area>/resources/`. A path we
 * cannot decode is a path we do not have, so it reads as missing rather than
 * as a fault of ours.
 */
function areaPathOf(
  requestPath: string,
  area: string,
  kind: "resources" | "assets",
): string | undefined {
  const prefix = `${AREA_PREFIX}/${encodeURIComponent(area)}/${kind}/`;
  try {
    return decodeURIComponent(requestPath.slice(prefix.length));
  } catch {
    return undefined;
  }
}

export function createWebRequestHandler(
  input: Omit<WebServerInput, "port">,
): WebRequestHandler {
  const app = createWebApp(input);
  return async (request) => app.fetch(request);
}

export async function startWebServer(
  input: WebServerInput,
  startServer: WebServerFactory = (options) => Bun.serve(options),
  probeServer: WebServerProbe = probeDokitoWeb,
): Promise<WebServerResult> {
  const ports = candidateWebServerPorts(input.port);
  const instanceId = webInstanceId(input.configPath);
  const fetch = createWebRequestHandler({
    configPath: input.configPath,
    ...(input.runtimeId ? { runtimeId: input.runtimeId } : {}),
    ...(input.workspaceStore ? { workspaceStore: input.workspaceStore } : {}),
  });

  let lastError: unknown;
  const attemptedPorts: number[] = [];
  for (const port of ports) {
    if (
      input.runtimeId === undefined &&
      (await probeServer(WEB_HOSTNAME, port, instanceId))
    ) {
      return {
        hostname: WEB_HOSTNAME,
        port,
        url: new URL(`http://${WEB_HOSTNAME}:${port}/`),
        reused: true,
      };
    }

    attemptedPorts.push(port);
    try {
      const server = startServer({
        hostname: WEB_HOSTNAME,
        port,
        reusePort: false,
        development: false,
        fetch,
      });
      return {
        hostname: server.hostname ?? WEB_HOSTNAME,
        port: server.port ?? port,
        url: server.url,
        reused: false,
        server,
      };
    } catch (error) {
      lastError = error;
      if (errorCode(error) !== "EADDRINUSE") {
        throw normalizeWebServerStartError(error, attemptedPorts);
      }
    }
  }

  throw normalizeWebServerStartError(lastError, attemptedPorts);
}
