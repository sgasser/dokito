import { descendants } from "./dom";

type Mermaid = typeof import("mermaid")["default"];

const MERMAID_MODULE_PATH = "/mermaid.js";
const rendering = new WeakSet<HTMLElement>();
let diagramSequence = 0;
let initialized = false;
let mermaidPromise: Promise<Mermaid> | undefined;

async function loadMermaid(): Promise<Mermaid> {
  mermaidPromise ??= import(MERMAID_MODULE_PATH).then(
    (module) => (module as { default: Mermaid }).default,
  );
  const mermaid = await mermaidPromise;
  if (initialized) {
    return mermaid;
  }
  initialized = true;
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: "strict",
    theme: "neutral",
    themeVariables: {
      fontFamily: "Inter, ui-sans-serif, sans-serif",
      lineColor: "#68717e",
      primaryBorderColor: "#c7cff7",
      primaryColor: "#eef1ff",
      primaryTextColor: "#1d2025",
      secondaryColor: "#f1f3f6",
      tertiaryColor: "#ffffff",
    },
  });
  return mermaid;
}

async function renderDiagram(source: HTMLElement): Promise<void> {
  const block = source.parentElement;
  if (block?.tagName !== "PRE" || rendering.has(source)) {
    return;
  }
  rendering.add(source);

  const definition = source.textContent ?? "";
  try {
    const mermaid = await loadMermaid();
    const parsed = await mermaid.parse(definition, { suppressErrors: true });
    if (!parsed) {
      block.dataset.mermaidError = "";
      return;
    }

    const id = `dokito-mermaid-${++diagramSequence}`;
    const { svg, bindFunctions } = await mermaid.render(id, definition);
    if (!block.isConnected) {
      return;
    }

    const diagram = document.createElement("figure");
    diagram.dataset.mermaidDiagram = "";
    diagram.innerHTML = svg;
    block.replaceWith(diagram);
    bindFunctions?.(diagram);
  } catch {
    block.dataset.mermaidError = "";
  }
}

export function enhanceMermaidDiagrams(root: ParentNode): void {
  const sources = descendants<HTMLElement>(root, "code[data-mermaid-source]");
  if (sources.length === 0) {
    return;
  }
  void (async () => {
    for (const source of sources) {
      await renderDiagram(source);
    }
  })();
}
