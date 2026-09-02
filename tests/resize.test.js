import {
  computeResizeRect,
  flipLockedEdges,
  getPointDelta,
  lockResizeEdges,
  preserveResizeAnchors,
} from "../common/window.js";
import { isSuperArrowBinding } from "../common/config.js";
import { assertEquals } from "./testlib.js";

const rect = { x: 100, y: 200, width: 500, height: 400 };

Deno.test("point deltas preserve direction", () => {
  assertEquals(getPointDelta({ x: 9, y: 20 }, { x: 4, y: 31 }), {
    x: -5,
    y: 11,
  });
});

Deno.test("edge locking chooses the edge implied by pointer direction", () => {
  assertEquals(
    lockResizeEdges(null, { x: -1, y: 1 }, { x: 590, y: 210 }, rect),
    { left: false, right: true, top: true, bottom: false },
  );
  assertEquals(
    lockResizeEdges(null, { x: 1, y: -1 }, { x: 110, y: 590 }, rect),
    { left: true, right: false, top: false, bottom: true },
  );
});

Deno.test("locked edges remain stable across later pointer reversals", () => {
  const locked = { left: true, right: false, top: false, bottom: true };
  assertEquals(
    lockResizeEdges(locked, { x: -10, y: -10 }, { x: 600, y: 200 }, rect),
    locked,
  );
});

Deno.test("flipping swaps each locked edge and ignores empty state", () => {
  assertEquals(
    flipLockedEdges({ left: true, right: false, top: false, bottom: true }),
    { left: false, right: true, top: true, bottom: false },
  );
  assertEquals(flipLockedEdges(null), null);
});

for (
  const [name, edges, delta, expected] of [
    ["left", { left: true }, { x: -40, y: 0 }, {
      x: 60,
      y: 200,
      width: 540,
      height: 400,
    }],
    ["right", { right: true }, { x: 40, y: 0 }, {
      x: 100,
      y: 200,
      width: 540,
      height: 400,
    }],
    ["top", { top: true }, { x: 0, y: -50 }, {
      x: 100,
      y: 150,
      width: 500,
      height: 450,
    }],
    ["bottom", { bottom: true }, { x: 0, y: 50 }, {
      x: 100,
      y: 200,
      width: 500,
      height: 450,
    }],
  ]
) {
  Deno.test(`${name} edge resizing preserves the opposite anchor`, () => {
    assertEquals(computeResizeRect(rect, edges, delta), expected);
  });
}

Deno.test("resize geometry enforces window minimum size", () => {
  assertEquals(
    computeResizeRect(rect, { left: true, top: true }, { x: 1000, y: 1000 }, {
      width: 120,
      height: 80,
    }),
    { x: 480, y: 520, width: 120, height: 80 },
  );
  assertEquals(computeResizeRect(rect, null, { x: 10, y: 10 }), null);
});

Deno.test("Mutter size corrections preserve requested fixed anchors", () => {
  const requested = { x: 90, y: 180, width: 510, height: 420 };
  const actual = { x: 95, y: 190, width: 500, height: 400 };
  assertEquals(
    preserveResizeAnchors(actual, requested, { left: true, top: true }),
    { x: 100, y: 200, width: 500, height: 400 },
  );
  assertEquals(
    preserveResizeAnchors(actual, requested, { right: true, bottom: true }),
    { x: 90, y: 180, width: 500, height: 400 },
  );
});

Deno.test("only Super arrow accelerators are suppressed", () => {
  for (const key of ["Left", "Right", "Up", "Down", "KP_Left", "KP_Right"]) {
    assertEquals(isSuperArrowBinding(`<Super>${key}`), true);
  }
  assertEquals(isSuperArrowBinding("<Super>x"), false);
  assertEquals(isSuperArrowBinding("<Control>Left"), false);
  assertEquals(isSuperArrowBinding("<shift><super>Left"), true);
});
