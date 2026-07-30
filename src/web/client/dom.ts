export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) {
    node.className = className;
  }
  if (text !== undefined) {
    node.textContent = text;
  }
  return node;
}

export function descendants<T extends Element>(
  root: ParentNode,
  selector: string,
): T[] {
  const own =
    root instanceof Element && root.matches(selector) ? [root as T] : [];
  return [...own, ...root.querySelectorAll<T>(selector)];
}

function toast(message: string): void {
  document.querySelector("[data-dokito-toast]")?.remove();
  const node = el(
    "div",
    "fixed bottom-4 left-1/2 z-70 flex -translate-x-1/2 items-center gap-2 rounded-panel bg-ink px-3.5 py-2 text-ui-md text-white shadow-[0_8px_28px_rgb(29_32_37/0.28)]",
    message,
  );
  node.dataset.dokitoToast = "";
  node.setAttribute("role", "status");
  document.body.append(node);
  setTimeout(() => node.remove(), 2600);
}

export async function copyText(value: string, label: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
    toast(`${label} copied`);
  } catch {
    toast(`${label} could not be copied`);
  }
}
