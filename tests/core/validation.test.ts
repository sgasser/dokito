import { describe, expect, test } from "bun:test";
import { parseConfig } from "../../src/core/config";
import { DokitoError } from "../../src/core/error";
import { parseAreaManifest } from "../../src/core/manifests";

describe("manifest validation", () => {
  test("rejects unknown fields", () => {
    expect(() =>
      parseAreaManifest(
        {
          version: 1,
          id: "product",
          name: "Product",
          repositories: {},
          hidden: true,
        },
        "dokito.yaml",
      ),
    ).toThrow(DokitoError);
  });

  /**
   * Apps were removed rather than left as an ignored field: a manifest that
   * still declares one should say so instead of silently doing nothing.
   */
  test("rejects a manifest that still declares apps", () => {
    expect(() =>
      parseAreaManifest(
        {
          version: 1,
          id: "product",
          name: "Product",
          repositories: {},
          apps: {
            tool: {
              path: "app",
              command: "bun run dev",
              url: "http://127.0.0.1:4177",
            },
          },
        },
        "dokito.yaml",
      ),
    ).toThrow(DokitoError);
  });

  test("rejects relative local config paths", () => {
    expect(() =>
      parseConfig(
        {
          areas: {
            product: {
              path: "./product-area",
              repositories: {},
            },
          },
        },
        "config.yaml",
      ),
    ).toThrow(DokitoError);
  });

  test("rejects pre-release local config shapes", () => {
    expect(() =>
      parseConfig(
        {
          areas: {
            product: "/workspace/product-area",
          },
          repository_links: {
            "/workspace/web-app": {
              area: "product",
              repository: "web-app",
            },
          },
        },
        "config.yaml",
      ),
    ).toThrow(DokitoError);
  });

  test("accepts relative local Repository paths", () => {
    expect(
      parseConfig(
        {
          areas: {
            product: {
              path: "/workspace/product-area",
              repositories: {
                "web-app": {
                  path: "../web-app",
                },
              },
            },
          },
        },
        "config.yaml",
      ),
    ).toEqual({
      areas: {
        product: {
          path: "/workspace/product-area",
          repositories: {
            "web-app": {
              path: "../web-app",
            },
          },
        },
      },
    });
  });

  test("rejects absolute local Repository paths", () => {
    expect(() =>
      parseConfig(
        {
          areas: {
            product: {
              path: "/workspace/product-area",
              repositories: {
                "web-app": {
                  path: "/workspace/web-app",
                },
              },
            },
          },
        },
        "config.yaml",
      ),
    ).toThrow(DokitoError);
  });
});
