import Gio from "gi://Gio";
import GLib from "gi://GLib";

const ACCELERATOR_ARRAY_TYPE = new GLib.VariantType("as");
const COMMON_SCHEMAS = [
  "org.gnome.desktop.wm.keybindings",
  "org.gnome.shell.keybindings",
  "org.gnome.mutter.keybindings",
  "org.gnome.mutter.wayland.keybindings",
  "org.gnome.settings-daemon.plugins.media-keys",
];
const CUSTOM = {
  parentSchema: "org.gnome.settings-daemon.plugins.media-keys",
  pathsKey: "custom-keybindings",
  schema: "org.gnome.settings-daemon.plugins.media-keys.custom-keybinding",
  bindingKey: "binding",
};

export function createConflictKeybindingIndex() {
  const schemaSource = Gio.SettingsSchemaSource.get_default();
  const groups = COMMON_SCHEMAS.flatMap((schema) => {
    if (!schemaSource.lookup(schema, true)) return [];
    const settings = new Gio.Settings({ schema });
    return [
      {
        settings,
        keys: settings.settings_schema.list_keys().filter((key) => {
          if (key === CUSTOM.pathsKey) return false;
          return settings.settings_schema.get_key(key).get_value_type().equal(
            ACCELERATOR_ARRAY_TYPE,
          );
        }),
      },
    ];
  });
  const parent = groups.find(
    ({ settings }) => settings.schema_id === CUSTOM.parentSchema,
  )?.settings;
  const customSchema = schemaSource.lookup(CUSTOM.schema, true);
  const customSettings = new Map();

  function* customGroups() {
    if (!parent || !customSchema) return;
    for (const path of parent.get_strv(CUSTOM.pathsKey)) {
      if (!path.startsWith("/") || !path.endsWith("/")) continue;
      let settings = customSettings.get(path);
      if (!settings) {
        settings = new Gio.Settings({ settings_schema: customSchema, path });
        customSettings.set(path, settings);
      }
      yield { settings, keys: [CUSTOM.bindingKey] };
    }
  }

  return {
    *[Symbol.iterator]() {
      yield* groups;
      yield* customGroups();
    },
    subscribe(listener) {
      const connections = new Map();
      const connect = (settings, signal, handler = listener) => {
        const ids = connections.get(settings) ?? [];
        ids.push(settings.connect(signal, handler));
        connections.set(settings, ids);
      };
      const disconnect = (settings) => {
        for (const id of connections.get(settings) ?? []) {
          settings.disconnect(id);
        }
        connections.delete(settings);
      };
      const connectCustom = () => {
        for (const settings of customSettings.values()) disconnect(settings);
        customSettings.clear();
        for (const { settings } of customGroups()) {
          connect(settings, `changed::${CUSTOM.bindingKey}`);
        }
      };
      for (const { settings } of groups) {
        connect(
          settings,
          "changed",
          (_settings, key) => {
            if (settings === parent && key === CUSTOM.pathsKey) connectCustom();
            listener();
          },
        );
      }
      connectCustom();
      return () => {
        for (const settings of [...connections.keys()]) disconnect(settings);
      };
    },
  };
}

export function findConflictingKeybindings(
  conflictIndex,
  accel,
  equals,
  matchesHidden = () => false,
) {
  if (!accel) return [];
  return [...keybindingEntries(conflictIndex)]
    .filter(({ settings, key, bindings }) =>
      matchesHidden(settings, key) ||
      bindings.some((binding) => equals(binding, accel))
    )
    .map(({ schemaId, key }) => ({ schemaId, key }));
}

export class KeybindingOverrides {
  constructor(conflictIndex, equals = (left, right) => left === right) {
    this._conflictIndex = conflictIndex;
    this._equals = equals;
    this._requests = new Set();
    this._removed = new Map();
  }

  findConflicts(accel) {
    return findConflictingKeybindings(
      this._conflictIndex,
      accel,
      this._equals,
      (settings, key) =>
        this._removed.get(settings)?.get(key)?.some(({ binding }) =>
          this._equals(binding, accel)
        ) ?? false,
    );
  }

