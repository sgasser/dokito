import type { ReactNode } from "react";
import type { WebDashboardData } from "./data";
import { FocusView } from "./focus-view";
import { ProjectView } from "./project-view";
import { ProjectsView } from "./projects-view";
import { ResourcesView } from "./resources-view";
import { SearchView } from "./search-view";
import { Shell, WorkspaceMain } from "./shell";
import styles from "./styles.generated.css" with { type: "text" };
import { TasksView } from "./tasks-view";

function Brand() {
  return (
    <a
      className="inline-flex w-fit items-baseline gap-2 px-2 focus-ring"
      href="/"
      aria-label="Homepage"
    >
      <span className="text-xl font-semibold tracking-tight">dokito</span>
    </a>
  );
}

interface AppProps {
  data: WebDashboardData;
}

const VIEW_TITLES: Record<WebDashboardData["view"], string> = {
  focus: "Focus",
  resources: "Resources",
  projects: "Projects",
  project: "Project",
  tasks: "Tasks",
  search: "Search",
};

interface ErrorPageProps {
  code: string;
  message: string;
}

function HtmlDocument({
  children,
  title = "Dokito",
}: {
  children: ReactNode;
  title?: string;
}) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light" />
        <meta
          name="description"
          content="Read local Markdown and continue work across your Areas."
        />
        <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
        <title>{title}</title>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: This is local CSS produced at build time, never Area content. */}
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </head>
      <body>
        {children}
        {/* Loaded last and never required: every view works without it. */}
        <script defer src="/app.js" />
      </body>
    </html>
  );
}

export function DokitoApp({ data }: AppProps) {
  const pageTitle = titleFor(data);
  return (
    <HtmlDocument title={pageTitle}>
      <a
        className="fixed top-2 left-2 z-80 translate-y-[-160%] rounded-control bg-ink px-3 py-2 text-ui text-white focus-ring focus:translate-y-0"
        href="#main-content"
      >
        Skip to content
      </a>
      <Shell data={data} pageTitle={pageTitle}>
        <DashboardView data={data} />
      </Shell>
    </HtmlDocument>
  );
}

function titleFor(data: WebDashboardData): string {
  return `Dokito — ${
    data.view === "project" ? data.project.title : VIEW_TITLES[data.view]
  }`;
}

export function DokitoNavigationFragment({ data }: AppProps) {
  return (
    <WorkspaceMain data={data} pageTitle={titleFor(data)}>
      <DashboardView data={data} />
    </WorkspaceMain>
  );
}

function DashboardView({ data }: AppProps) {
  if (data.view === "focus") {
    return <FocusView data={data} />;
  }
  if (data.view === "resources") {
    return <ResourcesView data={data} />;
  }
  if (data.view === "projects") {
    return <ProjectsView data={data} />;
  }
  if (data.view === "project") {
    return <ProjectView data={data} />;
  }
  if (data.view === "tasks") {
    return <TasksView data={data} />;
  }
  return <SearchView data={data} />;
}

const SKILL_LINK_COMMANDS = `# Claude Code
ln -s "$PWD/skills/dokito" "$HOME/.claude/skills/dokito"

# Codex
ln -s "$PWD/skills/dokito" "$HOME/.agents/skills/dokito"`;

/**
 * What Dokito shows with no registered Area. Not an error: the server is
 * healthy and the config is simply still empty, so this answers 200 and says
 * what to do next. The Area itself is created by the skill rather than by hand
 * here, because `dokito.yaml` has exactly one documented shape and repeating it
 * on this page would make a second one.
 */
export function DokitoWelcomePage({ configPath }: { configPath: string }) {
  return (
    <HtmlDocument title="Dokito — Welcome">
      <main className="mx-auto w-[min(calc(100%-32px),680px)] pt-9 pb-16">
        <Brand />
        <div className="mt-[10vh]">
          <p className="mb-2 text-xs font-semibold text-accent">
            No Area registered
          </p>
          <h1 className="text-[32px] leading-[1.08] font-[650] tracking-[-0.045em] min-[560px]:text-5xl">
            Welcome to Dokito
          </h1>
          <p className="mt-3.5 max-w-[55ch] text-doc/relaxed text-ink-soft">
            An Area is one folder for a product or responsibility. The bundled
            agent skill creates it and registers it for you.
          </p>

          <section className="prose mt-8">
            <h2>1. Link the skill</h2>
            <p>From this Dokito checkout, link the skill your agent reads:</p>
            <pre>
              <code>{SKILL_LINK_COMMANDS}</code>
            </pre>
            <p>
              Keep the checkout at the same path and start a new agent session
              afterwards.
            </p>

            <h2>2. Ask the agent for an Area</h2>
            <blockquote>
              <p>
                Create a Dokito Area called Marketing in{" "}
                <code>~/Work/marketing</code>.
              </p>
            </blockquote>
            <p>
              For software work, add “and connect this Repository.” The skill
              writes the Area files and runs <code>dokito register</code>.
              Reload this page when it is done.
            </p>
          </section>

          <p className="mt-8 max-w-[55ch] text-ui-sm text-muted">
            Creating the Area by hand instead? The manifest format is in the{" "}
            <a
              className="underline focus-ring"
              href="https://github.com/sgasser/dokito/blob/main/docs/SPEC.md"
            >
              specification
            </a>
            . Registrations are stored in <code>{configPath}</code>.
          </p>
        </div>
      </main>
    </HtmlDocument>
  );
}

export function DokitoErrorPage({ code, message }: ErrorPageProps) {
  const missing = code === "page_not_found";
  return (
    <HtmlDocument
      title={missing ? "Dokito — Page not found" : "Dokito — Error"}
    >
      <main className="mx-auto w-[min(calc(100%-32px),680px)] pt-9 pb-16">
        <Brand />
        <div className="mt-[18vh]">
          <p className="mb-2 text-xs font-semibold text-accent">{code}</p>
          <h1 className="text-[32px] leading-[1.08] font-[650] tracking-[-0.045em] min-[560px]:text-5xl">
            {missing ? "Page not found" : "Dokito unavailable"}
          </h1>
          <p className="mt-3.5 max-w-[55ch] text-doc/relaxed text-ink-soft">
            {message}
          </p>
          <a
            className="mt-6 inline-flex min-h-[42px] items-center rounded-panel bg-ink px-3.5 py-2 text-ui font-semibold text-white focus-ring"
            href="/"
          >
            Return to overview
          </a>
        </div>
      </main>
    </HtmlDocument>
  );
}
