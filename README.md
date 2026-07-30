# Dokito

**Knowledge, projects, and tasks for people and agents — kept in local Markdown
files.**

Dokito gives each product or responsibility an **Area**. Use one for a software
product, marketing, sales, operations, infrastructure, a client, or personal
work. An Area can connect code Repositories, but it does not need one.

People browse and search an Area in any editor or the local Web view. Agents
use the bundled skill to find and maintain the same knowledge and work.
Knowledge and work stay in ordinary Markdown files that can be versioned with
Git. No database, hosted backend, or proprietary file format.

## What lives in an Area

- **Context** explains what the Area is and what matters now.
- **Projects** define outcomes with a beginning and an end.
- **Resources** preserve notes, decisions, research, and reference material.
- **Tasks** track the concrete work that moves an Area or Project forward.

Dokito is inspired by the [PARA method](https://fortelabs.com/blog/para/), but
models Archive through lifecycle states and keeps Projects and Resources inside
their owning Area.

## Why Dokito

- **Beyond code Repositories.** Keep research, decisions, marketing, sales,
  operations, infrastructure, or personal notes without forcing them into a
  code Repository.
- **Small context, details on demand.** Agents start with a short Area overview
  and open deeper knowledge only when relevant.
- **One source of truth.** People, agents, and the Web view use the same
  versioned files.
- **Repository-aware, not Repository-bound.** Every connected checkout resolves
  to the same Area, and one Area can connect multiple Repositories.

![Dokito showing an Area context with navigation to Focus, Resources, Projects, Tasks, and search](docs/assets/dokito-area-view.png)

## Install

> **Project status:** Dokito is early-stage software. Release binaries are
> available for macOS and Linux; package-manager installation is not.

### Install the CLI

Prebuilt binaries are available for macOS and Linux. macOS downloads are
signed and notarized. Windows is not supported yet.

Download and run the installer:

```bash
installer="$(mktemp)"
curl -fsSL https://github.com/sgasser/dokito/releases/latest/download/install-dokito.sh \
  -o "$installer"
sh "$installer"
rm "$installer"
export PATH="$HOME/.local/bin:$PATH"
dokito --version
```

The installer selects the correct download, verifies its SHA-256 checksum, and
installs `dokito` in `$HOME/.local/bin`. Add that directory to your shell's
`PATH` to keep `dokito` available in future sessions.

### Build from source

You need [Git](https://git-scm.com/) and [Bun](https://bun.sh/). These commands
also target macOS and Linux.

```bash
git clone https://github.com/sgasser/dokito.git
cd dokito
bun install --frozen-lockfile
bun run build
mkdir -p "$HOME/.local/bin"
ln -s "$PWD/dist/dokito" "$HOME/.local/bin/dokito"
```

Make sure `$HOME/.local/bin` is on your `PATH`, then verify the build:

```bash
dokito --version
```

### Install the agent skill

With Node.js available, install the bundled skill through the open agent skills
CLI. It detects supported agents such as Codex and Claude Code:

```bash
npx skills add sgasser/dokito --skill dokito --global
```

The GitHub release also includes `dokito-skill.tar.gz` for manual installation.
When building from source, link the skill from the checkout instead:

```bash
# Codex
mkdir -p "$HOME/.agents/skills"
ln -s "$PWD/skills/dokito" "$HOME/.agents/skills/dokito"

# Claude Code
mkdir -p "$HOME/.claude/skills"
ln -s "$PWD/skills/dokito" "$HOME/.claude/skills/dokito"
```

Keep a linked checkout at the same path. Start a new agent session after
installing or linking the skill.

## Create an Area

With the skill installed, start with a normal request:

> Create a Dokito Area called Marketing in `~/Work/marketing`.

For software work, add “and connect this Repository.”

The skill creates, registers, and validates the Area. Then open the Web view:

```bash
dokito web
```

The view lists every registered Area, so the new one is in its switcher.

For manual setup and every supported file shape, see the
[specification](docs/SPEC.md).

## Browse your work

### Resources

Keep notes, decisions, research, architecture, customer knowledge, and other
reference material.

![Dokito showing an architecture Resource with Repository and data-flow notes](docs/assets/dokito-resources-view.png)

### Projects

See each outcome together with its open work and connected Repositories.

![Dokito showing a Project with its outcome, open Tasks, Markdown body, Area, and connected Repositories](docs/assets/dokito-project-view.png)

### Tasks

Track concrete work by status, priority, due date, Project, or Repository.

![Dokito showing Tasks grouped by status alongside the selected Task details](docs/assets/dokito-tasks-view.png)

## Work with people and agents

The Web view is read-only and always reflects the current Area files. People
can edit those files in any editor. The [bundled skill](skills/dokito/SKILL.md)
helps agents find the right Area, load only relevant knowledge, and write
validated changes back.

Connect an Area to one or more code Repositories and Dokito can find the same
knowledge and work from any checkout. Nothing is copied into the Repository.
On macOS with [Conductor](https://www.conductor.build/) installed, the Web view
can also start a Task there when a local checkout is available.

## Current limits

- Commands and Markdown file formats may change between releases.
- The Web view is read-only.
- Dokito does not import existing notes automatically.
- Dokito has no user accounts, roles, or permissions.

## Data and privacy

Dokito stores Area files on the user's machine. It has no telemetry, cloud
service, or synchronization, and the Web view binds to `127.0.0.1`.

An Area stays local unless its files are published or shared. Content an agent
loads reaches that agent's model provider like any other prompt, so do not
expose material you would not send to that provider.

## Documentation and contributions

- [CLI reference](docs/CLI.md)
- [Specification](docs/SPEC.md)
- [Contributing](CONTRIBUTING.md)

Bug fixes and documentation corrections are welcome; feature contributions are
not accepted for now.

## License

[Apache License 2.0](LICENSE)

The Web view embeds Inter and JetBrains Mono, both under the
[SIL Open Font License](https://openfontlicense.org/). Their license texts sit
next to the font files in `src/web/fonts/`.
