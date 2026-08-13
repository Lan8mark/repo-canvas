const [root, actor, countText] = process.argv.slice(2);
if (!root || !actor || !countText) throw new Error("Usage: concurrent-writer.mjs <root> <actor> <count>");

process.env.REPO_CANVAS_ROOT = root;
const { appendEvent, createEvent } = await import("../repo-canvas/scripts/canvas-store.mjs");

for (let index = 0; index < Number(countText); index += 1) {
  appendEvent(
    createEvent("activity.log", {
      actor,
      payload: { message: `${actor} event ${index}`, level: "info" },
    }),
  );
}
