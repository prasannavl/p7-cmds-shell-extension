// prefs.js

import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";
import {
  acceleratorsEqual as compareAccelerators,
  ACTION_MODE_NAMES,
  cloneWinOptsizeConfig,
  COMMAND_DEFINITIONS,
  createAcceleratorKeyNormalizer,
  KEYBINDING_FLAG_NAMES,
  MAX_FULL_CONFIG_FILE_SIZE,
  normalizeFullConfig,
  parseWinOptsizeConfig,
  SETTING_KEYS,
  USER_SETTING_KEYS,
} from "../common/config.js";
import {
  createConflictKeybindingIndex,
  findConflictingKeybindings,
} from "../common/keybindings.js";
import { readFullConfig, replaceFullConfig } from "./config.js";

export const normalizeAcceleratorKey = createAcceleratorKeyNormalizer(
  Gdk,
  Gdk.keyval_to_lower,
);

function acceleratorsEqual(left, right) {
  return compareAccelerators(left, right, normalizeAcceleratorKey);
}

class PreferencesUi {
  constructor(window, settings) {
    this.window = window;
    this.settings = settings;
    this.cleanups = [];
    window.connect("destroy", () => {
      for (const cleanup of this.cleanups.splice(0)) cleanup();
    });
  }

  cleanup(callback) {
    this.cleanups.push(callback);
  }

  watch(key, handler) {
    const id = this.settings.connect(`changed::${key}`, handler);
    this.cleanup(() => this.settings.disconnect(id));
  }

  sync(key, control, signal, read, show, save) {
    let refreshing = false;
    const refresh = () => {
      refreshing = true;
      show(read());
      refreshing = false;
    };
    refresh();
    this.watch(key, refresh);
    control.connect(signal, () => {
      if (!refreshing) save();
    });
  }

  bind(key, control, property) {
    this.settings.bind(
      key,
      control,
      property,
      Gio.SettingsBindFlags.DEFAULT,
    );
    return control;
  }
}

function createRowList(container) {
  const rows = [];
  return {
    add(row) {
      container.add(row);
      rows.push(row);
    },
    remove(row) {
      const index = rows.indexOf(row);
      if (index < 0) return;
      rows.splice(index, 1);
      container.remove(row);
    },
    clear() {
      for (const row of rows.splice(0)) container.remove(row);
    },
  };
}

function button(label, clicked, properties = {}) {
  const result = new Gtk.Button({
    label,
    valign: Gtk.Align.CENTER,
    ...properties,
  });
  if (clicked) result.connect("clicked", clicked);
  return result;
}

function withSuffix(row, ...widgets) {
  for (const widget of widgets) row.add_suffix(widget);
  return row;
}

function showToast(window, title) {
  window.add_toast(new Adw.Toast({ title }));
}

function requireConfigFileSize(size) {
  if (size > MAX_FULL_CONFIG_FILE_SIZE) {
    throw new Error(
      `Config file must contain at most ${MAX_FULL_CONFIG_FILE_SIZE} bytes`,
    );
  }
}

function parseFullConfigJson(text) {
  requireConfigFileSize(new TextEncoder().encode(text).length);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON");
  }
}

function chooseJsonFile(window, action, title, onFile, currentName = null) {
  const chooser = new Gtk.FileChooserNative({
    title,
    transient_for: window,
    modal: true,
    action,
    accept_label: action === Gtk.FileChooserAction.SAVE ? "Export" : "Import",
  });
  const filter = new Gtk.FileFilter();
  filter.set_name("JSON files");
  filter.add_mime_type("application/json");
  filter.add_pattern("*.json");
  chooser.add_filter(filter);
  if (currentName) chooser.set_current_name(currentName);
  chooser.connect("response", (_dialog, response) => {
    try {
      if (response === Gtk.ResponseType.ACCEPT) onFile(chooser.get_file());
    } finally {
      chooser.destroy();
    }
  });
  chooser.show();
}

async function readConfigFile(file, cancellable) {
  const info = await file.query_info_async(
    Gio.FILE_ATTRIBUTE_STANDARD_SIZE,
    Gio.FileQueryInfoFlags.NONE,
    GLib.PRIORITY_DEFAULT,
    cancellable,
  );
  requireConfigFileSize(info.get_size());
  const [contents] = await file.load_contents_async(cancellable);
  requireConfigFileSize(contents.length);
  return parseFullConfigJson(new TextDecoder().decode(contents));
}

