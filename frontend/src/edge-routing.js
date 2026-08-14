const NODE_WIDTH = 304;
const EDGE_STUB = 24;
const OBSTACLE_CLEARANCE = 18;
const BEND_COST = 18;
const LABEL_MIN_WIDTH = 88;
const LABEL_MAX_WIDTH = 550;

export function relationLabelWidth(label) {
  return Math.min(LABEL_MAX_WIDTH, Math.max(LABEL_MIN_WIDTH, String(label || "").length * 5.35 + 26));
}

export function focusColumnOffset(relations = []) {
  const labelWidth = Math.max(LABEL_MIN_WIDTH, ...relations.map((relation) => relationLabelWidth(relation.ownerLabel || relation.label)));
  // The center runway remains wider than the rendered caption after both edge stubs.
  return NODE_WIDTH + labelWidth + EDGE_STUB * 2 + 24;
}

function paddedRectangle(rectangle, padding = OBSTACLE_CLEARANCE) {
  return {
    x: Number(rectangle.x) - padding,
    y: Number(rectangle.y) - padding,
    width: Number(rectangle.width) + padding * 2,
    height: Number(rectangle.height) + padding * 2,
  };
}

function rectanglesOverlap(left, right) {
  return left.x <= right.x + right.width && left.x + left.width >= right.x
    && left.y <= right.y + right.height && left.y + left.height >= right.y;
}

function mergeObstacles(rectangles) {
  const merged = rectangles.map((rectangle) => ({ ...rectangle }));
  for (let leftIndex = 0; leftIndex < merged.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < merged.length;) {
      const left = merged[leftIndex];
      const right = merged[rightIndex];
      if (!rectanglesOverlap(left, right)) {
        rightIndex += 1;
        continue;
      }
      const x = Math.min(left.x, right.x);
      const y = Math.min(left.y, right.y);
      merged[leftIndex] = {
        x,
        y,
        width: Math.max(left.x + left.width, right.x + right.width) - x,
        height: Math.max(left.y + left.height, right.y + right.height) - y,
      };
      merged.splice(rightIndex, 1);
      leftIndex = -1;
      break;
    }
  }
  return merged;
}

function segmentIntersectsRectangle(from, to, rectangle) {
  if (Math.abs(from.y - to.y) < .01) {
    return from.y > rectangle.y && from.y < rectangle.y + rectangle.height
      && Math.max(from.x, to.x) > rectangle.x && Math.min(from.x, to.x) < rectangle.x + rectangle.width;
  }
  if (Math.abs(from.x - to.x) < .01) {
    return from.x > rectangle.x && from.x < rectangle.x + rectangle.width
      && Math.max(from.y, to.y) > rectangle.y && Math.min(from.y, to.y) < rectangle.y + rectangle.height;
  }
  return false;
}

function simplifyPoints(points) {
  const unique = points.filter((point, index) => index === 0
    || Math.abs(point.x - points[index - 1].x) > .01
    || Math.abs(point.y - points[index - 1].y) > .01);
  const simplified = [];
  for (const point of unique) {
    const previous = simplified.at(-1);
    const before = simplified.at(-2);
    if (before && previous
      && ((Math.abs(before.x - previous.x) < .01 && Math.abs(previous.x - point.x) < .01)
        || (Math.abs(before.y - previous.y) < .01 && Math.abs(previous.y - point.y) < .01))) {
      simplified[simplified.length - 1] = point;
    } else {
      simplified.push(point);
    }
  }
  return simplified;
}

function routeLength(points) {
  return points.slice(1).reduce((sum, point, index) => sum
    + Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y), 0);
}

function collisionCount(points, obstacles) {
  return points.slice(1).reduce((count, point, index) => count
    + obstacles.filter((obstacle) => segmentIntersectsRectangle(points[index], point, obstacle)).length, 0);
}

