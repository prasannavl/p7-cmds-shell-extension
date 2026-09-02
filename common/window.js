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
    ? cloneRect(originalRect)
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

export function resolveScaleSize(scale, axisSize, targetWidth, aspect) {
  if (scale === null && targetWidth != null) {
    return Math.round(targetWidth / aspect);
  }
  if (
    typeof scale !== "number" || !Number.isFinite(scale) || scale <= 0 ||
    scale > axisSize
  ) {
    return Math.round(axisSize * OVERSIZED_EXACT_SCALE_FALLBACK);
  }
  return Math.round(scale <= 1 ? axisSize * scale : scale);
}

export function clampRectToWorkArea(rect, workArea) {
  const width = Math.max(1, Math.min(Math.round(rect.width), workArea.width));
  const height = Math.max(
    1,
    Math.min(Math.round(rect.height), workArea.height),
  );
  return {
    x: clamp(
      Math.round(rect.x),
      workArea.x,
      workArea.x + workArea.width - width,
    ),
    y: clamp(
      Math.round(rect.y),
      workArea.y,
      workArea.y + workArea.height - height,
    ),
    width,
    height,
  };
}

function getScaledRect(config, workArea, scale) {
  let [widthScale, heightScale] = scale;
  if (config.aspectBasedInversion && workArea.height > workArea.width) {
    [widthScale, heightScale] = [heightScale, widthScale];
  }
  const width = resolveScaleSize(widthScale, workArea.width);
  const height = resolveScaleSize(
    heightScale,
    workArea.height,
    width,
    workArea.width / workArea.height,
  );
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

export function getPointDelta(fromPoint, toPoint) {
  return { x: toPoint.x - fromPoint.x, y: toPoint.y - fromPoint.y };
}

export function hasLockedEdges(edges) {
  return Boolean(edges?.left || edges?.right || edges?.top || edges?.bottom);
}

export function flipLockedEdges(edges) {
  if (!hasLockedEdges(edges)) return null;
  return {
    left: Boolean(edges.right),
    right: Boolean(edges.left),
    top: Boolean(edges.bottom),
    bottom: Boolean(edges.top),
  };
}

export function lockResizeEdges(edges, delta, point, rect) {
  const next = edges
    ? { ...edges }
    : { left: false, right: false, top: false, bottom: false };
  if (!next.left && !next.right && delta.x !== 0) {
    const leftDistance = Math.abs(point.x - rect.x);
    const rightDistance = Math.abs(point.x - (rect.x + rect.width));
    const nearestIsRight = rightDistance < leftDistance;
    if (delta.x < 0) {
      next.right = nearestIsRight;
      next.left = !nearestIsRight;
    } else {
      next.left = leftDistance < rightDistance;
      next.right = !next.left;
    }
  }
  if (!next.top && !next.bottom && delta.y !== 0) {
    const topDistance = Math.abs(point.y - rect.y);
    const bottomDistance = Math.abs(point.y - (rect.y + rect.height));
    const nearestIsBottom = bottomDistance < topDistance;
    if (delta.y < 0) {
      next.bottom = nearestIsBottom;
      next.top = !nearestIsBottom;
    } else {
      next.top = topDistance < bottomDistance;
      next.bottom = !next.top;
    }
  }
  return next;
}

export function computeResizeRect(rect, edges, delta, minSize = {}) {
  if (!hasLockedEdges(edges)) return null;
  const minWidth = minSize.width ?? MIN_RESIZE_SIZE;
  const minHeight = minSize.height ?? MIN_RESIZE_SIZE;
  let left = rect.x;
  let right = rect.x + rect.width;
  let top = rect.y;
  let bottom = rect.y + rect.height;

  if (edges.left) left = Math.min(rect.x + delta.x, right - minWidth);
  else if (edges.right) {
    right = Math.max(rect.x + rect.width + delta.x, left + minWidth);
  }
  if (edges.top) top = Math.min(rect.y + delta.y, bottom - minHeight);
  else if (edges.bottom) {
    bottom = Math.max(rect.y + rect.height + delta.y, top + minHeight);
  }

  return { x: left, y: top, width: right - left, height: bottom - top };
}

export function preserveResizeAnchors(actual, requested, edges) {
  if (!actual || !requested || !edges) return actual;
  const rect = cloneRect(actual);
  if (edges.right) rect.x = requested.x;
  else if (edges.left) rect.x = requested.x + requested.width - actual.width;
  if (edges.bottom) rect.y = requested.y;
  else if (edges.top) rect.y = requested.y + requested.height - actual.height;
  return rect;
}