export function getScaleIncrement(value) {
  if (value <= 1) return 0.1;
  if (value <= 512) return 8;
  if (value <= 1024) return 16;
  return 32;
}

export function normalizeScaleSpinValue(value, previousValue) {
  if (value <= 1 || Number.isInteger(value)) return value;
  return typeof previousValue === "number" && previousValue <= 1
    ? Math.max(2, Math.ceil(value))
    : Math.trunc(value);
}

function addKeybinding(bindings, accelerator) {
  return bindings.some((binding) => acceleratorsEqual(binding, accelerator))
    ? bindings
    : [...bindings, accelerator];
}

function replaceKeybinding(bindings, index, accelerator) {
  return bindings.flatMap((binding, currentIndex) => {
    if (currentIndex === index) return [accelerator];
    return acceleratorsEqual(binding, accelerator) ? [] : [binding];
  });
}

function captureShortcut(parent, onDone) {
  const dialog = new Adw.Window({
    title: "Set Shortcut",
    modal: true,
    transient_for: parent,
    default_width: 360,
    default_height: 140,
    content: new Adw.StatusPage({
      title: "Press a key combination",
      description: "Press Esc to cancel.",
    }),
  });

  const controller = new Gtk.EventControllerKey();
  controller.connect("key-pressed", (_controller, keyval, _keycode, state) => {
    if (keyval === Gdk.KEY_Escape) {
      dialog.close();
      return Gdk.EVENT_STOP;
    }

    const mods = state & Gtk.accelerator_get_default_mod_mask();
    if (!Gtk.accelerator_valid(keyval, mods)) {
      return Gdk.EVENT_STOP;
    }

    const accel = Gtk.accelerator_name(keyval, mods);
    onDone(accel);
    dialog.close();
    return Gdk.EVENT_STOP;
  });
  dialog.add_controller(controller);
  dialog.present();
}

function createConflictChecker(settings) {
  const systemIndex = createConflictKeybindingIndex();
  const conflictIndex = {
    *[Symbol.iterator]() {
      yield* systemIndex;
      yield {
        settings,
        keys: COMMAND_DEFINITIONS.map(({ id }) => id),
        schemaId: "P7 Commands",
      };
    },
  };
  return {
    find: (accelerator, commandId) =>
      findConflictingKeybindings(
        conflictIndex,
        accelerator,
        acceleratorsEqual,
      ).filter(({ schemaId, key }) =>
        schemaId !== "P7 Commands" || key !== commandId
      ),
    subscribe: (listener) => systemIndex.subscribe(listener),
  };
}

function buildEnumRow(
  ui,
  title,
  subtitle,
  values,
  key,
) {
  const options = [...values];
  const model = new Gtk.StringList();
  for (const value of options) {
    model.append(value);
  }

  const row = new Adw.ComboRow({
    title,
    subtitle,
    model,
  });

  ui.sync(
    key,
    row,
    "notify::selected",
    () => ui.settings.get_string(key).trim(),
    (stored) => {
      const current = options.includes(stored.toUpperCase())
        ? stored.toUpperCase()
        : stored;
      let index = options.indexOf(current);
      if (index < 0 && /^\d+$/.test(current)) {
        index = options.push(current) - 1;
        model.append(current);
      }
      row.set_selected(Math.max(0, index));
    },
    () =>
      ui.settings.set_string(key, options[row.get_selected()] ?? options[0]),
  );

  return row;
}

function buildKeybindingGroup(
  ui,
  command,
  conflictChecker,
) {
  const { settings } = ui;
  const group = new Adw.PreferencesGroup({
    title: command.title,
    description: command.description,
  });
  const rows = createRowList(group);
  const conflictRow = new Adw.ActionRow({
    title: "Conflicting shortcuts",
    subtitle: "",
  });
  const update = (callback) =>
    settings.set_strv(command.id, callback(settings.get_strv(command.id)));
  const capture = (updateBindings) =>
    captureShortcut(
      ui.window,
      (accelerator) =>
        update((bindings) => updateBindings(bindings, accelerator)),
    );

  const refresh = () => {
    rows.clear();
    const bindings = settings.get_strv(command.id);

    bindings.forEach((binding, index) => {
      rows.add(
        withSuffix(
          new Adw.ActionRow({ title: `Shortcut ${index + 1}` }),
          new Gtk.ShortcutLabel({
            accelerator: binding,
            valign: Gtk.Align.CENTER,
          }),
          button(
            "Set",
            () =>
              capture((current, accelerator) =>
                replaceKeybinding(current, index, accelerator)
              ),
          ),
          button(
            "Remove",
            () =>
              update((current) => current.filter((_accel, i) => i !== index)),
          ),
        ),
      );
    });

    rows.add(
      withSuffix(
        new Adw.ActionRow({ title: "Add shortcut" }),
        button(
          "Add",
          () =>
            capture((current, accelerator) =>
              addKeybinding(current, accelerator)
            ),
        ),
      ),
    );

    const seen = new Set(
      bindings.flatMap((binding) =>
        conflictChecker.find(binding, command.id).map(
          ({ schemaId, key }) => `${binding} -> ${schemaId}::${key}`,
        )
      ),
    );
    if (seen.size > 0) {
      conflictRow.set_subtitle(`Already used by: ${[...seen].join(", ")}`);
      rows.add(conflictRow);
    }
  };

  refresh();
  for (const definition of COMMAND_DEFINITIONS) {
    ui.watch(definition.id, refresh);
  }

  return { group, refresh };
}

