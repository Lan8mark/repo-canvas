# Repo Canvas

Repo Canvas is a local, live map of repository work. Coding agents publish task/module checkpoints through a tiny CLI; the owner watches the board in a browser and can send `explain`, `correct`, `stop`, `reject`, or `rollback` directives back through the same project-local event log.

It is deliberately small: one dependency-free Node package, one foreground loopback server, one append-only JSONL store, and one repository instruction contract.

## Requirements

- Node.js 22 or newer.
- An npm project and a Git working tree for the supported v1 bootstrap.
- A local browser. Repo Canvas v1 never binds outside loopback.

## Install from the packed artifact

```text
npm install --save-dev --save-exact ./repo-canvas-0.2.0.tgz
npx --no-install repo-canvas init
npm run canvas:start
```

Then open the exact URL printed by the server, normally `http://127.0.0.1:4173`.

After registry publication the first two commands collapse to an exact-version bootstrap:

```text
npx --yes repo-canvas@0.2.0 init
```

Normal work always uses the locally pinned package:

```text
npm run canvas -- snapshot
npm run canvas -- directives
npm run canvas -- check
```

`init` is idempotent. It adds three npm scripts, a marked block in `AGENTS.md`, the managed `repo-canvas/SKILL.md`, a one-line Claude import bridge, `.repo-canvas/` in `.gitignore`, and the empty local event store when absent. Existing owner text is preserved; conflicting script names or unmanaged contract files stop initialization with a concrete error.

Codex, Kimi, and current Qwen Code discover the root `AGENTS.md`. Claude Code receives the documented `@AGENTS.md` bridge in `CLAUDE.md`. For an unknown agent, use the bootstrap prompt printed by `init`.

## Commands

```text
repo-canvas init [--upgrade] [--root <path>]
repo-canvas start [--port <port>] [--root <path>]
repo-canvas task|node|edge|log ...
repo-canvas snapshot
repo-canvas directives [--task <id>]
repo-canvas ack --id <directive-id> --actor <agent> --note <result>
repo-canvas check
repo-canvas repair [--apply]
```

The default URL is deterministic. If port 4173 is occupied, choose another explicitly with `--port`; the server never scans ports or starts a daemon. `repair` previews invalid JSON lines and changes nothing until `--apply`, then preserves a full backup and a rejected-lines artifact.

## Honest boundary

The board is checkpoint-synchronous. It shows what agents publish and delivers owner actions when agents poll. It does not continuously inspect private model reasoning, authenticate model identity, synchronize different machines, or perform automatic Git rollback.
