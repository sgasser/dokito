import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  resourceExplorerLabel,
  resourceExplorerTree,
} from "../../src/web/kinds";
import { createWebRequestHandler } from "../../src/web/server";
import {
  createTestWorkspace,
  registerTestArea,
  type TestWorkspace,
} from "../helpers";

describe("Resource explorer folders", () => {
  let workspace: TestWorkspace | undefined;

  afterEach(async () => {
    await workspace?.cleanup();
  });

  test("uses extensionless filenames and sorts by the visible label", () => {
    expect(resourceExplorerLabel("resources/source-material/my notes.md")).toBe(
      "my notes",
    );

    const nodes = resourceExplorerTree([
      {
        kind: "resource" as const,
        relativePath: "resources/zulu.md",
        title: "First by title",
      },
      {
        kind: "resource" as const,
        relativePath: "resources/alpha.md",
        title: "Last by title",
      },
    ]);

    expect(
      nodes.map((node) =>
        node.type === "document" ? node.document.relativePath : node.name,
      ),
    ).toEqual(["resources/alpha.md", "resources/zulu.md"]);
  });

  test("builds shared directories from the document paths", () => {
    const nodes = resourceExplorerTree([
      {
        kind: "resource" as const,
        relativePath: "resources/overview.md",
        title: "Overview",
      },
      {
        kind: "resource" as const,
        relativePath: "resources/source-material/archive/notes.md",
        title: "Archived notes",
      },
      {
        kind: "resource" as const,
        relativePath: "resources/source-material/current.md",
        title: "Current notes",
      },
      {
        kind: "area" as const,
        relativePath: "context.md",
        title: "Product",
      },
    ]);

    expect(nodes).toEqual([
      {
        type: "directory",
        name: "source-material",
        relativePath: "resources/source-material",
        documentCount: 2,
        children: [
          {
            type: "directory",
            name: "archive",
            relativePath: "resources/source-material/archive",
            documentCount: 1,
            children: [
              {
                type: "document",
                document: {
                  kind: "resource",
                  relativePath: "resources/source-material/archive/notes.md",
                  title: "Archived notes",
                },
              },
            ],
          },
          {
            type: "document",
            document: {
              kind: "resource",
              relativePath: "resources/source-material/current.md",
              title: "Current notes",
            },
          },
        ],
      },
      {
        type: "document",
        document: {
          kind: "resource",
          relativePath: "resources/overview.md",
          title: "Overview",
        },
      },
    ]);
  });

  test("renders nested directories without a second directory data source", async () => {
    workspace = await createTestWorkspace();
    await registerTestArea({
      cwd: workspace.root,
      target: workspace.areaRoot,
      id: "product",
      name: "Product",
      configPath: workspace.configPath,
    });

    const sourceMaterial = path.join(
      workspace.areaRoot,
      "resources",
      "source-material",
    );
    await mkdir(path.join(sourceMaterial, "archive"), { recursive: true });
    await mkdir(path.join(sourceMaterial, "empty"), { recursive: true });
    await writeFile(
      path.join(sourceMaterial, "archive", "notes.md"),
      "# Archived notes\n",
      "utf8",
    );

    const request = createWebRequestHandler({
      configPath: workspace.configPath,
    });
    const html = await (
      await request(new Request("http://127.0.0.1/area/product"))
    ).text();
    const selectedHtml = await (
      await request(
        new Request(
          "http://127.0.0.1/area/product/resources/resources/source-material/archive/notes.md",
        ),
      )
    ).text();
    const directoryTag = (markup: string, directory: string): string => {
      const directoryIndex = markup.indexOf(
        `data-resource-directory="${directory}"`,
      );
      return markup.slice(
        markup.lastIndexOf("<details", directoryIndex),
        markup.indexOf(">", directoryIndex) + 1,
      );
    };

    const sourceIndex = html.indexOf(
      'data-resource-directory="resources/source-material"',
    );
    const archiveIndex = html.indexOf(
      'data-resource-directory="resources/source-material/archive"',
    );
    const notesIndex = html.indexOf(">notes</span>");

    expect(sourceIndex).toBeGreaterThan(-1);
    expect(archiveIndex).toBeGreaterThan(sourceIndex);
    expect(notesIndex).toBeGreaterThan(archiveIndex);
    expect(html).not.toContain(">Archived notes</span>");
    expect(directoryTag(html, "resources/source-material")).not.toContain(
      ' open=""',
    );
    for (const directory of [
      "resources/source-material",
      "resources/source-material/archive",
    ]) {
      expect(directoryTag(selectedHtml, directory)).toContain(' open=""');
    }
    expect(html).not.toContain(
      'data-resource-directory="resources/source-material/empty"',
    );
  });
});
