import { expect, test } from "@playwright/test";

test("resource navigation preserves the shell, explorer, and browser history", async ({
  page,
}) => {
  await page.goto("/area/product");
  await expect
    .poll(() => page.evaluate(() => "navigation" in window))
    .toBe(true);
  const rail = page.getByRole("navigation", { name: "Dokito navigation" });
  const explorer = page.locator("[data-resources-explorer]");
  await rail.evaluate((node) => {
    node.setAttribute("data-runtime-state", "preserved");
  });
  await explorer.evaluate((node) => {
    Reflect.set(node, "dokitoPersistent", true);
  });

  await page
    .locator('a[data-document-link][href$="/resources/architecture.md"]')
    .first()
    .click();
  await expect(page).toHaveURL(
    /\/area\/product\/resources\/resources\/architecture\.md$/,
  );
  const title = page.locator("[data-document-title]");
  await expect(title).toHaveText("architecture");
  await expect(rail).toHaveAttribute("data-runtime-state", "preserved");
  expect(
    await explorer.evaluate((node) => Reflect.get(node, "dokitoPersistent")),
  ).toBe(true);
  await expect(
    page.getByRole("button", { name: "Document actions" }),
  ).toBeVisible();
  await expect(
    page
      .locator('a[data-document-link][href$="/resources/architecture.md"]')
      .first(),
  ).toHaveAttribute("aria-current", "page");

  await page.goBack();

  await expect(page).toHaveURL(/\/area\/product$/);
  await expect(page.locator("[data-document-detail]")).toHaveAttribute(
    "data-document-requested",
    "false",
  );
  await expect(rail).toHaveAttribute("data-runtime-state", "preserved");
  expect(
    await explorer.evaluate((node) => Reflect.get(node, "dokitoPersistent")),
  ).toBe(true);
  await expect(page.locator("[data-document-title]")).toHaveText("Product");
  await expect(
    page
      .locator('a[data-document-link][href$="/resources/architecture.md"]')
      .first(),
  ).not.toHaveAttribute("aria-current", "page");
});

test("resource navigation still works without client-side JavaScript", async ({
  browser,
  baseURL,
}) => {
  if (!baseURL) {
    throw new Error("The browser test needs its configured base URL.");
  }
  const context = await browser.newContext({
    baseURL,
    javaScriptEnabled: false,
  });
  const page = await context.newPage();
  await page.goto("/area/product");

  await page
    .locator('a[data-document-link][href$="/resources/architecture.md"]')
    .first()
    .click();

  await expect(page).toHaveURL(
    /\/area\/product\/resources\/resources\/architecture\.md$/,
  );
  await expect(page.locator("[data-document-title]")).toHaveText(
    "architecture",
  );
  await context.close();
});

test("top-level navigation preserves the Dokito shell", async ({ page }) => {
  await page.goto("/area/product");

  const rail = page.getByRole("navigation", { name: "Dokito navigation" });
  await rail.evaluate((node) => {
    node.setAttribute("data-runtime-state", "preserved");
  });
  await page.getByRole("link", { name: "Tasks", exact: true }).click();

  await expect(page).toHaveURL(/\/area\/product\/tasks$/);
  await expect(page).toHaveTitle("Dokito — Tasks");
  await expect(rail).toHaveAttribute("data-runtime-state", "preserved");
  await expect(
    page.getByRole("link", { name: "Tasks", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("link", { name: "Resources", exact: true }),
  ).not.toHaveAttribute("aria-current", "page");
  await expect
    .poll(() =>
      page.evaluate(() => performance.getEntriesByType("navigation").length),
    )
    .toBe(1);
});

test("phone navigation resets and restores the page scroll", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 500 });
  await page.goto("/area/product");
  await expect
    .poll(() =>
      page.evaluate(() => document.documentElement.scrollHeight > innerHeight),
    )
    .toBe(true);
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  const resourceScroll = await page.evaluate(() => window.scrollY);
  expect(resourceScroll).toBeGreaterThan(0);

  await page.getByRole("link", { name: "Tasks", exact: true }).click();

  await expect(page.locator("[data-tasks-view]")).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);

  await page.goBack();

  await expect(page.locator("[data-document-title]")).toHaveText("Product");
  await expect
    .poll(() => page.evaluate(() => window.scrollY))
    .toBe(resourceScroll);
});

