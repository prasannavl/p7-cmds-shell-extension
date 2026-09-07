import { DEFAULT_WIN_OPTSIZE_CONFIG } from "./config.js";

export function cloneRect(rect) {
  if (!rect) return null;
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

export function rectEquals(left, right) {
  if (!left || !right) return left === right;
  return left.x === right.x && left.y === right.y &&
    left.width === right.width && left.height === right.height;
}

const OVERSIZED_EXACT_SCALE_FALLBACK = 0.95;

export function getNextOptsize(config, workArea, originalRect, index) {
  const scales = resolveWinOptsizeScales(config, workArea);
  const nextIndex = (index + 1) % (scales.length + 1);
  const target = nextIndex === scales.length
    ? originalRect
    : getScaledRect(config, workArea, scales[nextIndex]);
  return {
    index: nextIndex,
    rect: clampRectToWorkArea(target, workArea),
  };
}

export function resolveWinOptsizeScales(config, workArea) {
  let scales = config.scales ?? DEFAULT_WIN_OPTSIZE_CONFIG.scales;
  for (const breakpoint of config.breakpoints ?? []) {
    if (
      workArea.width <= breakpoint.maxWidth &&
      (breakpoint.maxHeight == null || workArea.height <= breakpoint.maxHeight)
    ) {
      if (breakpoint.scales?.length) scales = breakpoint.scales;
      break;
    }
  }
  return scales.length > 0 ? scales : DEFAULT_WIN_OPTSIZE_CONFIG.scales;
}

export function resolveScaleSize(scale, axisSize) {
  if (
    typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0 ||
    scale > axisSize
  ) {
    return Math.round(axisSize * OVERSIZED_EXACT_SCALE_FALLBACK);
  }
  return Math.round(scale <= 1 ? axisSize * scale : scale);
}

export function clampRectToWorkArea(rect, workArea) {
  const clamped = {};
  for (const { position, size } of RECT_AXES) {
    clamped[size] = Math.max(
      1,
      Math.min(Math.round(rect[size]), workArea[size]),
    );
    clamped[position] = clamp(
      Math.round(rect[position]),
      workArea[position],
      workArea[position] + workArea[size] - clamped[size],
    );
  }
  return clamped;
}

function getScaledRect(config, workArea, scale) {
  let [widthScale, heightScale] = scale;
  if (config.aspectBasedInversion && workArea.height > workArea.width) {
    [widthScale, heightScale] = [heightScale, widthScale];
  }
  const aspect = workArea.width / workArea.height;
  let width;
  let height;
  if (widthScale === null) {
    height = resolveScaleSize(heightScale, workArea.height);
    width = Math.round(height * aspect);
  } else {
    width = resolveScaleSize(widthScale, workArea.width);
    height = heightScale === null
      ? Math.round(width / aspect)
      : resolveScaleSize(heightScale, workArea.height);
  }
  return {
    x: workArea.x + (workArea.width - width) / 2,
    y: workArea.y + (workArea.height - height) / 2,
    width,
    height,
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(value, max));
}

export const MIN_RESIZE_SIZE = 10;
const RECT_AXES = [
  { position: "x", size: "width", near: "left", far: "right" },
  { position: "y", size: "height", near: "top", far: "bottom" },
];
const NO_EDGES = { left: false, right: false, top: false, bottom: false };

export function getPointDelta(fromPoint, toPoint) {
  return { x: toPoint.x - fromPoint.x, y: toPoint.y - fromPoint.y };
}

export function hasLockedEdges(edges) {
  return Boolean(edges?.left || edges?.right || edges?.top || edges?.bottom);
}

export function flipLockedEdges(edges) {
  if (!hasLockedEdges(edges)) return null;
  const flipped = {};
  for (const { near, far } of RECT_AXES) {
    flipped[near] = Boolean(edges[far]);
    flipped[far] = Boolean(edges[near]);
  }
  return flipped;
}

export function lockResizeEdges(edges, delta, point, rect) {
  const next = { ...NO_EDGES, ...edges };
  for (const { position, size, near, far } of RECT_AXES) {
    if (next[near] || next[far] || delta[position] === 0) continue;
    const nearDistance = Math.abs(point[position] - rect[position]);
    const farDistance = Math.abs(
      point[position] - (rect[position] + rect[size]),
    );
    if (delta[position] < 0) {
      next[far] = farDistance < nearDistance;
      next[near] = !next[far];
    } else {
      next[near] = nearDistance < farDistance;
      next[far] = !next[near];
    }
  }
  return next;
}

export function computeResizeRect(rect, edges, delta, minSize = {}) {
  if (!hasLockedEdges(edges)) return null;
  const resized = cloneRect(rect);
  for (const { position, size, near, far } of RECT_AXES) {
    const minimum = minSize[size] ?? MIN_RESIZE_SIZE;
    if (edges[near]) {
      const end = rect[position] + rect[size];
      resized[position] = Math.min(
        rect[position] + delta[position],
        end - minimum,
      );
      resized[size] = end - resized[position];
    } else if (edges[far]) {
      resized[size] = Math.max(rect[size] + delta[position], minimum);
    }
  }
  return resized;
}

export function preserveResizeAnchors(actual, requested, edges) {
  if (!actual || !requested || !edges) return actual;
  const rect = cloneRect(actual);
  for (const { position, size, near, far } of RECT_AXES) {
    if (edges[far]) rect[position] = requested[position];
    else if (edges[near]) {
      rect[position] = requested[position] + requested[size] - actual[size];
    }
  }
  return rect;
}
