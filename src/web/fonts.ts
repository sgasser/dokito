import interWoff2 from "./fonts/inter.woff2" with { type: "file" };
import monoWoff2 from "./fonts/jetbrains-mono.woff2" with { type: "file" };

/**
 * The Latin subsets of Inter and JetBrains Mono, embedded in the binary and
 * served from this origin. The Content Security Policy blocks font CDNs, and
 * a workspace that only reads local files should not need the network to
 * render. Both fonts are under the SIL Open Font License; see the .txt files
 * next to them.
 */
export const FONT_FILES: Record<string, string> = {
  "inter.woff2": interWoff2,
  "jetbrains-mono.woff2": monoWoff2,
};
