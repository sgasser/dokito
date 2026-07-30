import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { validateSlug } from "../../src/core/manifests";
import { AREA_PREFIX, routes, withQuery } from "../../src/web/routes";
import { FILTER, SHELL } from "../../src/web/ui";
import {
  projectsUrl,
  projectUrl,
  resourcesUrl,
  searchUrl,
  tasksUrl,
} from "../../src/web/urls";

/** The same extraction the document route performs. */
function documentPathOf(path: string, area: string): string {
  return decodeURIComponent(
    path.slice(`${AREA_PREFIX}/${area}/resources/`.length),
  );
}

function router() {
  const app = new Hono();
  app.get(`${AREA_PREFIX}/:area/tasks/:task`, (c) =>
    c.json({ area: c.req.param("area"), task: c.req.param("task") }),
  );
  app.get(`${AREA_PREFIX}/:area/projects/:project`, (c) =>
    c.json({ area: c.req.param("area"), project: c.req.param("project") }),
  );
  app.get(`${AREA_PREFIX}/:area/resources/*`, (c) =>
    c.json({
      area: c.req.param("area"),
      document: documentPathOf(c.req.path, c.req.param("area")),
    }),
  );
  return app;
}

async function visit(path: string): Promise<Record<string, string>> {
  const response = await router().fetch(new Request(`http://x${path}`));
  return (await response.json()) as Record<string, string>;
}

describe("Dokito addresses", () => {
  test("puts identity in the path and filters in the query", () => {
    expect(routes.resources("product")).toBe("/area/product");
    expect(routes.resources()).toBe("/");
    expect(routes.tasks("product")).toBe("/area/product/tasks");
    expect(routes.tasks()).toBe("/tasks");
    expect(routes.projects()).toBe("/projects");
    expect(
      withQuery(routes.tasks("product"), {
        status: "all",
        source: undefined,
        q: "",
      }),
    ).toBe("/area/product/tasks?status=all");
  });

  test("leaves slugs alone because a slug cannot need escaping", () => {
    // The premise: anything reaching these builders passed this check.
    expect(validateSlug("product", "Area ID")).toBe("product");
    expect(() => validateSlug("My Area", "Area ID")).toThrow();

    expect(routes.project("product", "launch")).toBe(
      "/area/product/projects/launch",
    );
    expect(routes.document("product", "context.md")).toBe(
      "/area/product/resources/context.md",
    );
  });

  test("carries any filename through the path", async () => {
    const names = [
      "resources/security.md",
      "resources/my notes.md",
      "resources/a & b.md",
      "resources/report-50%20off.md",
      "resources/über-uns.md",
      "resources/a+b.md",
      "resources/100%.md",
      "resources/q?.md",
      "resources/hash#tag.md",
    ];

    for (const name of names) {
      expect(await visit(routes.document("product", name))).toEqual({
        area: "product",
        document: name,
      });
    }
  });

  test("keeps slashes separating and nothing else", () => {
    expect(routes.document("product", "a/b/c.md")).toBe(
      "/area/product/resources/a/b/c.md",
    );
    expect(routes.document("product", "a b/c d.md")).toBe(
      "/area/product/resources/a%20b/c%20d.md",
    );
  });
});

describe("Explicit view addresses", () => {
  test("builds each destination from only the state it owns", () => {
    expect(resourcesUrl({ area: "product" })).toBe("/area/product");
    expect(
      resourcesUrl({
        area: "product",
        document: "resources/notes.md",
        includeArchived: true,
      }),
    ).toBe("/area/product/resources/resources/notes.md?archived=1");
    expect(projectsUrl({ area: "product", repository: "web-app" })).toBe(
      "/area/product/projects?repository=web-app",
    );
    expect(projectUrl({ area: "product", project: "launch" })).toBe(
      "/area/product/projects/launch",
    );
    expect(
      tasksUrl({
        area: "product",
        task: "01K1ABC",
        project: "launch",
        repository: "web-app",
      }),
    ).toBe("/area/product/tasks/01K1ABC?project=launch&repository=web-app");
    expect(searchUrl({ area: "product", query: "zebra" })).toBe(
      "/area/product/search?q=zebra",
    );
  });

  test("omits default and absent filters", () => {
    expect(tasksUrl({ area: "product", status: "open" })).toBe(
      "/area/product/tasks",
    );
    expect(searchUrl({ area: "product", sort: "relevance" })).toBe(
      "/area/product/search",
    );
    expect(projectsUrl({ area: "personal" })).toBe("/area/personal/projects");
  });
});

describe("The rail and the panels that open over it", () => {
  /**
   * A filter panel opens over the view beside the rail, so any overflow on the
   * rail clips it. This caught a regression once; it is cheaper than noticing
   * it twice.
   */
  test("the rail creates no clipping context", () => {
    expect(SHELL.rail).not.toContain("overflow");
  });

  /** The shared shell panels use one width. */
  test("one width for shared panels", () => {
    const width = (classes: string): string | undefined =>
      /w-\[(\d+px)\]/.exec(classes)?.[1];

    expect(width(SHELL.areaPanel)).toBe("216px");
    expect(width(FILTER.panel)).toBe("216px");
  });
});
