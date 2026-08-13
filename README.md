# Repo Canvas 0.6

A local semantic map for large repositories. It shows permanent project structure and overlays live Codex work as small session-linked satellites.

## What changed in 0.6

Repo Canvas now maintains itself outside the coding agent's context:

- a subscription-backed **Architect** builds the first semantic map with `gpt-5.6-sol` at medium reasoning;
- a private **Observer** watches only public Codex session events belonging to this repository;
- a provisional work card appears as soon as a Codex turn starts;
- `gpt-5.4-mini` classifies the work from small session deltas and attaches it to semantic entities;
- completion updates affected passports and can remove a concept only when the session establishes that the concept itself was eliminated;
- file deletion by itself never deletes a Canvas entity;
- normal Codex sessions receive no Repo Canvas prompt, hook, or `AGENTS.md` contract.

The observer does not read hidden reasoning, scan product files, control agents, or send owner commands. It reads the same public session journal used by Codex resume/history and filters it by canonical repository root or Git common directory.

## What the owner sees

- large Miro-like project areas;
- persistent module and responsibility nodes;
- meaningful runtime and data relations;
- small planned, active, blocked, or provisional work satellites;
- an active orbit on every entity currently being changed;
- entity passports and recent activity in the left rail;
- draggable areas and nodes with saved owner layout;
- double-click navigation from work to its Codex App task or CLI resume command.

There is no semantic entity limit. The same canvas can represent four modules or hundreds.

## Hand-off to another person

Send two files from the release kit: `repo-canvas-0.6.0.tgz` and `INSTALL_WITH_AGENT.txt`.

The recipient places them in an existing repository, opens one coding-agent conversation there, attaches the text file and asks the agent to install it. After installation, product agents do not need to know Repo Canvas exists.

## Manual installation

```text
npm install --save-dev --save-exact --ignore-scripts ./repo-canvas-0.6.0.tgz
npx --no-install repo-canvas setup
npm run repo-canvas:start
```

Requirements: Node.js 22+, Git, and a locally authenticated Codex subscription. Windows and macOS use the same commands. The server binds to loopback only.

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

Repo Canvas stores its semantic event log and observer cursor in the repository's ignored `.repo-canvas/` directory. Model calls use the user's existing local Codex authentication through the official Codex SDK. No API key is copied into the project.

## License

[MIT](LICENSE)
