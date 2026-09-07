import {
  acceleratorsEqual,
  cloneWinOptsizeConfig,
  DEFAULT_WIN_OPTSIZE_CONFIG,
  FULL_CONFIG_FORMAT_VERSION,
  normalizeFullConfig,
  normalizeWinOptsizeConfig,
  parseEnumValue,
  parseWinOptsizeConfig,
  sanitizeCssColor,
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
    [{ scales: [[0.5]] }, "Scales has invalid scale at index 0."],
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
  assertEquals(parseWinOptsizeConfig(" ").error, "JSON is empty.");
  assertEquals(parseWinOptsizeConfig("{").ok, false);
  assertEquals(
    parseWinOptsizeConfig('{"scales":"wide"}').error,
    "Scales must be an array.",
  );
});

Deno.test("CSS colors cannot escape their generated declaration", () => {
  const fallback = "transparent";
  assertEquals(
    sanitizeCssColor(" color-mix(in srgb, red 25%, blue) ", fallback),
    "color-mix(in srgb, red 25%, blue)",
  );
  for (const value of ["", "red; color: blue", "red\ncolor: blue", "red{}"]) {
    assertEquals(sanitizeCssColor(value, fallback), fallback);
  }
});

Deno.test("keybinding sanitization trims, validates, and deduplicates", () => {
  const knownKeys = new Map([["x", "x"], ["f12", "F12"]]);
  const normalizeKey = (key) => knownKeys.get(key.toLowerCase()) ?? null;
  assertEquals(
    sanitizeKeybindings([
      " <Super>x ",
      "<Super>X",
      "<Mod4>X",
      "",
      "<Super><Shift>x",
      "<Shift><Super>x",
      "<broken",
      "<Bogus>x",
      "<Super>DefinitelyNotAKey",
      "<Mod1>f12",
      "<Alt>F12",
      "<Release>F12",
      "<Mod2>F12",
    ], normalizeKey),
    ["<Super>x", "<Mod4>X", "<Super><Shift>x", "<Mod1>f12"],
  );
  assertEquals(
    acceleratorsEqual("<Mod2>F12", "F12", normalizeKey),
    false,
  );
  assertEquals(
    acceleratorsEqual("<Alt>F12", "<Mod1>f12", normalizeKey),
    true,
  );
  assertEquals(
    acceleratorsEqual("<Super>x", "<Mod4>X", normalizeKey),
    false,
  );
  // Mutter ignores unknown modifier tags in external settings.
  assertEquals(
    acceleratorsEqual("<Release>F12", "F12", normalizeKey),
    true,
  );
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
});

function fullConfig() {
  return {
    formatVersion: FULL_CONFIG_FORMAT_VERSION,
    keybindings: {
      "cmd-win-optsize": ["<Super>x"],
      "cmd-win-mouseresize": ["<Super><Shift>x"],
    },
    keybindingFlags: "ignore_autorepeat",
    keybindingActionMode: "normal",
    overrideConflictingBindings: true,
    verboseLogging: false,
    winOptsize: cloneWinOptsizeConfig(),
    winMouseResize: {
      borderColor: " rgba(1, 2, 3, 0.5) ",
      backgroundColor: "transparent",
      borderSize: 4,
    },
  };
}

Deno.test("full config validation normalizes every user setting", () => {
  const result = normalizeFullConfig(fullConfig());
  assert(result.ok);
  assertEquals(result.value.keybindingFlags, "IGNORE_AUTOREPEAT");
  assertEquals(result.value.keybindingActionMode, "NORMAL");
  assertEquals(
    result.value.winMouseResize.borderColor,
    "rgba(1, 2, 3, 0.5)",
  );
});

for (
  const [name, mutate, error] of [
    [
      "future format",
      (config) => {
        config.formatVersion += 1;
      },
      "Unsupported full config format",
    ],
    [
      "unknown field",
      (config) => {
        config.extra = true;
      },
      "Full config contains unknown field",
    ],
    [
      "missing shortcut",
      (config) => delete config.keybindings["cmd-win-optsize"],
      "Keybindings is missing field",
    ],
    [
      "duplicate shortcut",
      (config) => config.keybindings["cmd-win-optsize"].push("<Super>x"),
      "Keybindings.cmd-win-optsize contains an invalid or duplicate shortcut",
    ],
    [
      "invalid optsize",
      (config) => {
        config.winOptsize.scales = [[0, 1]];
      },
      "winOptsize: Scales has invalid scale",
    ],
    [
      "unsafe color",
      (config) => {
        config.winMouseResize.borderColor = "red; color: blue";
      },
      "winMouseResize.borderColor must be a CSS color value",
    ],
    [
      "invalid border size",
      (config) => {
        config.winMouseResize.borderSize = 0;
      },
      "winMouseResize.borderSize must be an integer",
    ],
  ]
) {
  Deno.test(`full config rejects ${name}`, () => {
    const config = fullConfig();
    mutate(config);
    const result = normalizeFullConfig(config);
    assertEquals(result.ok, false);
    assert(
      result.error.startsWith(error),
      `${result.error} does not start with ${error}`,
    );
  });
}
