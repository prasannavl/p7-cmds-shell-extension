// prefs.js

import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import GLib from "gi://GLib";
import Gtk from "gi://Gtk";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
import {
  ACTION_MODE_NAMES,
  COMMAND_DEFINITIONS,
  KEYBINDING_FLAG_NAMES,
  parseWinOptsizeConfig,
} from "./common.js";

function uniqueBindings(bindings) {
  const seen = new Set();
  const result = [];
  for (const binding of bindings) {
    if (!binding || seen.has(binding)) {
      continue;
    }
    seen.add(binding);
    result.push(binding);
  }
  return result;
}

function captureShortcut(parent, onDone) {
  const dialog = new Adw.Window({
    title: "Set Shortcut",
    modal: true,
    transient_for: parent,
    default_width: 360,
    default_height: 140,
  });

  const content = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 12,
    margin_top: 24,
    margin_bottom: 24,
    margin_start: 24,
    margin_end: 24,
  });

  content.append(
    new Gtk.Label({
      label: "Press a key combination, or Esc to cancel.",
      wrap: true,
      justify: Gtk.Justification.CENTER,
    }),
  );

  dialog.set_content(content);

  const controller = new Gtk.EventControllerKey();
  const controllerId = controller.connect(
    "key-pressed",
    (_controller, keyval, _keycode, state) => {
      if (keyval === Gdk.KEY_Escape) {
        dialog.close();
        return Gdk.EVENT_STOP;
      }

      const mods = state & Gtk.accelerator_get_default_mod_mask();
      if (!Gtk.accelerator_valid(keyval, mods)) {
        return Gdk.EVENT_STOP;
      }

      const accel = Gtk.accelerator_name(keyval, mods);
      if (accel) {
        onDone(accel);
      }
      dialog.close();
      return Gdk.EVENT_STOP;
    },
  );
  dialog.connect("close-request", () => {
    controller.disconnect(controllerId);
    return false;
  });
  dialog.add_controller(controller);
  dialog.present();
}

function buildEnumRow(settings, title, subtitle, values, key) {
  const model = new Gtk.StringList();
  for (const value of values) {
    model.append(value);
  }

  const row = new Adw.ComboRow({
    title,
    subtitle,
    model,
  });

  const current = settings.get_string(key);
  const currentIndex = values.indexOf(current);
  row.set_selected(currentIndex >= 0 ? currentIndex : 0);

  row.connect("notify::selected", () => {
    const selected = row.get_selected();
    const value = values[selected] ?? values[0];
    settings.set_string(key, value);
  });

  return row;
}

function buildKeybindingGroup(
  settings,
  command,
  registerSettingsChange,
  parent,
) {
  const group = new Adw.PreferencesGroup({
    title: command.title,
    description: command.description,
  });
  const rows = [];

  const clearRows = () => {
    for (const row of rows) {
      group.remove(row);
    }
    rows.length = 0;
  };

  const addRowWidget = (row) => {
    group.add(row);
    rows.push(row);
  };

  const refresh = () => {
    clearRows();

    const bindings = settings.get_strv(command.id) ?? [];

    bindings.forEach((binding, index) => {
      const row = new Adw.ActionRow({
        title: `Shortcut ${index + 1}`,
      });

      const shortcutLabel = new Gtk.ShortcutLabel({
        accelerator: binding,
        valign: Gtk.Align.CENTER,
      });

      const setButton = new Gtk.Button({
        label: "Set",
        valign: Gtk.Align.CENTER,
      });

      const removeButton = new Gtk.Button({
        label: "Remove",
        valign: Gtk.Align.CENTER,
      });

      setButton.connect("clicked", () => {
        captureShortcut(parent, (accel) => {
          const current = settings.get_strv(command.id) ?? [];
          const updated = [...current];
          updated[index] = accel;
          settings.set_strv(command.id, uniqueBindings(updated));
        });
      });

      removeButton.connect("clicked", () => {
        const current = settings.get_strv(command.id) ?? [];
        const updated = current.filter((_accel, i) => i !== index);
        settings.set_strv(command.id, updated);
      });

      row.add_suffix(shortcutLabel);
      row.add_suffix(setButton);
      row.add_suffix(removeButton);
      addRowWidget(row);
    });

    const addRow = new Adw.ActionRow({
      title: "Add shortcut",
    });
    const addButton = new Gtk.Button({
      label: "Add",
      valign: Gtk.Align.CENTER,
    });
    addButton.connect("clicked", () => {
      captureShortcut(parent, (accel) => {
        const current = settings.get_strv(command.id) ?? [];
        const updated = uniqueBindings([...current, accel]);
        settings.set_strv(command.id, updated);
      });
    });
    addRow.add_suffix(addButton);
    addRowWidget(addRow);
  };

  refresh();
  registerSettingsChange(command.id, refresh);

  return group;
}

