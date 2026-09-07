import { DEFAULT_WIN_OPTSIZE_CONFIG } from "../common/config.js";
import {
  clampRectToWorkArea,
  getNextOptsize,
  resolveScaleSize,
  resolveWinOptsizeScales,
} from "../common/window.js";
import { assertEquals } from "./testlib.js";

const workArea = { x: 100, y: 50, width: 1000, height: 800 };

Deno.test("breakpoints select the first matching width and height", () => {
  const config = {
    scales: [[0.2, 0.2]],
    breakpoints: [
      { maxWidth: 1000, maxHeight: 700, scales: [[0.3, 0.3]] },
      { maxWidth: 1000, scales: [[0.6, 0.7]] },
    ],
  };
  assertEquals(resolveWinOptsizeScales(config, workArea), [[0.6, 0.7]]);
});

Deno.test("empty configured scales fall back to shipped scales", () => {
  assertEquals(
    resolveWinOptsizeScales({ scales: [], breakpoints: [] }, workArea),
    DEFAULT_WIN_OPTSIZE_CONFIG.scales,
  );
});

Deno.test("empty breakpoint scales inherit the configured scales", () => {
  const scales = [[0.4, 0.6]];
  assertEquals(
    resolveWinOptsizeScales({
      scales,
      breakpoints: [{ maxWidth: 1000, scales: [] }],
    }, workArea),
    scales,
  );
});

Deno.test("scale sizes support fractions, pixels, and bounds", () => {
  assertEquals(resolveScaleSize(0.5, 1000), 500);
  assertEquals(resolveScaleSize(640, 1000), 640);
  assertEquals(resolveScaleSize(1200, 1000), 950);
  assertEquals(resolveScaleSize(0, 1000), 950);
  assertEquals(resolveScaleSize(-1, 1000), 950);
});

Deno.test("optsize cycles through configured scales and original geometry", () => {
  const config = {
    aspectBasedInversion: false,
    scales: [[0.5, 0.5], [600, null]],
    breakpoints: [],
  };
  const original = { x: 150, y: 80, width: 400, height: 300 };
  const first = getNextOptsize(config, workArea, original, -1);
  assertEquals(first, {
    index: 0,
    rect: { x: 350, y: 250, width: 500, height: 400 },
  });
  const second = getNextOptsize(config, workArea, original, first.index);
  assertEquals(second, {
    index: 1,
    rect: { x: 300, y: 210, width: 600, height: 480 },
  });
  const restored = getNextOptsize(config, workArea, original, second.index);
  assertEquals(restored, { index: 2, rect: original });
  assertEquals(
    getNextOptsize(config, workArea, original, restored.index),
    first,
  );
});

Deno.test("portrait inversion swaps configured width and height scales", () => {
  const portrait = { x: 0, y: 0, width: 800, height: 1200 };
  const result = getNextOptsize(
    {
      aspectBasedInversion: true,
      scales: [[0.5, 0.75]],
      breakpoints: [],
    },
    portrait,
    { x: 0, y: 0, width: 10, height: 10 },
    -1,
  );
  assertEquals(result.rect, { x: 100, y: 300, width: 600, height: 600 });
});

Deno.test("portrait inversion preserves automatic aspect sizing", () => {
  const portrait = { x: 0, y: 0, width: 800, height: 1200 };
  const result = getNextOptsize(
    {
      aspectBasedInversion: true,
      scales: [[0.5, null]],
      breakpoints: [],
    },
    portrait,
    { x: 0, y: 0, width: 10, height: 10 },
    -1,
  );
  assertEquals(result.rect, { x: 200, y: 300, width: 400, height: 600 });
});

Deno.test("restored geometry is clamped inside the current work area", () => {
  assertEquals(
    clampRectToWorkArea(
      { x: -500, y: 900, width: 2000, height: 100 },
      workArea,
    ),
    { x: 100, y: 750, width: 1000, height: 100 },
  );
});