function buildSpinRow({
  ui,
  key,
  title,
  subtitle,
  value,
  digits,
  min,
  max,
  step,
  onChange,
}) {
  const row = new Adw.SpinRow({
    title,
    subtitle: subtitle ?? null,
    adjustment: new Gtk.Adjustment({
      lower: min,
      upper: max,
      step_increment: step,
      page_increment: step,
    }),
    digits,
    numeric: true,
  });

  if (ui && key) {
    ui.sync(
      key,
      row,
      "notify::value",
      () => ui.settings.get_int(key),
      (value) => row.set_value(value),
      () => ui.settings.set_int(key, Math.round(row.get_value())),
    );
  } else {
    row.set_value(value ?? min);
    row.connect("notify::value", () => onChange?.(row.get_value()));
  }
  return row;
}

function buildColorRow({
  ui,
  title,
  subtitle,
  key,
}) {
  const { settings } = ui;
  const row = new Adw.EntryRow({ title, tooltip_text: subtitle ?? null });
  const colorButton = new Gtk.ColorDialogButton({
    dialog: new Gtk.ColorDialog({ with_alpha: true }),
    valign: Gtk.Align.CENTER,
  });
  row.add_suffix(colorButton);
  row.activatable_widget = colorButton;

  const defaultValue = settings.get_default_value(key).deepUnpack();
  let settingColor = false;
  const syncColor = () => {
    settingColor = true;
    const color = new Gdk.RGBA();
    if (!color.parse(row.text)) color.parse(defaultValue);
    colorButton.set_rgba(color);
    settingColor = false;
  };
  ui.bind(key, row, "text");
  row.connect("notify::text", syncColor);
  syncColor();

  colorButton.connect("notify::rgba", () => {
    if (settingColor) return;
    row.text = colorButton.get_rgba().to_string();
  });

  return row;
}

function updateScaleSpinIncrements(spin, adjustment) {
  const increment = getScaleIncrement(spin.get_value());
  adjustment.set_step_increment(increment);
  adjustment.set_page_increment(increment);
}

function buildScaleRow(scale, onChange, onRemove) {
  const autoHeight = scale[1] === null;
  const updating = [false, false];
  const controls = [0, 1].map((axis) => {
    const spin = buildSpinRow({
      title: axis === 0 ? "Width" : "Height",
      value: scale[axis] ?? 0.8,
      digits: 2,
      min: 0.1,
      max: 10000,
      step: 0.1,
      onChange: (next) => {
        if (updating[axis]) return;
        updating[axis] = true;
        const value = normalizeScaleSpinValue(next, scale[axis]);
        if (value !== spin.get_value()) spin.set_value(value);
        const adjustment = spin.get_adjustment();
        updateScaleSpinIncrements(spin, adjustment);
        scale[axis] = value;
        updating[axis] = false;
        onChange();
      },
    });
    const adjustment = spin.get_adjustment();
    updateScaleSpinIncrements(spin, adjustment);
    return { spin, adjustment };
  });
  const height = controls[1];
  height.spin.set_sensitive(!autoHeight);
  const row = new Adw.ExpanderRow({ title: "Scale" });
  row.add_suffix(button("Remove", onRemove, { halign: Gtk.Align.END }));
  row.add_row(controls[0].spin);

  const autoHeightToggle = new Adw.SwitchRow({
    title: "Automatic height",
    active: autoHeight,
  });
  autoHeightToggle.connect("notify::active", () => {
    if (autoHeightToggle.get_active()) {
      scale[1] = null;
      height.spin.set_sensitive(false);
    } else {
      const value = normalizeScaleSpinValue(height.spin.get_value(), scale[1]);
      updating[1] = true;
      height.spin.set_value(value);
      updating[1] = false;
      updateScaleSpinIncrements(height.spin, height.adjustment);
      scale[1] = value;
      height.spin.set_sensitive(true);
    }
    onChange();
  });
  row.add_row(autoHeightToggle);
  row.add_row(height.spin);
  return row;
}

