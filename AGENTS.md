# Repo Canvas agent contract

This repository is the live test bed for Repo Canvas. These instructions apply to every coding agent, including Codex, Claude, Kimi, and Qwen.

## Mandatory startup

1. Read `repo-canvas/SKILL.md` before changing files.
2. Inspect the current board state:
   `node repo-canvas/scripts/canvas.mjs snapshot`
3. Inspect unhandled owner directives:
   `node repo-canvas/scripts/canvas.mjs directives`
4. Reuse the current task id when continuing existing work. Create a short stable task id for new work.

## Mandatory canvas behavior

- Register the task before editing code.
- Represent repository areas at module or responsibility level. Do not map every file.
- Publish proposed new modules as `planned` nodes before creating them.
- If a new node broadens the agreed scope, publish it and yield for owner direction before implementing it.
- Update the affected nodes after each structural checkpoint and before the final response.
- Check directives again before structural expansion, after a meaningful implementation batch, and before finishing.
- Use only `node repo-canvas/scripts/canvas.mjs ...` to change canvas state. Never rewrite `.repo-canvas/events.jsonl` directly.
- Keep agent names stable: `codex`, `kimi`, `claude`, or `qwen`.

## Owner directives

- `explain`: pause the target work, explain its purpose and consequences, then acknowledge the directive.
- `correct`: incorporate the owner's note, revise the affected plan and nodes, then acknowledge it.
- `stop`: stop work on the target, preserve the working tree, mark it `blocked` or `rejected`, and report what remains.
- `reject`: do not create a planned target. If it was introduced by the current task, inspect the diff and remove only changes attributable to that target. Never delete pre-existing repository content solely because of a canvas click.
- `rollback`: inspect version-control state and undo only the current agent's target-specific changes. Report the exact result.

Every directive must be acknowledged with:

`node repo-canvas/scripts/canvas.mjs ack --id <directive-id> --actor <agent> --note "<result>"`

## Completion

Before reporting completion:

1. Recheck pending directives.
2. Mark nodes and task with their truthful final statuses.
3. Run `node repo-canvas/scripts/canvas.mjs check`.
4. Verify the real code/runtime requested by the task.
