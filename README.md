# Repo Canvas 0.5

A zero-dependency local semantic map for large repositories. It shows permanent project structure and overlays current agent work as small session-linked satellites.

## What the owner sees

- large Miro-like project areas;
- persistent module and responsibility nodes;
- meaningful runtime and data relations;
- small planned, active, or blocked work satellites beside affected entities;
- an active orbit on every entity currently being changed;
- a compact entity passport and recent activity in the left rail;
- owner layout editing: drag a node directly, or drag an area by its heading to move the whole block; positions persist in the shared map;
- double-click navigation from work to the exact Codex/Claude session or terminal resume command.

Repo Canvas does not control agents, index every file, run a daemon, or require a database.

On Codex, the installed project hook reminds the agent on every prompt and blocks product edit tools until a separate verified `work start` has attached the current session to real entity ids. Approve the repository hook when Codex asks for trust, then open a fresh task so it is active from the first prompt. Other agents receive the same mandatory CLI contract through `AGENTS.md`; native hard guards depend on their hook support.

## Hand-off to another person

Download the latest kit from [GitHub Releases](https://github.com/m0ast-git/repo-canvas/releases), or send the two files inside it: `repo-canvas-0.5.0.tgz` and `INSTALL_WITH_AGENT.txt`.

They copy both into an existing repository root, open a fresh coding-agent conversation there, attach or paste the text file, and ask the agent to install it. The text contains the complete bootstrap acceptance contract.

## Manual installation

```text
npm install --save-dev --save-exact --ignore-scripts ./repo-canvas-0.5.0.tgz
npx --no-install repo-canvas init
npm run repo-canvas:start
```

Node.js 22+ is required. The server binds to loopback only. `init` is idempotent and preserves existing owner instructions; conflicts stop with a concrete error.

## Semantic CLI

```text
npm run repo-canvas -- area --id knowledge --title "Knowledge base"
npm run repo-canvas -- entity --id search --area knowledge --label "Standards search" --status operational --path src/search
npm run repo-canvas -- relation --from search --to registry --label "queries"
npm run repo-canvas -- work start --id improve-search --title "Improve matching" --targets search,registry --note "Tighten matching" --actor codex
npm run repo-canvas -- snapshot
npm run repo-canvas -- check
```

Legacy v0.3 task/node/edge events remain readable after upgrade, but new agents use area/entity/relation/work.

## License

[MIT](LICENSE)
