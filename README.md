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
npm install --save-dev --save-exact --ignore-scripts github:Lan8mark/repo-canvas#v0.9.0
npx --no-install repo-canvas setup
npm run repo-canvas:start
```

The server opens the protected loopback URL in your default browser. Keep that foreground terminal running while you use the Canvas.

## What you see

- project areas that group related parts of the system;
- problem-oriented blocks: what breaks without each block and what it changes;
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

`setup` checks the local Codex connection, then runs a read-only Architect with `gpt-5.6-sol` at medium reasoning. Architect inspects the repository once and builds its semantic map. It treats the map as an explanation rather than a code inventory: every node must justify itself with a distinct problem and solution, then provide a compact mechanism, 1-3 technical invariants and an implementation anchor. Isolated cards and incomplete refresh overlays are rejected.

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

The npm installation adds Repo Canvas as an exact development dependency. `setup` adds three package scripts, the ignored `.repo-canvas/` runtime directory and two `.gitignore` entries. It does not add coding-agent instructions or hooks.

The server binds to loopback only, opens a fresh tokenized Canvas URL on every start and shares that authorization with other tabs on the same local address. Existing tabs reconnect when a restarted server opens its new protected URL. Use `repo-canvas start --no-open` only when automatic browser opening is unwanted. The token protects all Canvas API reads and actions from unrelated local processes. Semantic events and Observer cursors stay in the repository's ignored `.repo-canvas/` directory. Model calls use existing local Codex authentication through the official Codex SDK. Claude and Kimi adapters only parse their local journals; they do not copy credentials or call those providers. No API key is copied into the project.

From v0.8.6 onward, Canvas checks the public GitHub release feed in the background. If a newer release exists, an `Update` control appears at the bottom of the page. The updater requires the official `.tgz` asset and its GitHub SHA-256 digest, installs it side-by-side inside ignored `.repo-canvas/runtime/`, restarts the local server with the same browser authorization and keeps the previous runtime as a rollback. It does not rewrite the project's dependency or lockfile.

## Offline installation

Download `repo-canvas-0.9.0-kit.zip` from the [latest release](https://github.com/Lan8mark/repo-canvas/releases/latest). Copy `repo-canvas-0.9.0.tgz` and `INSTALL_WITH_AGENT.txt` into the target repository, then give the text file to a coding agent.

Manual commands:

```text
npm install --save-dev --save-exact --ignore-scripts ./repo-canvas-0.9.0.tgz
npx --no-install repo-canvas setup
npm run repo-canvas:start
```

## Useful commands

```text
npm run repo-canvas -- doctor
npm run repo-canvas -- architect --refresh
npm run repo-canvas -- observer status
npm run repo-canvas -- observer disable
npm run repo-canvas -- observer enable
npm run repo-canvas -- snapshot
npm run repo-canvas -- check
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
