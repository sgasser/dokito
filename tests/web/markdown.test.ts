import { afterEach, describe, expect, test } from "bun:test";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { documentBody } from "../../src/core/markdown";
import { MarkdownContent } from "../../src/web/markdown";
import { createWebRequestHandler } from "../../src/web/server";
import {
  createTestWorkspace,
  registerTestArea,
  type TestWorkspace,
} from "../helpers";

/**
 * The reader renders whatever an Area contains. This walks one document holding
 * every construct Dokito supports, so a styling change that quietly drops one
 * of them fails here rather than in someone's workspace.
 */
describe("Rendered Markdown", () => {
  let workspace: TestWorkspace | undefined;
  let request: ReturnType<typeof createWebRequestHandler> | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
  });

  async function render(): Promise<string> {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    request = createWebRequestHandler({
      configPath: workspace.configPath,
    });
    const response = await request(
      new Request(
        "http://127.0.0.1/area/product/resources/resources/markdown.md",
      ),
    );
    expect(response.status).toBe(200);
    return response.text();
  }

  test("renders every block construct", async () => {
    const html = await render();

    expect(html).toContain("<table>");
    expect(html).toContain("<thead>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("<pre>");
    expect(html).toContain("<hr");
    expect(html).toContain('class="contains-task-list"');
    expect(html).toContain('class="footnotes"');
    expect(html).toContain("<ol>");
    expect(html).toContain("<ul>");
  });

  test("keeps inline marks inside their sentence", async () => {
    const html = await render();

    expect(html).toContain("<code>inline-code</code>");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
    expect(html).toContain("<del>struck</del>");
  });

  test("keeps links whose target needs escaping or another scheme", async () => {
    const html = await render();
    const article = html.slice(
      html.indexOf("<article"),
      html.indexOf("</article>"),
    );

    expect(article).toContain(
      '<a data-document-link="" href="/area/product/resources/resources/my%20notes.md">Space</a>',
    );
    expect(article).not.toContain("[Space](my notes.md)");
    expect(article).toContain("data-document-link");
    expect(article).toContain('href="mailto:hi@example.invalid"');
    expect(article).toContain('href="#table"');
    expect(html).toContain(">My notes</span>");
  });

  test("refuses a script URL", async () => {
    const html = await render();

    expect(html).not.toContain("javascript:");
  });

  test("leaves wiki syntax inside code alone", async () => {
    const html = await render();

    expect(html).toContain("<code>[[Security]]</code>");
  });

  test("honours a column that declared its alignment", async () => {
    const html = await render();

    expect(html).toContain('<th style="text-align:right">Owner</th>');
  });

  test("keeps a code block's own line breaks", async () => {
    const html = await render();
    const block = /<pre><code[^>]*>([\s\S]*?)<\/code><\/pre>/.exec(html)?.[1];

    expect(block).toBeDefined();
    expect(block?.trim().split("\n")).toHaveLength(2);
  });

  /**
   * `project:` and `task:` read as unknown URL schemes, and react-markdown
   * empties those hrefs before the link component runs. The wiki form never
   * went through that path, so only the Markdown form silently lost its link.
   */
  test("resolves a reference written in Markdown syntax", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        content: [
          "[Wiki](task:01K1ABCXYZ0000000000000000) and",
          "[[task:01K1ABCXYZ0000000000000000|Bracket]] and",
          "[Project](project:launch).",
        ].join(" "),
        resolveDocumentHref: (target: string) =>
          `/area/product/resources/${target}`,
      }),
    );
    const href = (target: string) =>
      `<a data-document-link="" href="/area/product/resources/${target}">`;

    expect(html).toContain(
      `${href("task:01K1ABCXYZ0000000000000000")}Wiki</a>`,
    );
    expect(html).toContain(
      `${href("task:01K1ABCXYZ0000000000000000")}Bracket</a>`,
    );
    expect(html).toContain(`${href("project:launch")}Project</a>`);
  });

  /**
   * A Repository has no page to open, and plain text would read exactly like a
   * link that failed to resolve.
   */
  test("sets a Repository reference as code in both syntaxes", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        content: "[[repo:web-app/docs/SPEC.md]] and [Spec](repo:web-app).",
        resolveDocumentHref: () => undefined,
      }),
    );

    expect(html).toContain("<code>repo:web-app/docs/SPEC.md</code>");
    expect(html).toContain("<code>Spec</code>");
  });

  test("skips only top-level summary paragraphs in Project details", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        content: [
          "> A constraint that belongs in the detail.",
          "",
          "Outcome already shown above.",
          "",
          "The rest of the Project.",
        ].join("\n"),
        skipParagraphs: 1,
      }),
    );

    expect(html).toContain("<blockquote>");
    expect(html).toContain("A constraint that belongs in the detail.");
    expect(html).not.toContain("Outcome already shown above.");
    expect(html).toContain("The rest of the Project.");
  });

  /**
   * Callers hand over a body that already went through `documentBody`. Stripping
   * frontmatter a second time read a leading thematic break as the opening
   * fence and deleted the prose up to the next one.
   */
  test("keeps a thematic break and the prose that follows it", () => {
    const html = renderToStaticMarkup(
      createElement(MarkdownContent, {
        content: documentBody(
          [
            "---",
            "state: active",
            "---",
            "",
            "# House rules",
            "",
            "---",
            "",
            "Intro paragraph that must survive.",
            "",
            "---",
            "",
            "Rest of the document.",
          ].join("\n"),
        ),
      }),
    );

    expect(html).toContain("Intro paragraph that must survive.");
    expect(html).toContain("Rest of the document.");
    expect(html).not.toContain("state: active");
  });
});