function detoursAround(from, to, obstacle) {
  if (Math.abs(from.y - to.y) < .01) {
    const forward = to.x >= from.x;
    const entryX = forward ? obstacle.x : obstacle.x + obstacle.width;
    const exitX = forward ? obstacle.x + obstacle.width : obstacle.x;
    return [obstacle.y, obstacle.y + obstacle.height].map((laneY) => [
      from,
      { x: entryX, y: from.y },
      { x: entryX, y: laneY },
      { x: exitX, y: laneY },
      { x: exitX, y: to.y },
      to,
    ]);
  }
  const forward = to.y >= from.y;
  const entryY = forward ? obstacle.y : obstacle.y + obstacle.height;
  const exitY = forward ? obstacle.y + obstacle.height : obstacle.y;
  return [obstacle.x, obstacle.x + obstacle.width].map((laneX) => [
    from,
    { x: from.x, y: entryY },
    { x: laneX, y: entryY },
    { x: laneX, y: exitY },
    { x: to.x, y: exitY },
    to,
  ]);
}

function avoidObstacles(initialPoints, obstacles) {
  let points = simplifyPoints(initialPoints);
  for (let attempt = 0; attempt < 96; attempt += 1) {
    let collision = null;
    for (let segmentIndex = 0; segmentIndex < points.length - 1 && !collision; segmentIndex += 1) {
      const from = points[segmentIndex];
      const to = points[segmentIndex + 1];
      const candidates = obstacles.filter((obstacle) => segmentIntersectsRectangle(from, to, obstacle));
      if (!candidates.length) continue;
      const horizontal = Math.abs(from.y - to.y) < .01;
      const nearest = candidates.sort((left, right) => {
        const leftEntry = horizontal ? Math.min(Math.abs(left.x - from.x), Math.abs(left.x + left.width - from.x))
          : Math.min(Math.abs(left.y - from.y), Math.abs(left.y + left.height - from.y));
        const rightEntry = horizontal ? Math.min(Math.abs(right.x - from.x), Math.abs(right.x + right.width - from.x))
          : Math.min(Math.abs(right.y - from.y), Math.abs(right.y + right.height - from.y));
        return leftEntry - rightEntry;
      })[0];
      collision = { segmentIndex, from, to, obstacle: nearest };
    }
    if (!collision) return points;

    const alternatives = detoursAround(collision.from, collision.to, collision.obstacle)
      .map(simplifyPoints)
      .map((candidate) => ({
        candidate,
        score: routeLength(candidate) + BEND_COST * Math.max(0, candidate.length - 2)
          + collisionCount(candidate, obstacles) * 1_000_000,
      }))
      .sort((left, right) => left.score - right.score);
    points.splice(collision.segmentIndex, 2, ...alternatives[0].candidate);
    points = simplifyPoints(points);
  }
  return points;
}

function pathFromPoints(points) {
  const parts = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 1; index < points.length; index += 1) {
    const point = points[index];
    const previous = points[index - 1];
    if (Math.abs(previous.y - point.y) < .01) parts.push(`H ${point.x}`);
    else parts.push(`V ${point.y}`);
  }
  return parts.join(" ");
}

function labelSegment(points) {
  const segments = points.slice(1).map((to, index) => ({
    from: points[index],
    to,
    horizontal: Math.abs(points[index].y - to.y) < .01,
    length: Math.abs(points[index].x - to.x) + Math.abs(points[index].y - to.y),
  }));
  return segments.filter((segment) => segment.horizontal).sort((left, right) => right.length - left.length)[0]
    || segments.sort((left, right) => right.length - left.length)[0];
}

export function orthogonalRelationPath({ sourceX, sourceY, targetX, targetY, label, obstacles = [] }) {
  const startX = sourceX + EDGE_STUB;
  const endX = targetX - EDGE_STUB;
  const laneY = (sourceY + targetY) / 2;
  const validObstacles = mergeObstacles(obstacles
    .filter((rectangle) => [rectangle.x, rectangle.y, rectangle.width, rectangle.height].every(Number.isFinite))
    .map((rectangle) => paddedRectangle(rectangle)));
  const points = avoidObstacles([
    { x: sourceX, y: sourceY },
    { x: startX, y: sourceY },
    { x: startX, y: laneY },
    { x: endX, y: laneY },
    { x: endX, y: targetY },
    { x: targetX, y: targetY },
  ], validObstacles);
  const labelLane = labelSegment(points);
  const labelX = (labelLane.from.x + labelLane.to.x) / 2;
  const labelY = (labelLane.from.y + labelLane.to.y) / 2;

  return {
    path: pathFromPoints(points),
    points,
    labelX,
    labelY,
    labelWidth: relationLabelWidth(label),
    runway: labelLane.length,
  };
}
