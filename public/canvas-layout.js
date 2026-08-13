const DEFAULT_ENTITY_WIDTH = 244;
const DEFAULT_ENTITY_HEIGHT = 122;

export function connectionAnchors(a, b, width = DEFAULT_ENTITY_WIDTH, height = DEFAULT_ENTITY_HEIGHT) {
  const ac = { x: a.x + width / 2, y: a.y + height / 2 };
  const bc = { x: b.x + width / 2, y: b.y + height / 2 };
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return {
      from: { x: dx >= 0 ? a.x + width : a.x, y: ac.y },
      to: { x: dx >= 0 ? b.x : b.x + width, y: bc.y },
    };
  }
  return {
    from: { x: ac.x, y: dy >= 0 ? a.y + height : a.y },
    to: { x: bc.x, y: dy >= 0 ? b.y : b.y + height },
  };
}

export function captionAwareDetour(a, b, labelWidth, { width = DEFAULT_ENTITY_WIDTH, height = DEFAULT_ENTITY_HEIGHT, lane = 0 } = {}) {
  const ac = { x: a.x + width / 2, y: a.y + height / 2 };
  const bc = { x: b.x + width / 2, y: b.y + height / 2 };
  const horizontalGap = Math.abs(bc.x - ac.x) - width;
  const verticalGap = Math.abs(bc.y - ac.y) - height;
  const required = labelWidth + 28;
  if (Math.abs(bc.y - ac.y) < height * .35 && horizontalGap < required) {
    const baseline = Math.max(a.y + height, b.y + height) + 38 + lane;
    const from = { x: ac.x, y: a.y + height };
    const to = { x: bc.x, y: b.y + height };
    return { from, to, waypoints: [{ x: from.x, y: baseline }, { x: to.x, y: baseline }] };
  }
  if (Math.abs(bc.x - ac.x) < width * .35 && verticalGap < required) {
    const sideline = Math.max(a.x + width, b.x + width) + 38 + lane;
    const from = { x: a.x + width, y: ac.y };
    const to = { x: b.x + width, y: bc.y };
    return { from, to, waypoints: [{ x: sideline, y: from.y }, { x: sideline, y: to.y }] };
  }
  return null;
}

export function crossAreaDetour(a, b, sourceArea, targetArea, { width = DEFAULT_ENTITY_WIDTH, height = DEFAULT_ENTITY_HEIGHT, lane = 0, corridorOffset = 0 } = {}) {
  if (!sourceArea || !targetArea || sourceArea === targetArea) return null;
  const from = { x: a.x + width / 2, y: a.y + height };
  const to = { x: b.x + width / 2, y: b.y + height };
  const sourceLaneY = from.y + 38 + lane;
  const targetLaneY = to.y + 38 + lane;
  const sourceRight = sourceArea.x + sourceArea.width;
  const targetRight = targetArea.x + targetArea.width;
  let corridorX;
  if (sourceRight <= targetArea.x) corridorX = (sourceRight + targetArea.x) / 2 + corridorOffset;
  else if (targetRight <= sourceArea.x) corridorX = (targetRight + sourceArea.x) / 2 + corridorOffset;
  else {
    const rightCost = sourceRight - from.x + targetRight - to.x;
    const leftCost = from.x - sourceArea.x + to.x - targetArea.x;
    corridorX = rightCost <= leftCost
      ? Math.max(sourceRight, targetRight) + 28 + lane
      : Math.min(sourceArea.x, targetArea.x) - 28 - lane;
  }
  return {
    from,
    to,
    waypoints: [
      { x: from.x, y: sourceLaneY },
      { x: corridorX, y: sourceLaneY },
      { x: corridorX, y: targetLaneY },
      { x: to.x, y: targetLaneY },
    ],
  };
}

export function paddedBox(position, width, height, padding = 0) {
  return {
    x: position.x - padding,
    y: position.y - padding,
    width: width + padding * 2,
    height: height + padding * 2,
  };
}

