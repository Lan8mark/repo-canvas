const NODE_WIDTH = 264;
const EDGE_STUB = 24;
const LABEL_MIN_WIDTH = 76;
const LABEL_MAX_WIDTH = 240;

export function relationLabelWidth(label) {
  return Math.min(LABEL_MAX_WIDTH, Math.max(LABEL_MIN_WIDTH, String(label || "").length * 4.4 + 22));
}

export function focusColumnOffset(relations = []) {
  const labelWidth = Math.max(LABEL_MIN_WIDTH, ...relations.map((relation) => relationLabelWidth(relation.ownerLabel || relation.label)));
  // The center runway remains wider than the rendered caption after both edge stubs.
  return NODE_WIDTH + labelWidth + EDGE_STUB * 2 + 24;
}

export function orthogonalRelationPath({ sourceX, sourceY, targetX, targetY, label }) {
  const startX = sourceX + EDGE_STUB;
  const endX = targetX - EDGE_STUB;
  const laneY = (sourceY + targetY) / 2;
  const path = [
    `M ${sourceX} ${sourceY}`,
    `H ${startX}`,
    `V ${laneY}`,
    `H ${endX}`,
    `V ${targetY}`,
    `H ${targetX}`,
  ].join(" ");

  return {
    path,
    labelX: (startX + endX) / 2,
    labelY: laneY,
    labelWidth: relationLabelWidth(label),
    runway: Math.abs(endX - startX),
  };
}