function buildEditableList({
  items,
  addRow,
  removeRow,
  buildRow,
  createItem,
  itemTitle,
  addTitle,
  onChange,
}) {
  const rows = [];
  const updateTitles = () => {
    rows.forEach((row, index) => {
      row.set_title(itemTitle(index));
    });
  };
  const addItem = (item) => {
    const row = buildRow(item, () => {
      const index = rows.indexOf(row);
      if (index < 0) return;
      items.splice(index, 1);
      rows.splice(index, 1);
      removeRow(row);
      updateTitles();
      onChange();
    });
    rows.push(row);
    return row;
  };

  items.forEach((item) => {
    addRow(addItem(item));
  });

  const addAction = new Adw.ActionRow({ title: addTitle });
  const addButton = button(
    "Add",
    () => {
      const item = createItem();
      items.push(item);
      const row = addItem(item);
      removeRow(addAction);
      addRow(row);
      addRow(addAction);
      updateTitles();
      onChange();
    },
    { halign: Gtk.Align.END },
  );
  addAction.add_suffix(addButton);
  addRow(addAction);
  updateTitles();
}

function buildScaleList({
  scales,
  addRow,
  removeRow,
  saveConfig,
  addRowTitle = "Add scale",
}) {
  buildEditableList({
    items: scales,
    addRow,
    removeRow,
    buildRow: (scale, remove) => buildScaleRow(scale, saveConfig, remove),
    createItem: () => [0.8, 0.8],
    itemTitle: (index) => `Scale ${index + 1}`,
    addTitle: addRowTitle,
    onChange: saveConfig,
  });
}