export function boxesOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function packAreaRectangles(rectangles, { margin = 70, gap = 74, aspect = 1.6 } = {}) {
  const normalized = rectangles.map((item) => ({ ...item, width: Number(item.width), height: Number(item.height) }));
  const widest = Math.max(1, ...normalized.map((item) => item.width));
  const footprint = normalized.reduce((sum, item) => sum + (item.width + gap) * (item.height + gap), 0);
  const targetWidth = Math.max(widest, Math.sqrt(Math.max(1, footprint) * aspect));
  const positions = new Map();
  let cursorX = margin;
  let cursorY = margin;
  let rowHeight = 0;

  for (const item of normalized) {
    if (cursorX > margin && cursorX + item.width > margin + targetWidth) {
      cursorX = margin;
      cursorY += rowHeight + gap;
      rowHeight = 0;
    }
    const automatic = { x: cursorX, y: cursorY, width: item.width, height: item.height };
    positions.set(item.id, {
      ...automatic,
      x: Number.isFinite(Number(item.x)) ? Number(item.x) : automatic.x,
      y: Number.isFinite(Number(item.y)) ? Number(item.y) : automatic.y,
    });
    cursorX += item.width + gap;
    rowHeight = Math.max(rowHeight, item.height);
  }
  return positions;
}

function roundedOrthogonalPath(points, radius = 18) {
  if (points.length < 3) return `M ${points[0].x} ${points[0].y} L ${points.at(-1).x} ${points.at(-1).y}`;
  const parts = [`M ${points[0].x} ${points[0].y}`];
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    const incoming = Math.hypot(current.x - previous.x, current.y - previous.y);
    const outgoing = Math.hypot(next.x - current.x, next.y - current.y);
    const corner = Math.min(radius, incoming / 2, outgoing / 2);
    const entry = {
      x: current.x + (previous.x - current.x) * corner / Math.max(1, incoming),
      y: current.y + (previous.y - current.y) * corner / Math.max(1, incoming),
    };
    const exit = {
      x: current.x + (next.x - current.x) * corner / Math.max(1, outgoing),
      y: current.y + (next.y - current.y) * corner / Math.max(1, outgoing),
    };
    parts.push(`L ${entry.x} ${entry.y} Q ${current.x} ${current.y} ${exit.x} ${exit.y}`);
  }
  parts.push(`L ${points.at(-1).x} ${points.at(-1).y}`);
  return parts.join(" ");
}

function pointOnPolyline(points, progress) {
  const segments = points.slice(1).map((point, index) => ({
    from: points[index],
    to: point,
    length: Math.hypot(point.x - points[index].x, point.y - points[index].y),
  })).filter((segment) => segment.length > 0);
  const total = Math.max(1, segments.reduce((sum, segment) => sum + segment.length, 0));
  let remaining = Math.max(0, Math.min(1, progress)) * total;
  const segment = segments.find((item) => {
    if (remaining <= item.length) return true;
    remaining -= item.length;
    return false;
  }) || segments.at(-1);
  const ratio = Math.min(1, remaining / Math.max(1, segment.length));
  return {
    x: segment.from.x + (segment.to.x - segment.from.x) * ratio,
    y: segment.from.y + (segment.to.y - segment.from.y) * ratio,
    tangent: { x: segment.to.x - segment.from.x, y: segment.to.y - segment.from.y },
  };
}

export function relationCurve(from, to, { laneOffset = 0, radius = 34, waypoints = null } = {}) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  let points;
  if (waypoints?.length) {
    points = [from, ...waypoints, to];
  } else if (Math.abs(dx) < 1 || Math.abs(dy) < 1) {
    points = [from, to];
  } else if (Math.abs(dx) >= Math.abs(dy)) {
    const margin = Math.min(36, Math.abs(dx) / 3);
    const low = Math.min(from.x, to.x) + margin;
    const high = Math.max(from.x, to.x) - margin;
    const middle = Math.max(low, Math.min(high, (from.x + to.x) / 2 + laneOffset));
    points = [from, { x: middle, y: from.y }, { x: middle, y: to.y }, to];
  } else {
    const margin = Math.min(36, Math.abs(dy) / 3);
    const low = Math.min(from.y, to.y) + margin;
    const high = Math.max(from.y, to.y) - margin;
    const middle = Math.max(low, Math.min(high, (from.y + to.y) / 2 + laneOffset));
    points = [from, { x: from.x, y: middle }, { x: to.x, y: middle }, to];
  }
  return {
    d: roundedOrthogonalPath(points, radius),
    pointAt: (progress) => pointOnPolyline(points, progress),
    tangentAt: (progress) => pointOnPolyline(points, progress).tangent,
  };
}