/**
 * The explorer lists the Area file and its Resources. Projects and Tasks have
 * screens of their own, but their files are still documents: a link into one
 * has to open it, so only the listing is narrowed, never the store.
 */
describe("Explorer contents", () => {
  let workspace: TestWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
  });

  async function open(url: string): Promise<Response> {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    const request = createWebRequestHandler({
      configPath: workspace.configPath,
    });
    return request(new Request(`http://127.0.0.1${url}`));
  }

  test("leads with the Area file and heads the rest with one label", async () => {
    const html = await (await open("/area/product")).text();
    // A heading over a group of exactly one says nothing, and the Area file is
    // the scope itself rather than one entry among several.
    const headings = [
      ...html.matchAll(
        /<p class="px-2 pb-1 text-ui-xs font-semibold[^"]*">([^<]+)<\/p>/g,
      ),
    ].map((match) => match[1]);

    expect(headings).toEqual(["Resources"]);
    expect(html).toContain("/area/product/resources/context.md");
  });

  test("still opens a Project file asked for by name", async () => {
    const response = await open("/area/product/resources/projects/launch.md");

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Launch the product");
  });

  test("holds archived Resources back until they are asked for", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    await writeFile(
      path.join(workspace.areaRoot, "resources", "pricing.md"),
      "---\nstate: archived\n---\n\n# Pricing thinking\n\nNothing decided.\n",
      "utf8",
    );
    const request = createWebRequestHandler({
      configPath: workspace.configPath,
    });
    const hidden = await (
      await request(new Request("http://127.0.0.1/area/product"))
    ).text();
    const revealed = await (
      await request(new Request("http://127.0.0.1/area/product?archived=1"))
    ).text();

    expect(hidden).not.toContain(">pricing</span>");
    // The header says how many are held back rather than hiding them outright.
    expect(hidden).toContain(">Current<");
    expect(hidden).toContain("Include archived");
    expect(revealed).toContain(">pricing</span>");
    // A revealed row is marked, not merely dimmed.
    expect(revealed).toContain(">Archived</span>");
  });

  test("reveals an archived Resource reached through a document link", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });
    await Promise.all([
      writeFile(
        path.join(workspace.areaRoot, "context.md"),
        "# Product\n\n[Pricing](resources/pricing.md)\n",
        "utf8",
      ),
      writeFile(
        path.join(workspace.areaRoot, "resources", "pricing.md"),
        "---\nstate: archived\n---\n\n# Pricing thinking\n",
        "utf8",
      ),
    ]);
    const request = createWebRequestHandler({
      configPath: workspace.configPath,
    });
    const html = await (
      await request(
        new Request("http://127.0.0.1/area/product/resources/context.md"),
      )
    ).text();
    const direct = await (
      await request(
        new Request(
          "http://127.0.0.1/area/product/resources/resources/pricing.md",
        ),
      )
    ).text();

    expect(html).toContain(
      'href="/area/product/resources/resources/pricing.md?archived=1"',
    );
    // The Related entry says why following it will widen the state filter.
    expect(html).toMatch(
      /Related[\s\S]*Pricing thinking[\s\S]*>Archived<\/span>/,
    );
    // A copied deep link without a query still reveals what it names.
    expect(direct).toContain('aria-label="State: All states"');
    expect(direct).toContain(
      'href="/area/product/resources/resources/pricing.md?archived=1"',
    );
  });
});