function buildWinOptsizeConfigGroup(ui) {
  const { settings } = ui;
  const configGroup = new Adw.PreferencesGroup();

  const rows = createRowList(configGroup);
  let jsonDirty = false;
  let settingJson = false;
  const jsonGroup = new Adw.PreferencesGroup();
  const jsonErrorRow = new Adw.ActionRow({
    title: "JSON error",
    subtitle: "",
  });
  jsonErrorRow.set_visible(false);

  const jsonBuffer = new Gtk.TextBuffer();
  const jsonView = new Gtk.TextView({
    buffer: jsonBuffer,
    editable: true,
    monospace: true,
    wrap_mode: Gtk.WrapMode.NONE,
    hexpand: true,
    vexpand: true,
  });
  const jsonScroll = new Gtk.ScrolledWindow({
    hscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
    min_content_height: 160,
    hexpand: true,
    vexpand: true,
    child: jsonView,
  });
  const jsonRow = new Adw.PreferencesRow({
    child: jsonScroll,
    hexpand: true,
    vexpand: true,
  });
  const loadConfig = () =>
    parseWinOptsizeConfig(settings.get_string(SETTING_KEYS.winOptsizeConfig));
  let config = loadConfig().value ?? cloneWinOptsizeConfig();
  const applyButton = new Gtk.Button({
    label: "Apply",
    css_classes: ["suggested-action"],
  });
  const reloadButton = new Gtk.Button({ label: "Reload" });
  const markJsonDirty = (dirty) => {
    jsonDirty = dirty;
    applyButton.set_sensitive(dirty);
    reloadButton.set_sensitive(dirty);
    jsonErrorRow.set_visible(false);
  };

  const setJsonText = (text) => {
    settingJson = true;
    jsonBuffer.set_text(text, -1);
    settingJson = false;
    markJsonDirty(false);
  };

  const getJsonText = () => {
    const [start, end] = jsonBuffer.get_bounds();
    return jsonBuffer.get_text(start, end, false);
  };

  const serializeConfig = () => JSON.stringify(config, null, 2);
  const syncJsonFromSettings = (loaded = loadConfig()) => {
    setJsonText(
      loaded.ok
        ? JSON.stringify(loaded.value, null, 2)
        : settings.get_string(SETTING_KEYS.winOptsizeConfig),
    );
    if (!loaded.ok) {
      jsonErrorRow.set_subtitle(loaded.error);
      jsonErrorRow.set_visible(true);
    }
  };

  const saveConfigNow = (syncJson = !jsonDirty) => {
    const serialized = serializeConfig();
    settings.set_string(SETTING_KEYS.winOptsizeConfig, serialized);
    if (syncJson) setJsonText(serialized);
  };

  const saveConfig = () => saveConfigNow();

  const buildBreakpointRow = (breakpoint, onRemove) => {
    const expander = new Adw.ExpanderRow({ title: "Breakpoint" });
    const updateSubtitle = () => {
      const height = breakpoint.maxHeight == null
        ? "any height"
        : `height ≤ ${breakpoint.maxHeight}px`;
      expander.set_subtitle(`Width ≤ ${breakpoint.maxWidth}px, ${height}`);
    };

    expander.add_suffix(button("Remove", onRemove, { halign: Gtk.Align.END }));

    const hasMaxHeight = breakpoint.maxHeight != null;
    const dimensionRow = (title, value, property) =>
      buildSpinRow({
        title,
        value,
        digits: 0,
        min: 320,
        max: 10000,
        step: 10,
        onChange: (next) => {
          breakpoint[property] = Math.round(next);
          updateSubtitle();
          saveConfig();
        },
      });
    const maxWidthRow = dimensionRow(
      "Max width",
      breakpoint.maxWidth,
      "maxWidth",
    );
    const maxHeightRow = dimensionRow(
      "Max height",
      hasMaxHeight ? breakpoint.maxHeight : 1080,
      "maxHeight",
    );
    maxHeightRow.set_sensitive(hasMaxHeight);

    const maxHeightToggle = new Adw.SwitchRow({
      title: "Limit by max height",
      active: hasMaxHeight,
    });
    maxHeightToggle.connect("notify::active", () => {
      const active = maxHeightToggle.get_active();
      breakpoint.maxHeight = active
        ? Math.round(breakpoint.maxHeight ?? 1080)
        : null;
      maxHeightRow.set_sensitive(active);
      updateSubtitle();
      saveConfig();
    });

    expander.add_row(maxWidthRow);
    expander.add_row(maxHeightToggle);
    expander.add_row(maxHeightRow);
    expander.add_row(new Adw.ActionRow({ title: "Scales" }));

    const scales = breakpoint.scales ?? [];
    breakpoint.scales = scales;
    buildScaleList({
      scales,
      addRow: (row) => expander.add_row(row),
      removeRow: (row) => row.get_parent()?.remove?.(row),
      saveConfig,
    });

    updateSubtitle();
    return expander;
  };

  const render = () => {
    rows.clear();
    const loaded = loadConfig();
    config = loaded.value ?? cloneWinOptsizeConfig();
    if (!jsonDirty) syncJsonFromSettings(loaded);

    // Aspect-based inversion toggle
    const aspectRow = new Adw.SwitchRow({
      title: "Enable aspect-based inversion",
      subtitle: "Invert width/height for portrait screens",
      active: config.aspectBasedInversion,
    });
    aspectRow.connect("notify::active", () => {
      config.aspectBasedInversion = aspectRow.get_active();
      saveConfig();
    });
    rows.add(aspectRow);

    rows.add(
      new Adw.ActionRow({
        title: "Fallback scales",
        subtitle:
          "Used only when no breakpoint matches. Values ≤1 are relative; values >1 are pixels",
      }),
    );

    buildScaleList({
      scales: config.scales,
      addRow: rows.add,
      removeRow: rows.remove,
      saveConfig,
      addRowTitle: "Add fallback scale",
    });

    rows.add(
      new Adw.ActionRow({
        title: "Breakpoints",
        subtitle:
          "Ordered; the first matching breakpoint overrides fallback scales",
      }),
    );

    buildEditableList({
      items: config.breakpoints,
      addRow: rows.add,
      removeRow: rows.remove,
      buildRow: buildBreakpointRow,
      createItem: () => ({ maxWidth: 1920, scales: [[0.8, 0.8]] }),
      itemTitle: (index) => `Breakpoint ${index + 1}`,
      addTitle: "Add breakpoint",
      onChange: saveConfig,
    });
  };

  render();
  ui.watch(SETTING_KEYS.winOptsizeConfig, () => {
    if (
      settings.get_string(SETTING_KEYS.winOptsizeConfig) === serializeConfig()
    ) {
      return;
    }
    render();
  });

  jsonBuffer.connect("changed", () => {
    if (settingJson) return;
    markJsonDirty(true);
  });

  applyButton.connect("clicked", () => {
    const result = parseWinOptsizeConfig(getJsonText());
    if (!result.ok) {
      jsonErrorRow.set_subtitle(result.error);
      jsonErrorRow.set_visible(true);
      return;
    }
    config = result.value;
    saveConfigNow(true);
    render();
    showToast(ui.window, "Win optsize config applied");
  });

  reloadButton.connect("clicked", () => {
    syncJsonFromSettings();
  });

  const jsonActionsRow = new Adw.ActionRow({
    title: "JSON editor",
    subtitle: "Apply to replace the current config.",
  });
  jsonActionsRow.add_suffix(applyButton);
  jsonActionsRow.add_suffix(reloadButton);
  jsonGroup.add(jsonActionsRow);
  jsonGroup.add(jsonErrorRow);
  jsonGroup.add(jsonRow);

  const stack = new Adw.ViewStack();
  const configPage = stack.add_titled(configGroup, "config", "Config");
  configPage.set_icon_name("preferences-system-symbolic");
  const jsonPage = stack.add_titled(jsonGroup, "json", "JSON");
  jsonPage.set_icon_name("text-x-generic-symbolic");
  stack.hexpand = true;
  stack.vexpand = true;

  const switcherBar = new Adw.ViewSwitcherBar({
    stack,
    reveal: true,
  });

  const layout = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 12,
    hexpand: true,
    vexpand: true,
  });
  layout.append(stack);
  layout.append(switcherBar);

  const wrapperGroup = new Adw.PreferencesGroup({
    title: "Win optsize config",
  });
  const layoutRow = new Adw.PreferencesRow({ child: layout, vexpand: true });
  wrapperGroup.add(layoutRow);

  return wrapperGroup;
}