function buildSpinRow({ title, value, digits, min, max, step, onChange }) {
  const row = new Adw.ActionRow({ title });
  const adjustment = new Gtk.Adjustment({
    lower: min,
    upper: max,
    step_increment: step,
    page_increment: step,
  });
  const spin = new Gtk.SpinButton({
    adjustment,
    digits,
    numeric: true,
  });
  spin.set_value(value ?? min);
  spin.connect("value-changed", () => {
    onChange(spin.get_value());
  });
  row.add_suffix(spin);
  return row;
}

function buildIntRow({
  settings,
  registerSettingsChange,
  key,
  title,
  subtitle,
  min,
  max,
  step,
}) {
  const row = new Adw.ActionRow({ title, subtitle });
  const adjustment = new Gtk.Adjustment({
    lower: min,
    upper: max,
    step_increment: step,
    page_increment: step,
  });
  const spin = new Gtk.SpinButton({
    adjustment,
    digits: 0,
    numeric: true,
  });
  spin.set_valign(Gtk.Align.CENTER);
  spin.set_value(settings.get_int(key));
  row.add_suffix(spin);

  let settingValue = false;
  const applyFromSettings = () => {
    settingValue = true;
    spin.set_value(settings.get_int(key));
    settingValue = false;
  };

  registerSettingsChange(key, applyFromSettings);

  spin.connect("value-changed", () => {
    if (settingValue) {
      return;
    }
    settings.set_int(key, Math.round(spin.get_value()));
  });

  return row;
}

function getDefaultString(settings, key) {
  const defaultValue = settings.get_default_value(key);
  if (!defaultValue) {
    return "";
  }
  const value = defaultValue.deepUnpack?.();
  return typeof value === "string" ? value : "";
}

function parseRgba(value, fallback) {
  const rgba = new Gdk.RGBA();
  const normalized =
    typeof value === "string" && value.trim() ? value.trim() : "";
  if (normalized && rgba.parse(normalized)) {
    return rgba;
  }
  const fallbackValue =
    typeof fallback === "string" && fallback.trim() ? fallback.trim() : "";
  if (fallbackValue) {
    rgba.parse(fallbackValue);
  }
  return rgba;
}

function buildColorRow({
  settings,
  registerSettingsChange,
  title,
  subtitle,
  key,
  withAlpha,
}) {
  const row = new Adw.ActionRow({
    title,
    subtitle,
  });
  const dialog = new Gtk.ColorDialog({
    with_alpha: withAlpha === true,
  });
  const button = new Gtk.ColorDialogButton({ dialog });
  button.set_valign(Gtk.Align.CENTER);
  row.add_suffix(button);

  const defaultValue = getDefaultString(settings, key);
  let settingColor = false;

  const applyFromSettings = () => {
    settingColor = true;
    button.set_rgba(parseRgba(settings.get_string(key), defaultValue));
    settingColor = false;
  };

  applyFromSettings();
  registerSettingsChange(key, applyFromSettings);

  button.connect("notify::rgba", () => {
    if (settingColor) {
      return;
    }
    const rgba = button.get_rgba();
    if (!rgba) {
      return;
    }
    settings.set_string(key, rgba.to_string());
  });

  return row;
}

