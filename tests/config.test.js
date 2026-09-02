import {
  acceleratorsEqual,
  cloneWinOptsizeConfig,
  DEFAULT_INDICATOR_BACKGROUND_COLOR,
  DEFAULT_INDICATOR_BORDER,
  DEFAULT_INDICATOR_BORDER_COLOR,
  DEFAULT_WIN_OPTSIZE_CONFIG,
  isValidAccelerator,
  normalizeIndicatorBorderSize,
  normalizeWinOptsizeConfig,
  parseEnumValue,
  parseWinOptsizeConfig,
  resolveIndicatorConfig,
  sanitizeKeybindings,
} from "../common/config.js";
import { assert, assertEquals, assertNotEquals } from "./testlib.js";

Deno.test("default config clones do not share nested values", () => {
  const first = cloneWinOptsizeConfig();
  const second = cloneWinOptsizeConfig();
  first.scales[0][0] = 0.1;
  assertNotEquals(first.scales[0][0], second.scales[0][0]);
  assertEquals(second, DEFAULT_WIN_OPTSIZE_CONFIG);
});

Deno.test("partial optsize config inherits every omitted default", () => {
  const result = normalizeWinOptsizeConfig({ aspectBasedInversion: true });
  assertEquals(result, {
    ok: true,
    value: {
      aspectBasedInversion: true,
      scales: DEFAULT_WIN_OPTSIZE_CONFIG.scales,
      breakpoints: DEFAULT_WIN_OPTSIZE_CONFIG.breakpoints,
    },
    error: null,
  });
});

Deno.test("valid scales accept fractional, exact, and automatic height", () => {
  const result = normalizeWinOptsizeConfig({
    scales: [[0.5, 0.8], [1200, 800], [0.6, null]],
    breakpoints: [],
  });
  assert(result.ok);
  assertEquals(result.value.scales, [[0.5, 0.8], [1200, 800], [0.6, null]]);
});

for (
  const [value, error] of [
    [null, "Config must be an object."],
    [[], "Config must be an object."],
    [{ scales: "wide" }, "Scales must be an array."],
    [{ scales: [[0.5, "tall"]] }, "Scales has invalid scale at index 0."],
    [{ scales: [[0, 0.5]] }, "Scales has invalid scale at index 0."],
    [{ scales: [[0.5, -1]] }, "Scales has invalid scale at index 0."],
    [{ breakpoints: {} }, "Breakpoints must be an array."],
    [{ breakpoints: [null] }, "Invalid breakpoint at index 0."],
    [{ breakpoints: [{}] }, "Breakpoint 0 must define a positive maxWidth."],
    [
      { breakpoints: [{ maxWidth: 0 }] },
      "Breakpoint 0 must define a positive maxWidth.",
    ],
    [
      { breakpoints: [{ maxWidth: 100, maxHeight: "high" }] },
      "Breakpoint 0 has invalid maxHeight.",
    ],
    [
      { aspectBasedInversion: "yes" },
      "aspectBasedInversion must be boolean.",
    ],
  ]
) {
  Deno.test(`invalid optsize config: ${error}`, () => {
    const result = normalizeWinOptsizeConfig(value);
    assertEquals(result.ok, false);
    assertEquals(result.error, error);
  });
}

Deno.test("JSON parsing reports syntax and semantic errors", () => {
  assertEquals(parseWinOptsizeConfig(3).error, "Expected a JSON string.");
  assertEquals(parseWinOptsizeConfig(" ").error, "JSON is empty.");
  assertEquals(parseWinOptsizeConfig("{").ok, false);
  assertEquals(
    parseWinOptsizeConfig('{"scales":"wide"}').error,
    "Scales must be an array.",
  );
});

Deno.test("keybinding sanitization trims, validates, and deduplicates", () => {
  const knownKeys = new Set(["x", "F12"]);
  const normalizeKey = (key) => knownKeys.has(key) ? key : null;
  assertEquals(
    sanitizeKeybindings([
      " <Super>x ",
      "<Super>x",
      "",
      "<Super><Shift>x",
      "<Shift><Super>x",
      "<broken",
      "<Bogus>x",
      "<Super>DefinitelyNotAKey",
      4,
    ], normalizeKey),
    ["<Super>x", "<Super><Shift>x"],
  );
  assertEquals(sanitizeKeybindings(null), []);
  assertEquals(isValidAccelerator("<Primary>F12", normalizeKey), true);
  assertEquals(isValidAccelerator("<Mod2>F12", normalizeKey), true);
  assertEquals(isValidAccelerator("<Release>F12", normalizeKey), true);
  assertEquals(
    acceleratorsEqual(
      "<Super><Shift>x",
      "<Shift><Super>x",
      normalizeKey,
    ),
    true,
  );
});

Deno.test("enum values accept names and numeric strings with a fallback", () => {
  const values = { NONE: 0, NORMAL: 1 };
  assertEquals(parseEnumValue("normal", values, 9), 1);
  assertEquals(parseEnumValue(" 4 ", values, 9), 4);
  assertEquals(parseEnumValue("future", values, 9), 9);
  assertEquals(parseEnumValue(null, values, 9), 9);
});

Deno.test("indicator config accepts safe colors and positive sizes", () => {
  assertEquals(
    resolveIndicatorConfig({
      winMouseResize: {
        borderColor: " #abc ",
        backgroundColor: "hsla(1, 2%, 3%, 0.4)",
        borderSize: 4.6,
      },
    }),
    {
      colors: { borderColor: "#abc", backgroundColor: "hsla(1, 2%, 3%, 0.4)" },
      borderSize: 5,
    },
  );
});

Deno.test("indicator config rejects CSS injection and invalid sizes", () => {
  assertEquals(
    resolveIndicatorConfig({
      winMouseResize: {
        borderColor: "red; background: white",
        backgroundColor: "blue\ncolor: red",
        borderSize: 0,
      },
    }),
    {
      colors: {
        borderColor: DEFAULT_INDICATOR_BORDER_COLOR,
        backgroundColor: DEFAULT_INDICATOR_BACKGROUND_COLOR,
      },
      borderSize: DEFAULT_INDICATOR_BORDER,
    },
  );
  assertEquals(
    normalizeIndicatorBorderSize(Number.NaN),
    DEFAULT_INDICATOR_BORDER,
  );
});
