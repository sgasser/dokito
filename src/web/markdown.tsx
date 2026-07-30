import path from "node:path";
import type { Root, RootContent } from "mdast";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { rawMarkdownLinks } from "../core/links";
import { AREA_PREFIX, routes } from "./routes";

interface MarkdownContentProps {
  className?: string;
  /** A body from `documentBody`: frontmatter and the leading H1 already gone. */
  content: string;
  resolveDocumentHref?: (target: string) => string | undefined;
  resolveImageSrc?: (target: string) => string | undefined;
  /** Project detail already presents its leading summary paragraphs. */
  skipParagraphs?: number;
}

/** Schemes a document may link to. Everything else is read as a path. */
const LINK_SCHEME = /^(?:https?|mailto|tel):/i;
const DOCUMENT_PATH = new RegExp(`^${AREA_PREFIX}/[^/]+/resources(?:/|$)`);

/**
 * Splits one run of text on `[[wiki links]]`. Working on the parsed tree
 * rather than the source is what keeps a code block verbatim: `code` and
 * `inlineCode` are their own node types and never reach this.
 */
function splitWikiLinks(
  value: string,
  resolve?: (target: string) => string | undefined,
): RootContent[] {
  const nodes: RootContent[] = [];
  const pattern = /\[\[([^\]\n]+)\]\]/g;
  let last = 0;

  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    const [whole, inner = ""] = match;
    const [rawTarget, rawLabel] = inner.split("|", 2);
    const target = rawTarget?.trim();
    const label = rawLabel?.trim() || target || whole;
    const href = target ? resolve?.(target) : undefined;

    if (match.index > last) {
      nodes.push({ type: "text", value: value.slice(last, match.index) });
    }
    nodes.push(
      href
        ? {
            type: "link",
            url: href,
            children: [{ type: "text", value: label }],
          }
        : { type: "text", value: label },
    );
    last = match.index + whole.length;
  }

  if (nodes.length === 0) {
    return [];
  }
  if (last < value.length) {
    nodes.push({ type: "text", value: value.slice(last) });
  }
  return nodes;
}

function splitRawLinks(
  value: string,
  resolve?: (target: string) => string | undefined,
): RootContent[] {
  if (!resolve) {
    return [];
  }

  const nodes: RootContent[] = [];
  let last = 0;
  for (const link of rawMarkdownLinks(value)) {
    const href = resolve(link.target);
    if (!href) {
      continue;
    }
    if (link.start > last) {
      nodes.push({ type: "text", value: value.slice(last, link.start) });
    }
    nodes.push({
      type: "link",
      url: href,
      children: [{ type: "text", value: link.label }],
    });
    last = link.end;
  }

  if (nodes.length === 0) {
    return [];
  }
  if (last < value.length) {
    nodes.push({ type: "text", value: value.slice(last) });
  }
  return nodes;
}

function remarkWikiLinks(resolve?: (target: string) => string | undefined) {
  const rewrite = (node: { children?: RootContent[] }): void => {
    if (!node.children) {
      return;
    }
    node.children = node.children.flatMap((child) => {
      if (child.type === "text") {
        const raw = splitRawLinks(child.value, resolve);
        return (raw.length > 0 ? raw : [child]).flatMap((part) => {
          if (part.type !== "text") {
            return [part];
          }
          const wiki = splitWikiLinks(part.value, resolve);
          return wiki.length > 0 ? wiki : [part];
        });
      }
      // Link labels may contain text but cannot contain another link.
      if (child.type === "link" || child.type === "linkReference") {
        return [child];
      }
      rewrite(child as { children?: RootContent[] });
      return [child];
    });
  };
  return () => (tree: Root) => {
    rewrite(tree);
  };
}

function remarkSkipParagraphs(count: number) {
  return () => (tree: Root) => {
    let remaining = count;
    if (remaining <= 0) {
      return;
    }
    tree.children = tree.children.filter((child) => {
      if (remaining > 0 && child.type === "paragraph") {
        remaining -= 1;
        return false;
      }
      return true;
    });
  };
}

/**
 * A target written for a human reads `resources/my notes.md`; by the time it
 * reaches here the parser has escaped it. Both spellings name the same file.
 */
function documentTarget(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

/** Resolve an image beside any Area Markdown without letting it leave the Area. */
export function markdownImageHref(
  areaId: string,
  relativePath: string,
  target: string,
): string | undefined {
  if (target.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(target)) {
    return undefined;
  }
  const assetPath = path.posix.normalize(
    path.posix.join(path.posix.dirname(relativePath), target),
  );
  return assetPath === ".." || assetPath.startsWith("../")
    ? undefined
    : routes.asset(areaId, assetPath);
}

export function MarkdownContent({
  className,
  content,
  resolveDocumentHref,
  resolveImageSrc,
  skipParagraphs = 0,
}: MarkdownContentProps) {
  const components: Components = {
    a({ children, href }) {
      if (!href) {
        return <>{children}</>;
      }

      // An address that already names where it goes — another site, an inbox,
      // a heading on this page, a workspace route — is left as written.
      if (
        LINK_SCHEME.test(href) ||
        href.startsWith("#") ||
        href.startsWith(`${AREA_PREFIX}/`)
      ) {
        const external = /^https?:\/\//i.test(href);
        return (
          <a
            {...(DOCUMENT_PATH.test(href) ? { "data-document-link": "" } : {})}
            href={href}
            {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
          >
            {children}
          </a>
        );
      }

      const resolved = resolveDocumentHref?.(documentTarget(href));
      return resolved ? (
        <a data-document-link="" href={resolved}>
          {children}
        </a>
      ) : (
        children
      );
    },
    img({ alt, src }) {
      const resolved = src ? resolveImageSrc?.(documentTarget(src)) : undefined;
      return resolved ? <img alt={alt ?? ""} src={resolved} /> : null;
    },
  };

  return (
    <div
      className={["prose max-w-[72ch]", className].filter(Boolean).join(" ")}
    >
      <ReactMarkdown
        components={components}
        remarkPlugins={[
          remarkGfm,
          remarkWikiLinks(resolveDocumentHref),
          remarkSkipParagraphs(skipParagraphs),
        ]}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
