import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { registerArea } from "../../src/core/config";
import { startWebServer } from "../../src/web/server";
import { createTestWorkspace } from "../helpers";

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1) {
  throw new Error("The browser test server needs a valid port.");
}

const workspace = await createTestWorkspace();
const projectPath = path.join(workspace.areaRoot, "projects", "launch.md");
await writeFile(
  projectPath,
  `${await readFile(projectPath, "utf8")}

## Definition of done

- The Web app is available.
- The privacy notice is reviewed.
- The release guide is published.

## Decisions

The release waits for the verified build.
`,
  "utf8",
);
await writeFile(
  path.join(
    workspace.areaRoot,
    "tasks",
    "01K1ABEXYZ0000000000000000-publish-the-release-guide.md",
  ),
  `---
status: done
project: launch
---

# Publish the release guide

Published with the release notes.
`,
  "utf8",
);
await Promise.all([
  mkdir(path.join(workspace.areaRoot, "resources", "guides"), {
    recursive: true,
  }),
  writeFile(
    path.join(workspace.areaRoot, "resources", "日本語ノート.md"),
    `# 日本語ノート

[Security](security.md)
[Pricing](pricing.md)
`,
    "utf8",
  ),
  writeFile(
    path.join(workspace.areaRoot, "resources", "pricing.md"),
    `---
state: archived
---

# Pricing
`,
    "utf8",
  ),
]);
await writeFile(
  path.join(workspace.areaRoot, "resources", "guides", "setup.md"),
  `# Setup

[Architecture](architecture)
`,
  "utf8",
);
await registerArea(workspace.configPath, "product", workspace.areaRoot);

const result = await startWebServer({
  configPath: workspace.configPath,
  port,
});

if (!result.server) {
  await workspace.cleanup();
  throw new Error(
    "The browser test server unexpectedly reused another server.",
  );
}

await new Promise<void>((resolve) => {
  process.once("SIGINT", resolve);
  process.once("SIGTERM", resolve);
});

result.server.stop(true);
await workspace.cleanup();
