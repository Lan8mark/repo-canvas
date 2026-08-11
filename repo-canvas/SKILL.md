---
name: repo-canvas
description: Maintain a live, owner-steerable repository map while coding. Use when an agent works in a repository that contains the Repo Canvas runtime, needs to expose planned scope before implementation, publish module-level progress, coordinate with other agents, or consume owner actions such as explain, correct, stop, reject, and rollback.
---

# Repo Canvas

Keep the board truthful at structural checkpoints. Treat it as an owner control surface, not decorative reporting.

## Start a task

Read the current snapshot and pending directives before editing:

```text
node repo-canvas/scripts/canvas.mjs snapshot
node repo-canvas/scripts/canvas.mjs directives
```

Create or update one task with a stable lowercase id:

```text
node repo-canvas/scripts/canvas.mjs task --id auth-refactor --title "Refactor authentication" --status planned --actor codex --summary "Separate token validation from request handling"
```

Publish only module-level nodes. Use stable ids and real repository paths when available:

```text
node repo-canvas/scripts/canvas.mjs node --task auth-refactor --id token-validator --label "Token validator" --path src/auth/token-validator.ts --status planned --actor codex --note "New boundary proposed before implementation"
```

Connect meaningful dependencies:

```text
node repo-canvas/scripts/canvas.mjs edge --task auth-refactor --from request-handler --to token-validator --status planned --actor codex --label "delegates validation"
```

## Use statuses consistently

- `existing`: present and outside the current change.
- `planned`: proposed but not created; render with a dashed outline.
- `active`: being changed now.
- `changed`: implemented and awaiting verification.
- `done`: implemented and verified.
- `blocked`: unable to proceed or explicitly stopped.
- `rejected`: removed from the plan or rolled back.

Use task statuses `planned`, `active`, `blocked`, `done`, or `stopped`.

## Publish checkpoints

Update the board at these moments:

1. After planning and before code changes.
2. Before adding a module or responsibility outside the visible plan.
3. After an owner directive or material replanning.
4. After a meaningful implementation batch.
5. Before the final response.

Do not publish every shell command or file edit. Prefer one event per meaningful state transition.

## Check and obey owner directives

Run:

```text
node repo-canvas/scripts/canvas.mjs directives --task auth-refactor
```

Interpret actions exactly:

- `explain`: stop changing the target, explain intent, dependencies, and removal cost.
- `correct`: revise the plan using the owner's note before continuing.
- `stop`: stop target work and preserve current files until the owner decides what to retain.
- `reject`: keep a planned target unimplemented; remove only target-specific changes created by the current task.
- `rollback`: inspect version control and undo only attributable changes.

Never treat a directive as permission to delete unrelated or pre-existing code. Inspect the diff before rollback or removal.

Acknowledge every handled directive:

```text
node repo-canvas/scripts/canvas.mjs ack --id <directive-id> --actor codex --note "Stopped before implementation; no files created"
```

## Record concise activity

Use activity only for decisions or verification results:

```text
node repo-canvas/scripts/canvas.mjs log --task auth-refactor --actor codex --level success --message "Unit tests pass; token validator marked done"
```

## Finish

Set truthful final node and task statuses, recheck directives, and validate the event log:

```text
node repo-canvas/scripts/canvas.mjs directives --task auth-refactor
node repo-canvas/scripts/canvas.mjs check
```

The browser is a turn-synchronous view. It becomes current when agents publish events; it does not observe unreported internal reasoning or edits.
