# Repo Canvas

**Understand a large repository at a glance and see where coding agents are working right now.**

Repo Canvas builds a local, Miro-like map of an existing project. Permanent areas, modules and relations show how the system fits together. Live work cards show what Codex, Claude Code and Kimi Code sessions are changing. Double-click a work card to return to that session.

## Install with your coding agent

Send your agent this repository URL and one sentence:

```text
https://github.com/Lan8mark/repo-canvas
Install this project-visualization tool in the current repository, build the initial map, start it and give me the local Canvas URL.
```

The agent will follow [`INSTALL_WITH_AGENT.txt`](INSTALL_WITH_AGENT.txt). The exact commands are:

```text
npx --yes --package=github:Lan8mark/repo-canvas#v0.11.0 repo-canvas bootstrap
node .repo-canvas/repo-canvas.mjs start
```

The server opens the protected loopback URL in your default browser. Keep that foreground terminal running while you use the Canvas.

## What you see

- project areas that group related parts of the system;
- goal-oriented blocks: what the product must achieve and which technical solution achieves it;
- semantic hierarchy: Core product spine, supporting systems and implementation details;
- a `Meaning / Technical` switch between newcomer logic and implementation evidence;
- fluid semantic cards that wrap every title and body in full and grow with their content and ports;
- two-layer relations: why a connection matters and the concrete runtime/data mechanism;
- a provisional work card as soon as a supported agent turn is observed;
- live work attached to every semantic entity it affects;
- entity passports and recent activity in the left rail;
- collapsible project sections, full-map reset and an in-canvas legend;
- draggable areas and nodes with saved layout;
- owner-controlled names for areas, entities and relations by double-clicking their labels;
- distinct header controls for reloading current Canvas data and regenerating the semantic map with Architect;
- a local Update button that appears only when a newer verified release is available;
- direct navigation back to Codex App or an exact Codex, Claude Code or Kimi Code CLI resume command.

The data model has no fixed entity cap. One Canvas can hold a small project or a map with hundreds of semantic entities.

## How it works

`setup` checks the local Codex connection, then runs a read-only Architect with `gpt-5.6-sol` at medium reasoning. Architect first inventories public goals, pipelines, stores, models and runtimes; then builds the product spine; then audits the result independently. Every node maps a pragmatic goal to a real technical solution and cites implementation evidence. Deterministic coverage gates reject missing fundamental systems and broken main flows. Refresh omissions never delete existing concepts.

When the Canvas server is running, Observer watches public local session journals for this repository. It creates a provisional card on the first observed turn event, then uses `gpt-5.4-mini` to classify small event deltas and attach the work to the map. On completion, Observer updates affected passports and relations when the session contains enough evidence.

Observer supports:

| Agent surface | Live observation | Return to session |
| --- | --- | --- |
| Codex App | Yes | Exact task link |
| Codex CLI | Yes | `codex resume <session>` |
| Claude Code CLI | Yes | `claude --resume <session>` |
| Kimi Code CLI | Yes | `kimi -r <session>` |

Observer reads public user messages, agent messages and tool-call metadata. Claude `thinking`, Kimi `think`, hidden reasoning and tool results are ignored. It filters sessions by repository root and does not rescan product files during observation.

## Requirements and installation footprint

- Node.js 22 or newer;
- Git;
- a locally authenticated Codex installation for Architect and Observer model calls;
- Windows or macOS.

The only persistent path created in the project is `.repo-canvas/`. It contains the tool runtime and dependencies, launchers, semantic map, event history, layouts, observer state and update data. Its own nested `.gitignore` hides the entire directory without touching the repository's root `.gitignore`.

Repo Canvas does not create or edit the project's `package.json`, lockfile, `node_modules`, agent instructions or hooks. `npx` uses npm's ordinary user cache outside the project only for the temporary bootstrap. Stop the server and delete `.repo-canvas/` to remove Repo Canvas completely.

The server binds to loopback only, opens a fresh tokenized Canvas URL on every start and shares that authorization with other tabs on the same local address. Existing tabs reconnect when a restarted server opens its new protected URL. Use `repo-canvas start --no-open` only when automatic browser opening is unwanted. The token protects all Canvas API reads and actions from unrelated local processes. Semantic events and Observer cursors stay in the repository's ignored `.repo-canvas/` directory. Model calls use existing local Codex authentication through the official Codex SDK. Claude and Kimi adapters only parse their local journals; they do not copy credentials or call those providers. No API key is copied into the project.

From v0.8.6 onward, Canvas checks the public GitHub release feed in the background. If a newer release exists, an `Update` control appears at the bottom of the page. The updater requires the official `.tgz` asset and its GitHub SHA-256 digest, installs it side-by-side inside ignored `.repo-canvas/runtime/`, restarts the local server with the same browser authorization and keeps the previous runtime as a rollback. It does not rewrite the project's dependency or lockfile.

## Offline installation

Download `repo-canvas-0.11.0-kit.zip` from the [latest release](https://github.com/Lan8mark/repo-canvas/releases/latest). Copy `repo-canvas-0.11.0.tgz` and `INSTALL_WITH_AGENT.txt` into the target repository, then give the text file to a coding agent.

Manual commands:

```text
npx --yes --package=./repo-canvas-0.11.0.tgz repo-canvas bootstrap
node .repo-canvas/repo-canvas.mjs start
```

After a successful offline bootstrap, the copied `.tgz` and instruction file may be deleted.

## Useful commands

```text
node .repo-canvas/repo-canvas.mjs doctor
node .repo-canvas/repo-canvas.mjs architect --refresh
node .repo-canvas/repo-canvas.mjs observer status
node .repo-canvas/repo-canvas.mjs observer disable
node .repo-canvas/repo-canvas.mjs observer enable
node .repo-canvas/repo-canvas.mjs snapshot
node .repo-canvas/repo-canvas.mjs check
```

Model profiles can be overridden without code changes:

```text
REPO_CANVAS_ARCHITECT_MODEL
REPO_CANVAS_ARCHITECT_EFFORT
REPO_CANVAS_OBSERVER_MODEL
REPO_CANVAS_OBSERVER_EFFORT
```

## License

[MIT](LICENSE)
