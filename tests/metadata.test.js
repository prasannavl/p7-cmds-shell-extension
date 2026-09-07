import { assert, assertEquals } from "./testlib.js";

const metadata = JSON.parse(await Deno.readTextFile("metadata.json"));
const schema = await Deno.readTextFile(
  "schemas/org.gnome.shell.extensions.p7-cmds.gschema.xml",
);

Deno.test("metadata declares every supported Shell release", () => {
  assertEquals(metadata["shell-version"], ["45", "46", "47", "48", "49", "50"]);
});

Deno.test("metadata and schema identify the same extension", () => {
  assertEquals(metadata.uuid, "p7-cmds@prasannavl.com");
  assert(
    schema.includes(`id="${metadata["settings-schema"]}"`),
    "settings schema is missing from the schema XML",
  );
});

Deno.test("schema contains every declared setting key", async () => {
  const { COMMAND_DEFINITIONS, SETTING_KEYS } = await import(
    "../common/config.js"
  );
  const declared = [
    ...COMMAND_DEFINITIONS.map((command) => command.id),
    ...Object.values(SETTING_KEYS),
  ].sort();
  const schemaKeys = [...schema.matchAll(/<key name="([^"]+)"/g)]
    .map((match) => match[1])
    .sort();
  assertEquals(declared, schemaKeys);
});

Deno.test("runtime defaults match the schema", async () => {
  const {
    DEFAULT_KEYBINDING_ACTION_MODE,
    DEFAULT_KEYBINDING_FLAGS,
    DEFAULT_WIN_OPTSIZE_CONFIG,
    SETTING_KEYS,
  } = await import("../common/config.js");
  const schemaDefault = (key) => {
    const value = schema.match(
      new RegExp(`<key name="${key}"[\\s\\S]*?<default>([^<]+)</default>`),
    )?.[1];
    return value?.startsWith('"') ? JSON.parse(value) : value;
  };
  assertEquals(
    JSON.parse(schemaDefault(SETTING_KEYS.winOptsizeConfig)),
    DEFAULT_WIN_OPTSIZE_CONFIG,
  );
  assertEquals(
    schemaDefault(SETTING_KEYS.keybindingFlags),
    DEFAULT_KEYBINDING_FLAGS,
  );
  assertEquals(
    schemaDefault(SETTING_KEYS.keybindingActionMode),
    DEFAULT_KEYBINDING_ACTION_MODE,
  );
});

Deno.test("current release has a dated changelog entry", async () => {
  const changelog = await Deno.readTextFile("CHANGELOG.md");
  assert(
    new RegExp(`^## \\[${metadata.version}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m")
      .test(changelog),
    `version ${metadata.version} is not documented`,
  );
});

Deno.test("all relative runtime imports resolve", async () => {
  const root = new URL("../", import.meta.url);
  const entrypoints = [
    "extension.js",
    "prefs.js",
    "common/config.js",
    "common/keybindings.js",
    "common/window.js",
    "cmds/index.js",
    "shell/compat.js",
    "shell/keybindingmanager.js",
    "shell/logger.js",
    "prefs/config.js",
    "prefs/ui.js",
    "cmds/win_mouseresize.js",
    "cmds/win_optsize.js",
  ];
  for (const entrypoint of entrypoints) {
    const entrypointUrl = new URL(entrypoint, root);
    const source = await Deno.readTextFile(entrypointUrl);
    for (const match of source.matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
      try {
        await Deno.stat(new URL(match[1], entrypointUrl));
      } catch {
        throw new Error(`${entrypoint} imports missing ${match[1]}`);
      }
    }
  }
});
