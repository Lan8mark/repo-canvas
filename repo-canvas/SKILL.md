---
name: repo-canvas
description: Install, operate, and recover a self-maintaining semantic repository map with a subscription-backed Architect and Observer.
---
<!-- repo-canvas:managed -->

# Repo Canvas operator guide

Repo Canvas is a project map, not a task board. Permanent architecture is represented by areas, entities and relations; temporary agent work appears as small session-linked satellites.

Normal coding agents do not maintain the map. Do not add Repo Canvas rules to `AGENTS.md`, `CLAUDE.md`, prompts, or coding-agent hooks.

## Install

From the repository root:

```text
npx --no-install repo-canvas setup
npm run repo-canvas:start
```

`setup` verifies the existing local Codex login, runs a read-only Architect, enables the Observer, and removes the legacy agent-facing Canvas contract while preserving owner text.

## Runtime roles

- Architect: `gpt-5.6-sol`, medium reasoning by default. It reads the repository once and builds or refreshes the complete semantic map.
- Observer: `gpt-5.4-mini`, low reasoning by default. It reads only public Codex session events scoped to this repository and sends short independent classification turns.

The Observer immediately emits a provisional work satellite when a Codex turn starts. It then attaches the work to semantic entities after the first useful public agent event or a short deadline. Completion triggers one final delta.

The observer never reads hidden reasoning and never rescans product files. A file deletion alone cannot remove a semantic entity. A completion delta may remove an entity only when the public session establishes that the concept itself was eliminated or merged away.

## Semantic objects

- `area`: a large human-meaningful project territory.
- `entity`: a persistent module, responsibility, store, pipeline stage, or integration.
- `relation`: meaningful data, runtime, or control flow.
- `work`: a temporary agent turn attached to affected entities and its exact session.

There is no object count limit. Do not mirror every file or class.

Entity states:

- `operational`: present and intended to work;
- `disabled`: intentionally switched off or frozen;
- `problem`: confirmed unresolved failure;
- `planned`: approved concept that does not exist yet.

Active state is derived from work satellites, not stored on entities.

## Commands

```text
npm run repo-canvas -- doctor
npm run repo-canvas -- architect --refresh
npm run repo-canvas -- observer status
npm run repo-canvas -- observer enable
npm run repo-canvas -- observer disable
npm run repo-canvas -- snapshot
npm run repo-canvas -- check
```

Use `architect --refresh` after a major redesign or when the owner says the map is stale. The Architect preserves stable entity ids across moves, renames and reimplementations.

Manual area/entity/relation/work commands remain available for repair and backward compatibility. Never edit `.repo-canvas/events.jsonl` directly.

## Acceptance

Before handoff:

1. `repo-canvas check` is green;
2. one loopback server is running;
3. the actual browser canvas is visually inspected;
4. a fresh Codex turn in this repository creates a provisional satellite promptly and becomes classified;
5. unrelated repository sessions do not appear;
6. temporary servers and browser sessions used only for QA are stopped.