test("a failed enhancement falls back to the complete page", async ({
  page,
}) => {
  let fragmentRequests = 0;
  let pageRequests = 0;
  await page.route("**/area/product/tasks", async (route) => {
    if (route.request().headers()["x-dokito-navigation"] === "1") {
      fragmentRequests += 1;
      await route.fulfill({
        body: "Navigation unavailable",
        contentType: "text/plain",
        status: 503,
      });
      return;
    }
    pageRequests += 1;
    await route.continue();
  });
  await page.goto("/area/product");

  await page.getByRole("link", { name: "Tasks", exact: true }).click();

  await expect(page).toHaveURL(/\/area\/product\/tasks$/);
  await expect(page).toHaveTitle("Dokito — Tasks");
  await expect(page.locator("[data-tasks-view]")).toBeVisible();
  expect(fragmentRequests).toBe(1);
  expect(pageRequests).toBe(1);
});

test("task detail navigation preserves the list and restores its row", async ({
  page,
}) => {
  await page.goto("/area/product/tasks");

  const list = page.locator("[data-work-list]");
  const row = page.locator("[data-work-row]").first();
  const item = await row.getAttribute("data-work-item");
  await list.evaluate((node) => {
    Reflect.set(node, "dokitoPersistent", true);
  });
  await row.click();

  await expect(page).toHaveURL(/\/area\/product\/tasks\/[^?]+$/);
  await expect(page.locator("[data-work-detail] aside")).toBeVisible();
  expect(
    await list.evaluate((node) => Reflect.get(node, "dokitoPersistent")),
  ).toBe(true);
  await expect(page.locator("[data-navigation-focus]")).toBeFocused();
  await expect(
    page.locator(`[data-work-row][data-work-item="${item}"]`),
  ).toHaveAttribute("aria-current", "page");
  const enlarge = page.getByRole("button", { name: "Enlarge Task" });
  await expect(enlarge).toBeVisible();
  await enlarge.click();
  await expect(
    page.getByRole("dialog", { name: /Coordinate the product launch/ }),
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.goBack();

  await expect(page).toHaveURL(/\/area\/product\/tasks$/);
  await expect(page.locator("[data-work-detail] aside")).toHaveCount(0);
  expect(
    await list.evaluate((node) => Reflect.get(node, "dokitoPersistent")),
  ).toBe(true);
  await expect(
    page.locator(`[data-work-row][data-work-item="${item}"]`),
  ).toBeFocused();
});

test("resource explorer preserves the archived filter for current documents", async ({
  page,
}) => {
  await page.goto("/area/product?archived=1");

  const architecture = page.locator(
    '[data-resources-explorer] a[href="/area/product/resources/resources/architecture.md?archived=1"]',
  );
  await expect(architecture).toHaveCount(1);
  await architecture.click();

  await expect(page).toHaveURL(
    /\/area\/product\/resources\/resources\/architecture\.md\?archived=1$/,
  );
  await expect(
    page.locator(
      `[data-resources-explorer] a[href="/area/product/resources/resources/${encodeURIComponent("日本語ノート.md")}?archived=1"]`,
    ),
  ).toHaveCount(1);
});

test("resource navigation reveals the current document in a collapsed folder", async ({
  page,
}) => {
  await page.goto("/area/product/resources/resources/architecture.md");

  const directory = page.locator(
    'details[data-resource-directory="resources/guides"]',
  );
  await expect(directory).not.toHaveAttribute("open", "");
  await page
    .locator(
      'aside a[data-document-link][href$="/resources/resources/guides/setup.md"]',
    )
    .click();

  await expect(page).toHaveURL(
    /\/area\/product\/resources\/resources\/guides\/setup\.md$/,
  );
  await expect(page.locator("[data-document-title]")).toHaveText("setup");
  await expect(directory).toHaveAttribute("open", "");
  await expect(
    directory.locator(
      'a[data-document-link][href$="/resources/resources/guides/setup.md"]',
    ),
  ).toHaveAttribute("aria-current", "page");
});

test("related reader data is part of each complete page", async ({ page }) => {
  await page.goto("/area/product/resources/resources/markdown.md");
  await expect(page.locator("[data-document-title]")).toHaveText("markdown");
  const related = page.locator("[data-related-rows]");
  await expect(related.getByText("my notes", { exact: true })).toBeVisible();
  await expect(page.locator("[data-derived-skeleton]")).toHaveCount(0);

  await page
    .locator('article a[data-document-link][href$="/resources/security.md"]')
    .click();
  await expect(page.locator("[data-document-title]")).toHaveText("security");
  await expect(
    page.locator("[data-related-rows]").getByText("markdown", { exact: true }),
  ).toBeVisible();

  await page
    .locator('a[data-document-link][href$="/resources/markdown.md"]')
    .first()
    .click();
  await expect(page.locator("[data-document-title]")).toHaveText("markdown");
  await expect(
    page.locator("[data-related-rows]").getByText("my notes", { exact: true }),
  ).toBeVisible();
});

test("Related handles Unicode paths and preserves the archived filter", async ({
  page,
}) => {
  await page.goto(
    `/area/product/resources/resources/${encodeURIComponent("日本語ノート.md")}?archived=1`,
  );

  await expect(page.locator("[data-document-title]")).toHaveText(
    "日本語ノート",
  );
  const security = page
    .locator('a[data-document-link][href$="/resources/security.md?archived=1"]')
    .last();
  await expect(security).toBeVisible();

  await security.click();

  await expect(page).toHaveURL(
    /\/area\/product\/resources\/resources\/security\.md\?archived=1$/,
  );
  await expect(page.locator("[data-document-title]")).toHaveText("security");
});

test("project details render with the complete page", async ({ page }) => {
  await page.goto("/area/product/projects/launch");

  await expect(page.getByText(/^Open Tasks/)).toBeVisible();
  await expect(
    page.locator("#main-content").getByText("Resources", { exact: true }),
  ).toBeAttached();
  await expect(page.locator("[data-derived-skeleton]")).toHaveCount(0);
});

test("root search supports keyboard use and restores focus", async ({
  page,
}) => {
  await page.goto("/area/product");

  const search = page.getByRole("link", { name: "Search or command" });
  await search.focus();
  await page.keyboard.press("Control+k");

  const dialog = page.getByRole("dialog", { name: "Search all Areas" });
  const input = page.locator("[data-palette-input]");
  await expect(dialog).toBeVisible();
  await expect(input).toBeFocused();
  await expect(input).toHaveAttribute("aria-expanded", "true");
  // Nothing typed still lists the destinations, so the overlay is never blank.
  await expect(
    page.getByRole("option", { name: /^Go to Resources\b.*Command$/ }),
  ).toBeVisible();

  await page.keyboard.press("Escape");

  await expect(dialog).not.toBeVisible();
  await expect(input).toHaveAttribute("aria-expanded", "false");
  await expect(search).toBeFocused();
});

test("palette navigation leaves focus on the new view", async ({ page }) => {
  await page.goto("/area/product");

  await page.getByRole("link", { name: "Search or command" }).click();
  await page.getByRole("option", { name: /^Go to Tasks\b.*Command$/ }).click();

  await expect(page).toHaveURL(/\/area\/product\/tasks$/);
  const heading = page.locator("[data-tasks-view] h1");
  await expect(heading).toHaveText("Tasks");
  await expect(heading).toBeFocused();
});

test("root search ranks a command and a document in one list", async ({
  page,
}) => {
  await page.goto("/area/product");
  await page.keyboard.press("Control+k");

  const options = page.getByRole("option");
  const input = page.locator("[data-palette-input]");

  // The alias wins outright: two letters aimed at one destination.
  await input.fill("gt");
  await expect(options.first()).toHaveAttribute("aria-selected", "true");
  await expect(options.first()).toContainText("Go to Tasks");

  // A word that only content carries reaches content, with the kind stated on
  // the row rather than as a heading above a group of them.
  await input.fill("architecture");
  await expect(options.first()).toContainText("architecture");
  await expect(options.first()).toContainText("Resource");

  // The query is never a dead end.
  const fallback = options.last();
  await expect(fallback).toContainText("Search every Area for");

  await fallback.click();
  await expect(page).toHaveURL(/\/search\?q=architecture$/);
});

test("root search says so when search could not be loaded", async ({
  page,
}) => {
  await page.route("**/index.json*", (route) => route.abort());
  await page.goto("/area/product");
  await page.keyboard.press("Control+k");

  // The commands come from the page, so they are listed whatever the index
  // did. Without a word about the read, their presence would read as an
  // answer: no Tasks, no Resources, nothing wrong.
  const list = page.locator("[data-palette-list]");
  await expect(list).toContainText("Search could not be loaded.");
  await expect(
    page.getByRole("option", { name: /^Go to Tasks/ }),
  ).toBeVisible();

  await page.locator("[data-palette-input]").fill("architecture");
  await expect(list).toContainText("Search could not be loaded.");
  await expect(page.getByRole("option").last()).toContainText(
    "Search every Area for",
  );
});

test("project detail follows the design and expands its Markdown body", async ({
  page,
}) => {
  await page.goto("/area/product/projects/launch");

  await expect(page.getByText("Outcome", { exact: true })).toBeVisible();
  await expect(
    page.getByText("The Web app is available and the release is verified.", {
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(page.getByText("projects/launch.md")).toBeVisible();

  const completed = page.locator("[data-project-tasks-toggle]");
  await expect(completed).toBeVisible();
  await completed.click();
  await expect(completed).toHaveText("Hide completed");
  await expect(
    page.getByRole("link", { name: /Publish the release guide/ }),
  ).toBeVisible();

  const viewport = page.locator("[data-project-body-viewport]");
  const toggle = page.locator("[data-project-body-toggle]");
  await expect(viewport).toHaveAttribute("data-collapsed", "true");
  await expect(toggle).toHaveText("Show all");

  await toggle.click();

  await expect(viewport).toHaveAttribute("data-collapsed", "false");
  await expect(toggle).toHaveText("Collapse");
  await expect(page.getByRole("heading", { name: "Decisions" })).toBeVisible();
});

test("project detail uses the dedicated mobile detail layout", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/area/product/projects/launch");

  await expect(
    page.locator("[data-view='project'] > [data-shell-navigation]"),
  ).toBeHidden();
  await expect(page.locator("[data-project-detail] h1")).toBeVisible();
  await expect(page.locator("[data-project-detail] h1")).toHaveText(
    "Launch the product",
  );
  await expect(page.getByText("Outcome", { exact: true })).toBeHidden();
  await expect(
    page
      .locator("[data-project-mobile-properties]")
      .getByText("Status", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText(
      "Customer documentation must match the implemented behavior.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page
      .locator("[data-project-mobile-properties]")
      .getByText("web-app", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-project-detail] aside")).toBeHidden();
  await expect(page.locator("[data-project-body-toggle]")).toBeHidden();
});

test("project detail keeps its properties before the aside breakpoint", async ({
  page,
}) => {
  await page.setViewportSize({ width: 960, height: 800 });
  await page.goto("/area/product/projects/launch");

  await expect(
    page
      .locator("[data-project-mobile-properties]")
      .getByText("web-app", { exact: true }),
  ).toBeVisible();
  await expect(page.locator("[data-project-detail] aside")).toBeHidden();
});

test("Search opens a preview while preserving the result list", async ({
  page,
}) => {
  let completeSearchRequests = 0;
  let fragmentSearchRequests = 0;
  page.on("request", (request) => {
    if (new URL(request.url()).pathname === "/area/product/search") {
      if (request.headers()["x-dokito-navigation"] === "1") {
        fragmentSearchRequests += 1;
      } else {
        completeSearchRequests += 1;
      }
    }
  });
  await page.goto("/area/product/search?q=architecture");
  expect(completeSearchRequests).toBe(1);
  const hits = page.locator("[data-search-hits]");
  const selected = page.locator(
    'a[data-search-hit-link][href*="doc=resources%2Farchitecture.md"]',
  );
  await hits.evaluate((node) => {
    Reflect.set(node, "dokitoPersistent", true);
  });

  await selected.click();

  await expect(page).toHaveURL(
    /\/area\/product\/search\?.*doc=resources%2Farchitecture\.md/,
  );
  await expect(
    page.locator("[data-search-preview]").getByRole("heading", {
      name: "architecture",
    }),
  ).toBeVisible();
  await expect(page.locator("[data-navigation-focus]")).toBeFocused();
  expect(
    await hits.evaluate((node) => Reflect.get(node, "dokitoPersistent")),
  ).toBe(true);
  expect(completeSearchRequests).toBe(1);
  expect(fragmentSearchRequests).toBe(1);

  await page.goBack();

  await expect(page).toHaveURL(/\/area\/product\/search\?q=architecture$/);
  await expect(page.locator("[data-search-preview]")).toContainText(
    "architecture",
  );
  expect(
    await hits.evaluate((node) => Reflect.get(node, "dokitoPersistent")),
  ).toBe(true);
  await expect(selected).toBeFocused();
});