function buildWinMouseResizeConfigGroup(ui) {
  const group = new Adw.PreferencesGroup({
    title: "Resize indicator",
    description: "Customize border and background colors for win_mouseresize.",
  });

  for (
    const [title, subtitle, key] of [
      [
        "Border color",
        "CSS color for the resize outline.",
        SETTING_KEYS.winMouseResizeBorderColor,
      ],
      [
        "Background color",
        "CSS color for the resize fill.",
        SETTING_KEYS.winMouseResizeBackgroundColor,
      ],
    ]
  ) {
    group.add(
      buildColorRow({
        ui,
        title,
        subtitle,
        key,
      }),
    );
  }
  const [, borderRange] = ui.settings.settings_schema
    .get_key(SETTING_KEYS.winMouseResizeBorderSize).get_range().deepUnpack();
  const [min, max] = borderRange.deepUnpack();
  group.add(
    buildSpinRow({
      ui,
      key: SETTING_KEYS.winMouseResizeBorderSize,
      title: "Border size",
      subtitle: "Border thickness in pixels.",
      digits: 0,
      min,
      max,
      step: 1,
    }),
  );

  return group;
}

function buildFullConfigPage(ui) {
  const { settings, window } = ui;
  const page = new Adw.PreferencesPage({
    title: "Full Config",
    icon_name: "document-save-symbolic",
  });
  const fileGroup = new Adw.PreferencesGroup({
    title: "Import and Export",
    description: "Transfer every P7 Commands shortcut and command setting.",
  });
  const fileRow = new Adw.ActionRow({
    title: "Full config file",
    subtitle:
      "Importing replaces the complete configuration after confirmation.",
  });
  const exportButton = button("Export…", null);
  const importButton = button("Import…", null, {
    css_classes: ["suggested-action"],
  });
  const fileActions = new Gtk.Box({
    spacing: 8,
    valign: Gtk.Align.CENTER,
  });
  fileActions.append(exportButton);
  fileActions.append(importButton);
  fileRow.add_suffix(fileActions);
  fileGroup.add(fileRow);

  const buffer = new Gtk.TextBuffer();
  const view = new Gtk.TextView({
    buffer,
    editable: true,
    monospace: true,
    wrap_mode: Gtk.WrapMode.NONE,
    hexpand: true,
    vexpand: true,
    left_margin: 8,
    right_margin: 8,
    top_margin: 8,
    bottom_margin: 8,
  });
  const scroller = new Gtk.ScrolledWindow({
    child: view,
    min_content_height: 320,
    hexpand: true,
    vexpand: true,
  });
  const editorRow = new Adw.PreferencesRow({
    child: scroller,
    hexpand: true,
    vexpand: true,
  });
  const editorGroup = new Adw.PreferencesGroup({
    title: "JSON",
    description: "Inspect or replace the complete configuration.",
  });
  const applyButton = button("Apply", null, {
    css_classes: ["suggested-action"],
  });
  const reloadButton = button("Reload", null);
  const copyButton = button("Copy", null);
  const actions = new Gtk.Box({ spacing: 8, valign: Gtk.Align.CENTER });
  actions.append(copyButton);
  actions.append(reloadButton);
  actions.append(applyButton);
  const actionsRow = new Adw.ActionRow({
    title: "Full config JSON",
    subtitle: "Apply validates all fields before changing any setting.",
  });
  actionsRow.add_suffix(actions);
  editorGroup.add(actionsRow);
  editorGroup.add(editorRow);

  const resetGroup = new Adw.PreferencesGroup({ title: "Reset" });
  const resetRow = new Adw.ActionRow({
    title: "Reset all settings",
    subtitle: "Restore every P7 Commands setting to its schema default.",
  });
  const resetButton = button("Reset…", null, {
    css_classes: ["destructive-action"],
  });
  resetRow.add_suffix(resetButton);
  resetGroup.add(resetRow);

  let settingText = false;
  let dirty = false;
  const cancellable = new Gio.Cancellable();
  ui.cleanup(() => cancellable.cancel());
  const getText = () => {
    const [start, end] = buffer.get_bounds();
    return buffer.get_text(start, end, false);
  };
  const setDirty = (value) => {
    dirty = value;
    applyButton.set_sensitive(value);
    reloadButton.set_sensitive(value);
  };
  const setText = (config) => {
    settingText = true;
    buffer.set_text(JSON.stringify(config, null, 2), -1);
    settingText = false;
    setDirty(false);
  };
  const read = () => readFullConfig(settings, normalizeAcceleratorKey);
  const refresh = () => {
    if (dirty) return;
    try {
      setText(read());
    } catch (error) {
      showToast(window, `Config error: ${error.message}`);
    }
  };
  const apply = (config, message) => {
    const saved = replaceFullConfig(settings, config, normalizeAcceleratorKey);
    setText(saved);
    showToast(window, message);
  };

  setDirty(false);
  refresh();
  buffer.connect("changed", () => {
    if (!settingText) setDirty(true);
  });
  for (const key of USER_SETTING_KEYS) ui.watch(key, refresh);

  copyButton.connect("clicked", () => {
    Gdk.Display.get_default().get_clipboard().set(getText());
    showToast(window, "Full config copied");
  });
  reloadButton.connect("clicked", () => {
    try {
      setText(read());
    } catch (error) {
      showToast(window, `Reload failed: ${error.message}`);
    }
  });
  applyButton.connect("clicked", () => {
    try {
      apply(parseFullConfigJson(getText()), "Full config applied");
    } catch (error) {
      showToast(window, `Apply failed: ${error.message}`);
    }
  });

  const exportConfig = async (file) => {
    try {
      const contents = new TextEncoder().encode(
        `${JSON.stringify(read(), null, 2)}\n`,
      );
      requireConfigFileSize(contents.length);
      await file.replace_contents_async(
        contents,
        null,
        false,
        Gio.FileCreateFlags.REPLACE_DESTINATION,
        cancellable,
      );
      showToast(window, "Full config exported");
    } catch (error) {
      if (!cancellable.is_cancelled()) {
        showToast(window, `Export failed: ${error.message}`);
      }
    }
  };
  exportButton.connect("clicked", () => {
    chooseJsonFile(
      window,
      Gtk.FileChooserAction.SAVE,
      "Export Full Config",
      (file) => void exportConfig(file),
      "p7-commands-config.json",
    );
  });

  const importConfig = async (file) => {
    try {
      const parsed = await readConfigFile(file, cancellable);
      const result = normalizeFullConfig(parsed, normalizeAcceleratorKey);
      if (!result.ok) throw new Error(result.error);
      const config = result.value;
      const shortcuts = Object.values(config.keybindings).reduce(
        (total, bindings) => total + bindings.length,
        0,
      );
      const confirmation = new Gtk.MessageDialog({
        transient_for: window,
        modal: true,
        text: "Import this full config?",
        secondary_text:
          `${shortcuts} shortcuts, ${config.winOptsize.scales.length} fallback scales, ` +
          `${config.winOptsize.breakpoints.length} breakpoints.`,
        buttons: Gtk.ButtonsType.NONE,
      });
      confirmation.add_button("Cancel", Gtk.ResponseType.CANCEL);
      confirmation.add_button("Import", Gtk.ResponseType.ACCEPT);
      confirmation.connect("response", (dialog, response) => {
        try {
          if (response === Gtk.ResponseType.ACCEPT) {
            apply(config, "Full config imported");
          }
        } catch (error) {
          showToast(window, `Import failed: ${error.message}`);
        } finally {
          dialog.destroy();
        }
      });
      confirmation.present();
    } catch (error) {
      if (!cancellable.is_cancelled()) {
        showToast(window, `Import failed: ${error.message}`);
      }
    }
  };
  importButton.connect("clicked", () => {
    chooseJsonFile(
      window,
      Gtk.FileChooserAction.OPEN,
      "Import Full Config",
      (file) => void importConfig(file),
    );
  });

  resetButton.connect("clicked", () => {
    const confirmation = new Gtk.MessageDialog({
      transient_for: window,
      modal: true,
      text: "Reset all P7 Commands settings?",
      secondary_text:
        "This replaces every shortcut and command setting with its default.",
      buttons: Gtk.ButtonsType.NONE,
    });
    confirmation.add_button("Cancel", Gtk.ResponseType.CANCEL);
    confirmation.add_button("Reset", Gtk.ResponseType.ACCEPT);
    confirmation.connect("response", (dialog, response) => {
      if (response === Gtk.ResponseType.ACCEPT) {
        try {
          for (const key of settings.settings_schema.list_keys()) {
            settings.reset(key);
          }
          setText(read());
          showToast(window, "All settings reset");
        } catch (error) {
          showToast(window, `Reset failed: ${error.message}`);
        }
      }
      dialog.destroy();
    });
    confirmation.present();
  });

  page.add(fileGroup);
  page.add(editorGroup);
  page.add(resetGroup);
  return page;
}