export function sampleRelationCurve(curve, steps = 100) {
  return Array.from({ length: steps + 1 }, (_, index) => {
    const progress = index / steps;
    const point = curve.pointAt(progress);
    const tangent = curve.tangentAt(progress);
    let angle = Math.atan2(tangent.y, tangent.x) * 180 / Math.PI;
    if (angle > 90) angle -= 180;
    if (angle < -90) angle += 180;
    return { ...point, angle, progress };
  });
}

function rotatedBox(point, width, height) {
  const radians = point.angle * Math.PI / 180;
  const boxWidth = Math.abs(Math.cos(radians)) * width + Math.abs(Math.sin(radians)) * height;
  const boxHeight = Math.abs(Math.sin(radians)) * width + Math.abs(Math.cos(radians)) * height;
  return {
    x: point.x - boxWidth / 2,
    y: point.y - boxHeight / 2,
    width: boxWidth,
    height: boxHeight,
    centerX: point.x,
    centerY: point.y,
    captionWidth: width,
    captionHeight: height,
    angle: point.angle,
  };
}

function projectedRadius(box, axis) {
  const radians = box.angle * Math.PI / 180;
  const horizontal = { x: Math.cos(radians), y: Math.sin(radians) };
  const vertical = { x: -horizontal.y, y: horizontal.x };
  return Math.abs(horizontal.x * axis.x + horizontal.y * axis.y) * box.captionWidth / 2
    + Math.abs(vertical.x * axis.x + vertical.y * axis.y) * box.captionHeight / 2;
}

export function captionShapesOverlap(a, b) {
  if (![a, b].every((box) => Number.isFinite(box?.angle))) return boxesOverlap(a, b);
  const angles = [a.angle, a.angle + 90, b.angle, b.angle + 90];
  const delta = { x: b.centerX - a.centerX, y: b.centerY - a.centerY };
  return angles.every((angle) => {
    const radians = angle * Math.PI / 180;
    const axis = { x: Math.cos(radians), y: Math.sin(radians) };
    const distance = Math.abs(delta.x * axis.x + delta.y * axis.y);
    return distance < projectedRadius(a, axis) + projectedRadius(b, axis);
  });
}

export function chooseFloatingCaption({ samples, currentProgress = .5, width, height, viewport, obstacles = [], occupied = [] }) {
  const centerIndex = Math.max(1, Math.min(samples.length - 2, Math.round(currentProgress * (samples.length - 1))));
  for (let distance = 0; distance < samples.length; distance += 1) {
    const indices = distance === 0 ? [centerIndex] : [centerIndex - distance, centerIndex + distance];
    for (const index of indices) {
      if (index < 1 || index >= samples.length - 1) continue;
      const sample = samples[index];
      const point = { ...sample, box: rotatedBox(sample, width, height) };
      const visible = point.box.x >= viewport.x
        && point.box.y >= viewport.y
        && point.box.x + point.box.width <= viewport.x + viewport.width
        && point.box.y + point.box.height <= viewport.y + viewport.height;
      if (!visible || occupied.some((box) => captionShapesOverlap(point.box, box))) continue;
      if (!obstacles.some((box) => boxesOverlap(point.box, box))) return point;
    }
  }
  return null;
}

export function anchoredZoomTransform(current, nextScale, anchor) {
  const scale = Number(current.scale);
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(nextScale) || nextScale <= 0) return current;
  const worldX = (anchor.x - current.x) / scale;
  const worldY = (anchor.y - current.y) / scale;
  return {
    scale: nextScale,
    x: anchor.x - worldX * nextScale,
    y: anchor.y - worldY * nextScale,
  };
}

export function placeRelationLabel(label, from, to, occupied = []) {
  const width = Math.min(190, Math.max(48, String(label).length * 5.2 + 18));
  const height = 22;
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.max(1, Math.hypot(dx, dy));
  const normal = { x: -dy / length, y: dx / length };
  const candidates = [
    [.5, 0], [.5, 26], [.5, -26],
    [.36, 0], [.64, 0], [.36, 26], [.64, -26],
    [.5, 52], [.5, -52], [.28, 0], [.72, 0],
  ];
  for (const [progress, offset] of candidates) {
    const x = from.x + dx * progress + normal.x * offset;
    const y = from.y + dy * progress + normal.y * offset;
    const box = { x: x - width / 2, y: y - height / 2, width, height };
    if (!occupied.some((item) => boxesOverlap(box, item))) return { x, y, width, height, box };
  }
  return null;
}