  suppress(matches) {
    const existing = [...this._requests];
    const request = {
      matches,
      changes: [],
      failures: [],
      restore: () => {
        if (!this._requests.delete(request)) return emptyResult();
        const remaining = [...this._requests];
        const rebuilt = this._rebuild();
        const restored = filterChanges(
          rebuilt.restored.changes,
          (binding) => matches(binding) && !matchesAny(remaining, binding),
        );
        return {
          changes: restored,
          failures: [
            ...filterChanges(rebuilt.restored.failures, matches),
            ...rebuilt.failures,
          ],
        };
      },
    };
    this._requests.add(request);
    const result = this._rebuild();
    request.changes = filterChanges(
      result.suppressed,
      (binding) => matches(binding) && !matchesAny(existing, binding),
    );
    request.failures = result.failures;
    return request;
  }

  clear() {
    this._requests.clear();
    return this._restore();
  }

  _rebuild() {
    const restored = this._restore();
    const result = this._requests.size === 0
      ? emptyResult()
      : this._suppress((binding) => matchesAny(this._requests, binding));
    return { restored, suppressed: result.changes, failures: result.failures };
  }

  _suppress(matches) {
    const changes = [];
    const failures = [];
    for (
      const { settings, schemaId, key, bindings } of keybindingEntries(
        this._conflictIndex,
      )
    ) {
      const removed = [];
      const retained = [];
      bindings.forEach((binding, index) => {
        if (matches(binding)) removed.push({ binding, index });
        else retained.push(binding);
      });
      if (removed.length === 0) continue;
      const change = bindingChange(schemaId, key, removed);
      if (!writeBindings(settings, key, retained)) {
        failures.push(change);
        continue;
      }
      const remembered = this._removed.get(settings) ?? new Map();
      remembered.set(key, removed);
      this._removed.set(settings, remembered);
      changes.push(change);
    }
    return { changes, failures };
  }

  _restore() {
    const changes = [];
    const failures = [];
    for (const [settings, keys] of this._removed) {
      for (const [key, removed] of keys) {
        const current = getBindings(settings, key);
        const restored = isScalarBinding(settings, key) && current.length > 0
          ? current
          : mergeRemovedBindings(current, removed, this._equals);
        if (arraysEqual(restored, current)) {
          keys.delete(key);
          continue;
        }
        const change = bindingChange(settings.schema_id, key, removed);
        if (!writeBindings(settings, key, restored)) {
          failures.push(change);
          continue;
        }
        keys.delete(key);
        changes.push(change);
      }
      if (keys.size === 0) this._removed.delete(settings);
    }
    return { changes, failures };
  }
}

function arraysEqual(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function* keybindingEntries(conflictIndex) {
  for (
    const { settings, keys, schemaId = settings.schema_id } of conflictIndex
  ) {
    for (const key of keys) {
      yield {
        settings,
        schemaId,
        key,
        bindings: getBindings(settings, key),
      };
    }
  }
}

function getBindings(settings, key) {
  return isScalarBinding(settings, key)
    ? [settings.get_string(key)].filter(Boolean)
    : settings.get_strv(key);
}

function setBindings(settings, key, bindings) {
  return isScalarBinding(settings, key)
    ? settings.set_string(key, bindings[0] ?? "")
    : settings.set_strv(key, bindings);
}

function writeBindings(settings, key, bindings) {
  try {
    return setBindings(settings, key, bindings) !== false &&
      arraysEqual(getBindings(settings, key), bindings);
  } catch {
    return false;
  }
}

function isScalarBinding(settings, key) {
  return settings.get_value(key).get_type_string() === "s";
}

function mergeRemovedBindings(current, removed, equals) {
  const restored = [...current];
  const unmatched = [...current];
  for (const { binding, index } of removed) {
    const match = unmatched.findIndex((value) => equals(value, binding));
    if (match >= 0) unmatched.splice(match, 1);
    else restored.splice(Math.min(index, restored.length), 0, binding);
  }
  return restored;
}

function bindingChange(schemaId, key, removed) {
  return { schemaId, key, bindings: removed.map(({ binding }) => binding) };
}

function matchesAny(requests, binding) {
  return [...requests].some(({ matches }) => matches(binding));
}

function emptyResult() {
  return { changes: [], failures: [] };
}

function filterChanges(changes, matches) {
  return changes
    .map(({ schemaId, key, bindings }) => ({
      schemaId,
      key,
      bindings: bindings.filter(matches),
    }))
    .filter(({ bindings }) => bindings.length > 0);
}
