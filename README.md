# Repo Canvas 0.7

A local semantic map for large repositories. It shows permanent project structure and overlays live Codex, Claude Code and Kimi Code work as small session-linked satellites.

## What changed in 0.7

Repo Canvas now maintains itself outside the coding agent's context:

- a subscription-backed **Architect** builds the first semantic map with `gpt-5.6-sol` at medium reasoning;
- a private **Observer** watches public Codex, Claude Code and Kimi Code session events belonging to this repository;
- a provisional work card appears as soon as any supported agent turn starts;
- `gpt-5.4-mini` classifies the work from small session deltas and attaches it to semantic entities;
- completion updates affected passports and can remove a concept only when the session establishes that the concept itself was eliminated;
- file deletion by itself never deletes a Canvas entity;
- normal coding sessions receive no Repo Canvas prompt, hook, or `AGENTS.md` contract.

The observer does not read hidden reasoning, tool results, scan product files, control agents, or send owner commands. It reads the public local journals used by each agent's resume/history feature and filters them by repository root. Kimi `think` parts and Claude `thinking` parts are ignored.

## What the owner sees

- large Miro-like project areas;
- persistent module and responsibility nodes;
- meaningful runtime and data relations;
- small planned, active, blocked, or provisional work satellites;
- an active orbit on every entity currently being changed;
- entity passports and recent activity in the left rail;
- draggable areas and nodes with saved owner layout;
- double-click navigation from work to its Codex App task or exact Codex/Claude/Kimi CLI resume command (`kimi -r <session>` for current Kimi Code).

There is no semantic entity limit. The same canvas can represent four modules or hundreds.

## Hand-off to another person

Send two files from the release kit: `repo-canvas-0.7.0.tgz` and `INSTALL_WITH_AGENT.txt`.

The recipient places them in an existing repository, opens one coding-agent conversation there, attaches the text file and asks the agent to install it. After installation, product agents do not need to know Repo Canvas exists.

## Manual installation

```text
npm install --save-dev --save-exact --ignore-scripts ./repo-canvas-0.7.0.tgz
npx --no-install repo-canvas setup
npm run repo-canvas:start
```

Requirements: Node.js 22+, Git, and a locally authenticated Codex subscription for Architect/Observer model calls. Claude Code and Kimi Code sessions are detected automatically when their local journals exist; they are not required. Windows and macOS use the same commands. The server binds to loopback only.

Useful commands:

```text
npm run repo-canvas -- doctor
npm run repo-canvas -- architect --refresh
npm run repo-canvas -- observer status
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

Legacy semantic CLI commands and v0.3-v0.5 event logs remain readable after upgrade.

## Privacy boundary

Repo Canvas stores its semantic event log and observer cursor in the repository's ignored `.repo-canvas/` directory. Model calls use the user's existing local Codex authentication through the official Codex SDK. Claude and Kimi adapters are read-only journal parsers and do not copy credentials or make provider calls. No API key is copied into the project.

## License

[MIT](LICENSE)
