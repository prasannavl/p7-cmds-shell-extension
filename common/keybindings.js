import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { COMMON_KEYBINDING_SCHEMAS } from "./config.js";

const ACCELERATOR_ARRAY_TYPE = new GLib.VariantType("as");

export function createConflictKeybindingIndex() {
  const schemaSource = Gio.SettingsSchemaSource.get_default();
  const settings = COMMON_KEYBINDING_SCHEMAS.flatMap((schema) => {
    return schemaSource.lookup(schema, true)
      ? [new Gio.Settings({ schema })]
      : [];
  });
  const settingsBySchema = new Map(
    settings.map((settings) => [settings.schema_id, settings]),
  );
  const keyNamesBySchema = new Map(
    settings.map((settings) => {
      const keys = settings.settings_schema.list_keys().filter((key) => {
        const keyInfo = settings.settings_schema.get_key(key);
        const valueType = keyInfo?.get_value_type?.();
        return valueType?.equal(ACCELERATOR_ARRAY_TYPE);
      });
      return [settings.schema_id, keys];
    }),
  );

  return { settings, settingsBySchema, keyNamesBySchema };
}

export function findConflictingKeybindings(conflictIndex, accel, equals) {
  const matches = [];
  if (!accel) {
    return matches;
  }

  for (const settings of conflictIndex.settings) {
    const schemaId = settings.schema_id;
    const keys = conflictIndex.keyNamesBySchema.get(schemaId) ?? [];
    for (const key of keys) {
      const current = settings.get_strv(key);
      if (current?.some((binding) => equals(binding, accel))) {
        matches.push({ schemaId, key });
      }
    }
  }

  return matches;
}

export class KeybindingOverrideLease {
  constructor(conflictIndex, equals = (left, right) => left === right) {
    this._conflictIndex = conflictIndex;
    this._equals = equals;
    this._removed = new Map();
  }

  suppressMatching(matches) {
    const changes = [];

    for (const settings of this._conflictIndex.settings) {
      const schemaId = settings.schema_id;
      const keys = this._conflictIndex.keyNamesBySchema.get(schemaId) ?? [];
      for (const key of keys) {
        const current = settings.get_strv(key);
        const removed = [];
        const retained = [];
        current.forEach((binding, index) => {
          if (matches(binding)) removed.push({ binding, index });
          else retained.push(binding);
        });
        if (removed.length === 0) continue;

        this._remember(schemaId, key, removed);
        settings.set_strv(key, retained);
        changes.push({
          schemaId,
          key,
          bindings: removed.map((x) => x.binding),
        });
      }
    }

    return changes;
  }

  restore() {
    const changes = [];

    for (const [schemaId, keys] of this._removed) {
      const settings = this._conflictIndex.settingsBySchema.get(schemaId);
      if (!settings) continue;

      for (const [key, removed] of keys) {
        const current = settings.get_strv(key);
        const restored = [...current];
        const unmatched = [...restored];
        for (const { binding, index } of removed) {
          const match = unmatched.findIndex((current) =>
            this._equals(current, binding)
          );
          if (match >= 0) {
            unmatched.splice(match, 1);
          } else {
            restored.splice(Math.min(index, restored.length), 0, binding);
          }
        }
        if (arraysEqual(restored, current)) continue;
        settings.set_strv(key, restored);
        changes.push({
          schemaId,
          key,
          bindings: removed.map((x) => x.binding),
        });
      }
    }

    this._removed.clear();
    return changes;
  }

  _remember(schemaId, key, removed) {
    if (!this._removed.has(schemaId)) {
      this._removed.set(schemaId, new Map());
    }
    const schemaBindings = this._removed.get(schemaId);
    const remembered = schemaBindings.get(key) ?? [];
    remembered.push(...removed);
    schemaBindings.set(key, remembered);
  }
}

function arraysEqual(left, right) {
  return left.length === right.length &&
    left.every((value, index) => value === right[index]);
}