function buildScaleRow(scale, index, onChange, onRemove) {
  if (!Array.isArray(scale)) {
    scale = [0.8, 0.8];
  }
  const widthValue = typeof scale[0] === "number" ? scale[0] : 0.8;
  const heightValue = scale.length > 1 ? scale[1] : 0.8;
  const autoHeight = heightValue === null;

  const row = new Adw.ActionRow({
    title: `Scale ${index + 1}`,
  });

  const widthSpin = new Gtk.SpinButton({
    adjustment: new Gtk.Adjustment({
      lower: 0.1,
      upper: 1,
      step_increment: 0.05,
      page_increment: 0.1,
    }),
    digits: 2,
    numeric: true,
  });
  widthSpin.set_value(widthValue);

  const heightSpin = new Gtk.SpinButton({
    adjustment: new Gtk.Adjustment({
      lower: 0.1,
      upper: 1,
      step_increment: 0.05,
      page_increment: 0.1,
    }),
    digits: 2,
    numeric: true,
  });
  heightSpin.set_value(typeof heightValue === "number" ? heightValue : 0.8);
  heightSpin.set_sensitive(!autoHeight);

  const autoHeightToggle = new Gtk.CheckButton({
    label: "Auto",
    active: autoHeight,
  });

  const removeButton = new Gtk.Button({
    label: "Remove",
  });

  const controlBox = new Gtk.Box({
    orientation: Gtk.Orientation.HORIZONTAL,
    spacing: 6,
  });
  controlBox.append(widthSpin);
  controlBox.append(heightSpin);
  controlBox.append(autoHeightToggle);
  controlBox.append(removeButton);
  row.add_suffix(controlBox);

  widthSpin.connect("value-changed", () => {
    scale[0] = widthSpin.get_value();
    onChange();
  });
  heightSpin.connect("value-changed", () => {
    scale[1] = heightSpin.get_value();
    onChange();
  });
  autoHeightToggle.connect("toggled", () => {
    if (autoHeightToggle.get_active()) {
      scale[1] = null;
      heightSpin.set_sensitive(false);
    } else {
      scale[1] = heightSpin.get_value();
      heightSpin.set_sensitive(true);
    }
    onChange();
  });
  removeButton.connect("clicked", onRemove);

  return row;
}

function buildScaleList({
  scales,
  addRow,
  removeRow,
  saveConfig,
  addRowTitle,
}) {
  const scaleRows = [];
  const updateScaleTitles = () => {
    scaleRows.forEach((row, index) => {
      row.set_title(`Scale ${index + 1}`);
    });
  };
  const addScaleRowWidget = (scale) => {
    const row = buildScaleRow(scale, scaleRows.length, saveConfig, () => {
      const rowIndex = scaleRows.indexOf(row);
      if (rowIndex < 0) {
        return;
      }
      scales.splice(rowIndex, 1);
      scaleRows.splice(rowIndex, 1);
      removeRow(row);
      updateScaleTitles();
      saveConfig();
    });
    scaleRows.push(row);
    return row;
  };

  scales.forEach((scale, index) => {
    if (!Array.isArray(scale)) {
      scales[index] = [0.8, 0.8];
      scale = scales[index];
    }
    addRow(addScaleRowWidget(scale));
  });

  const addScaleRow = new Adw.ActionRow({ title: addRowTitle ?? "Add scale" });
  const addScaleButton = new Gtk.Button({ label: "Add" });
  addScaleButton.connect("clicked", () => {
    const scale = [0.8, 0.8];
    scales.push(scale);
    const row = addScaleRowWidget(scale);
    removeRow(addScaleRow);
    addRow(row);
    addRow(addScaleRow);
    updateScaleTitles();
    saveConfig();
  });
  addScaleRow.add_suffix(addScaleButton);
  addRow(addScaleRow);
  updateScaleTitles();
}