export function fillPreferencesWindow(window, settings) {
  const conflictChecker = createConflictChecker(settings);
  const ui = new PreferencesUi(window, settings);
  const refreshConflicts = [];
  ui.cleanup(
    conflictChecker.subscribe(() => {
      for (const refresh of refreshConflicts) refresh();
    }),
  );
  window.set_default_size(760, 640);

  const shortcutsPage = new Adw.PreferencesPage({
    title: "General",
    icon_name: "preferences-desktop-keyboard-shortcuts-symbolic",
  });
  window.add(shortcutsPage);

  const defaultsGroup = new Adw.PreferencesGroup({
    title: "Shortcut behavior",
  });
  for (
    const row of [
      [
        "Keybinding flags",
        "Meta.KeyBindingFlags for extension shortcuts",
        KEYBINDING_FLAG_NAMES,
        SETTING_KEYS.keybindingFlags,
      ],
      [
        "Action mode",
        "Shell.ActionMode for extension shortcuts",
        ACTION_MODE_NAMES,
        SETTING_KEYS.keybindingActionMode,
      ],
    ]
  ) {
    defaultsGroup.add(buildEnumRow(ui, ...row));
  }

  for (
    const [key, title, subtitle] of [
      [
        SETTING_KEYS.overrideConflictingBindings,
        "Override conflicting keybindings",
        "Automatically remove conflicting keybindings from system/shell settings and restore on disable; when off, commands with conflicts are skipped",
      ],
      [
        SETTING_KEYS.verboseLogging,
        "Verbose logging",
        "Enable extra logging for troubleshooting",
      ],
    ]
  ) {
    defaultsGroup.add(
      ui.bind(key, new Adw.SwitchRow({ title, subtitle }), "active"),
    );
  }

  shortcutsPage.add(defaultsGroup);

  const configGroups = {
    "cmd-win-optsize": () => buildWinOptsizeConfigGroup(ui),
    "cmd-win-mouseresize": () => buildWinMouseResizeConfigGroup(ui),
  };

  for (const command of COMMAND_DEFINITIONS) {
    const keybindings = buildKeybindingGroup(ui, command, conflictChecker);
    shortcutsPage.add(keybindings.group);
    refreshConflicts.push(keybindings.refresh);

    const buildConfig = configGroups[command.id];
    if (!buildConfig) continue;
    const page = new Adw.PreferencesPage({
      title: command.title,
      icon_name: command.icon,
    });
    page.add(buildConfig());
    window.add(page);
  }
  window.add(buildFullConfigPage(ui));
}