function buildWinOptsizeConfigGroup(settings, registerSettingsChange, _parent) {
  const configGroup = new Adw.PreferencesGroup();

  const rows = [];
  let lastSerialized = null;
  let jsonDirty = false;
  let settingJson = false;
  let saveTimeoutId = null;
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
  });
  jsonView.set_hexpand(true);
  jsonView.set_vexpand(true);
  const jsonScroll = new Gtk.ScrolledWindow({
    hscrollbar_policy: Gtk.PolicyType.AUTOMATIC,
    min_content_height: 160,
  });
  jsonScroll.set_hexpand(true);
  jsonScroll.set_vexpand(true);
  jsonScroll.set_child(jsonView);
  const jsonRow = new Adw.PreferencesRow();
  jsonRow.set_child(jsonScroll);
  jsonRow.set_hexpand(true);
  jsonRow.set_vexpand(true);
  let config = parseWinOptsizeConfig(settings.get_string("win-optsize-config"));
  const applyButton = new Gtk.Button({ label: "Apply" });
  const reloadButton = new Gtk.Button({ label: "Reload" });
  applyButton.set_sensitive(false);
  reloadButton.set_sensitive(false);

  const setJsonText = (text) => {
    settingJson = true;
    jsonBuffer.set_text(text, -1);
    settingJson = false;
    jsonDirty = false;
    applyButton.set_sensitive(false);
    reloadButton.set_sensitive(false);
    jsonErrorRow.set_visible(false);
  };

  const getJsonText = () => {
    const [start, end] = jsonBuffer.get_bounds();
    return jsonBuffer.get_text(start, end, false);
  };

  const clearRows = () => {
    for (const row of rows) {
      configGroup.remove(row);
    }
    rows.length = 0;
  };

  const addRow = (row) => {
    configGroup.add(row);
    rows.push(row);
  };

  const removeRow = (row) => {
    const index = rows.indexOf(row);
    if (index >= 0) {
      rows.splice(index, 1);
    }
    configGroup.remove(row);
  };

  const serializeConfig = (currentConfig) =>
    JSON.stringify(currentConfig, null, 2);

  const saveConfigNow = () => {
    const serialized = serializeConfig(config);
    lastSerialized = serialized;
    settings.set_string("win-optsize-config", serialized);
    if (!jsonDirty) {
      setJsonText(serialized);
    }
  };

  const scheduleSaveConfig = () => {
    if (saveTimeoutId) {
      GLib.Source.remove(saveTimeoutId);
    }
    saveTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
      saveTimeoutId = null;
      saveConfigNow();
      return GLib.SOURCE_REMOVE;
    });
  };

  const buildBreakpointRow = (breakpoint, onRemove) => {
    const expander = new Adw.ExpanderRow({
      title: "Breakpoint",
    });

    const removeButton = new Gtk.Button({ label: "Remove" });
    removeButton.connect("clicked", onRemove);
    expander.add_suffix(removeButton);

    const maxWidthRow = buildSpinRow({
      title: "Max width",
      value: breakpoint.maxWidth ?? 1920,
      digits: 0,
      min: 320,
      max: 10000,
      step: 10,
      onChange: (value) => {
        breakpoint.maxWidth = Math.round(value);
        scheduleSaveConfig();
      },
    });
    expander.add_row(maxWidthRow);

    const hasMaxHeight = typeof breakpoint.maxHeight === "number";
    const maxHeightRow = buildSpinRow({
      title: "Max height",
      value: hasMaxHeight ? breakpoint.maxHeight : 1080,
      digits: 0,
      min: 320,
      max: 10000,
      step: 10,
      onChange: (value) => {
        breakpoint.maxHeight = Math.round(value);
        scheduleSaveConfig();
      },
    });
    maxHeightRow.set_sensitive(hasMaxHeight);

    const maxHeightToggle = new Adw.SwitchRow({
      title: "Limit by max height",
      active: hasMaxHeight,
    });
    maxHeightToggle.connect("notify::active", () => {
      if (maxHeightToggle.get_active()) {
        breakpoint.maxHeight = Math.round(
          typeof breakpoint.maxHeight === "number"
            ? breakpoint.maxHeight
            : 1080,
        );
        maxHeightRow.set_sensitive(true);
      } else {
        breakpoint.maxHeight = null;
        maxHeightRow.set_sensitive(false);
      }
      scheduleSaveConfig();
    });

    expander.add_row(maxHeightToggle);
    expander.add_row(maxHeightRow);

    const scalesHeader = new Adw.ActionRow({ title: "Scales" });
    expander.add_row(scalesHeader);

    const scales = breakpoint.scales ?? [];
    breakpoint.scales = scales;
    buildScaleList({
      scales,
      addRow: (row) => expander.add_row(row),
      removeRow: (row) => {
        const parent = row.get_parent();
        if (parent && typeof parent.remove === "function") {
          parent.remove(row);
        }
      },
      saveConfig: scheduleSaveConfig,
    });

    return expander;
  };

  const render = () => {
    clearRows();
    config = parseWinOptsizeConfig(settings.get_string("win-optsize-config"));
    if (!jsonDirty) {
      setJsonText(serializeConfig(config));
    }

    // Aspect-based inversion toggle
    const aspectRow = new Adw.SwitchRow({
      title: "Enable aspect-based inversion",
      subtitle: "Invert width/height for portrait screens",
      active: !!config.aspectBasedInversion,
    });
    aspectRow.connect("notify::active", () => {
      config.aspectBasedInversion = aspectRow.get_active();
      scheduleSaveConfig();
    });
    addRow(aspectRow);

    addRow(
      new Adw.ActionRow({
        title: "Default scales",
        subtitle: "Used when no breakpoint matches",
      }),
    );

    const defaultScales = config.scales;
    buildScaleList({
      scales: defaultScales,
      addRow,
      removeRow,
      saveConfig: scheduleSaveConfig,
      addRowTitle: "Add default scale",
    });

    addRow(
      new Adw.ActionRow({
        title: "Breakpoints",
        subtitle: "Ordered; first match wins",
      }),
    );

    const breakpoints = config.breakpoints;
    const breakpointRows = [];
    const updateBreakpointTitles = () => {
      breakpointRows.forEach((row, index) => {
        row.set_title(`Breakpoint ${index + 1}`);
      });
    };
    const addBreakpointRowWidget = (breakpoint) => {
      const row = buildBreakpointRow(breakpoint, () => {
        const rowIndex = breakpointRows.indexOf(row);
        if (rowIndex < 0) {
          return;
        }
        breakpoints.splice(rowIndex, 1);
        breakpointRows.splice(rowIndex, 1);
        removeRow(row);
        updateBreakpointTitles();
        scheduleSaveConfig();
      });
      breakpointRows.push(row);
      return row;
    };

    breakpoints.forEach((breakpoint) => {
      addRow(addBreakpointRowWidget(breakpoint));
    });
    updateBreakpointTitles();

    const addBreakpointRow = new Adw.ActionRow({
      title: "Add breakpoint",
    });
    const addBreakpointButton = new Gtk.Button({ label: "Add" });
    addBreakpointButton.connect("clicked", () => {
      const breakpoint = {
        maxWidth: 1920,
        scales: [[0.8, 0.8]],
      };
      breakpoints.push(breakpoint);
      const row = addBreakpointRowWidget(breakpoint);
      removeRow(addBreakpointRow);
      addRow(row);
      addRow(addBreakpointRow);
      updateBreakpointTitles();
      scheduleSaveConfig();
    });
    addBreakpointRow.add_suffix(addBreakpointButton);
    addRow(addBreakpointRow);

    const resetRow = new Adw.ActionRow({
      title: "Reset to defaults",
    });
    const resetButton = new Gtk.Button({ label: "Reset" });
    resetButton.connect("clicked", () => {
      const defaultValue = settings.get_default_value("win-optsize-config");
      if (defaultValue) {
        settings.set_value("win-optsize-config", defaultValue);
      }
    });
    resetRow.add_suffix(resetButton);
    addRow(resetRow);
  };

  render();
  registerSettingsChange("win-optsize-config", () => {
    if (settings.get_string("win-optsize-config") === lastSerialized) {
      return;
    }
    if (saveTimeoutId) {
      GLib.Source.remove(saveTimeoutId);
      saveTimeoutId = null;
    }
    render();
  });

  jsonBuffer.connect("changed", () => {
    if (settingJson) {
      return;
    }
    jsonDirty = true;
    applyButton.set_sensitive(true);
    reloadButton.set_sensitive(true);
    jsonErrorRow.set_visible(false);
  });

  applyButton.connect("clicked", () => {
    const result = parseWinOptsizeConfig(getJsonText(), { strict: true });
    if (!result.ok) {
      jsonErrorRow.set_subtitle(result.error);
      jsonErrorRow.set_visible(true);
      return;
    }
    config = result.value;
    saveConfigNow();
    render();
  });

  reloadButton.connect("clicked", () => {
    setJsonText(serializeConfig(config));
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
  stack.set_hexpand(true);
  stack.set_vexpand(true);

  const switcherBar = new Adw.ViewSwitcherBar({
    stack,
    reveal: true,
  });

  const layout = new Gtk.Box({
    orientation: Gtk.Orientation.VERTICAL,
    spacing: 12,
    hexpand: true,
  });
  layout.set_vexpand(true);
  layout.append(stack);
  layout.append(switcherBar);

  const wrapperGroup = new Adw.PreferencesGroup({
    title: "Win optsize config",
  });
  const layoutRow = new Adw.PreferencesRow();
  layoutRow.set_child(layout);
  layoutRow.set_vexpand(true);
  wrapperGroup.add(layoutRow);

  return wrapperGroup;
}

function buildWinMouseResizeConfigGroup(settings, registerSettingsChange) {
  const group = new Adw.PreferencesGroup({
    title: "Resize indicator",
    description: "Customize border and background colors for win_mouseresize.",
  });

  group.add(
    buildColorRow({
      settings,
      registerSettingsChange,
      title: "Border color",
      subtitle: "CSS color for the resize outline.",
      key: "win-mouseresize-border-color",
      withAlpha: true,
    }),
  );
  group.add(
    buildColorRow({
      settings,
      registerSettingsChange,
      title: "Background color",
      subtitle: "CSS color for the resize fill.",
      key: "win-mouseresize-background-color",
      withAlpha: true,
    }),
  );
  group.add(
    buildIntRow({
      settings,
      registerSettingsChange,
      key: "win-mouseresize-border-size",
      title: "Border size",
      subtitle: "Border thickness in pixels.",
      min: 1,
      max: 20,
      step: 1,
    }),
  );

  const resetRow = new Adw.ActionRow({
    title: "Reset to defaults",
  });
  const resetButton = new Gtk.Button({ label: "Reset" });
  resetButton.connect("clicked", () => {
    for (const key of [
      "win-mouseresize-border-color",
      "win-mouseresize-background-color",
    ]) {
      const defaultValue = settings.get_default_value(key);
      if (defaultValue) {
        settings.set_value(key, defaultValue);
      }
    }
  });
  resetRow.add_suffix(resetButton);
  group.add(resetRow);

  return group;
}

export default class P7ShortcutsPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    const settings = this.getSettings();
    let signals = [];
    const registerSettingsChange = (key, handler) => {
      const id = settings.connect(`changed::${key}`, handler);
      signals.push([settings, id]);
    };
    window.connect("close-request", () => {
      for (const [object, id] of signals) {
        object.disconnect(id);
      }
      signals = [];
      return false;
    });
    window.set_default_size(760, 640);

    const shortcutsPage = new Adw.PreferencesPage({
      title: "P7 Commands",
      icon_name: "preferences-desktop-keyboard-shortcuts-symbolic",
    });
    window.add(shortcutsPage);

    const defaultsGroup = new Adw.PreferencesGroup({
      title: "Defaults",
    });
    defaultsGroup.add(
      buildEnumRow(
        settings,
        "Keybinding flags",
        "Meta.KeyBindingFlags for extension shortcuts",
        KEYBINDING_FLAG_NAMES,
        "keybinding-flags",
      ),
    );
    defaultsGroup.add(
      buildEnumRow(
        settings,
        "Action mode",
        "Shell.ActionMode for extension shortcuts",
        ACTION_MODE_NAMES,
        "keybinding-actionmode",
      ),
    );

    const overrideRow = new Adw.SwitchRow({
      title: "Override conflicting keybindings",
      subtitle:
        "Automatically remove conflicting keybindings from system/shell settings and restore on disable",
    });
    overrideRow.set_active(
      settings.get_boolean("override-conflicting-bindings"),
    );
    overrideRow.connect("notify::active", () => {
      settings.set_boolean(
        "override-conflicting-bindings",
        overrideRow.get_active(),
      );
    });
    defaultsGroup.add(overrideRow);

    const verboseRow = new Adw.SwitchRow({
      title: "Verbose logging",
      subtitle: "Enable extra logging for troubleshooting",
    });
    verboseRow.set_active(settings.get_boolean("verbose-logging"));
    verboseRow.connect("notify::active", () => {
      settings.set_boolean("verbose-logging", verboseRow.get_active());
    });
    defaultsGroup.add(verboseRow);

    shortcutsPage.add(defaultsGroup);

    for (const command of COMMAND_DEFINITIONS) {
      shortcutsPage.add(
        buildKeybindingGroup(settings, command, registerSettingsChange, window),
      );

      if (command.id === "cmd-win-optsize") {
        const optsizePage = new Adw.PreferencesPage({
          title: command.title,
          icon_name: command.icon,
        });
        window.add(optsizePage);
        optsizePage.add(
          buildWinOptsizeConfigGroup(settings, registerSettingsChange, window),
        );
      }

      if (command.id === "cmd-win-mouseresize") {
        const mouseResizePage = new Adw.PreferencesPage({
          title: command.title,
          icon_name: command.icon,
        });
        window.add(mouseResizePage);
        mouseResizePage.add(
          buildWinMouseResizeConfigGroup(settings, registerSettingsChange),
        );
      }
    }
  }
}
