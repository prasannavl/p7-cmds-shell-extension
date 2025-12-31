// prefs.js

import Adw from "gi://Adw";
import Gdk from "gi://Gdk";
import Gtk from "gi://Gtk";
import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
import {
	ACTION_MODE_NAMES,
	KEYBINDING_FLAG_NAMES,
	COMMAND_DEFINITIONS,
	DEFAULT_WIN_OPTSIZE_CONFIG,
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
	controller.connectObject(
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
		dialog,
	);
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

	row.connectObject(
		"notify::selected",
		() => {
			const selected = row.get_selected();
			const value = values[selected] ?? values[0];
			settings.set_string(key, value);
		},
		row,
	);

	return row;
}

function buildKeybindingGroup(settings, command, parent) {
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

		const bindings = settings.get_strv(command.key) ?? [];

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

			setButton.connectObject(
				"clicked",
				() => {
					captureShortcut(parent, (accel) => {
						const current = settings.get_strv(command.key) ?? [];
						const updated = [...current];
						updated[index] = accel;
						settings.set_strv(command.key, uniqueBindings(updated));
					});
				},
				group,
			);

			removeButton.connectObject(
				"clicked",
				() => {
					const current = settings.get_strv(command.key) ?? [];
					const updated = current.filter((_accel, i) => i !== index);
					settings.set_strv(command.key, updated);
				},
				group,
			);

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
		addButton.connectObject(
			"clicked",
			() => {
				captureShortcut(parent, (accel) => {
					const current = settings.get_strv(command.key) ?? [];
					const updated = uniqueBindings([...current, accel]);
					settings.set_strv(command.key, updated);
				});
			},
			group,
		);
		addRow.add_suffix(addButton);
		addRowWidget(addRow);
	};

	refresh();
	settings.connectObject(`changed::${command.key}`, refresh, group);

	return group;
}

const COMMANDS = COMMAND_DEFINITIONS;

function parseWinOptsizeConfig(rawValue) {
	const defaults = JSON.parse(JSON.stringify(DEFAULT_WIN_OPTSIZE_CONFIG));
	if (typeof rawValue !== "string") {
		return defaults;
	}
	const trimmed = rawValue.trim();
	if (!trimmed) {
		return defaults;
	}
	try {
		const parsed = JSON.parse(trimmed);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return defaults;
		}
		return normalizeWinOptsizeConfig(parsed);
	} catch (_error) {
		return defaults;
	}
}

function parseWinOptsizeConfigStrict(rawValue) {
	if (typeof rawValue !== "string") {
		return { ok: false, error: "Expected a JSON string." };
	}
	const trimmed = rawValue.trim();
	if (!trimmed) {
		return { ok: false, error: "JSON is empty." };
	}
	try {
		const parsed = JSON.parse(trimmed);
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
			return { ok: false, error: "JSON must be an object." };
		}
		return { ok: true, value: normalizeWinOptsizeConfig(parsed) };
	} catch (error) {
		return { ok: false, error: error?.message ?? "Invalid JSON." };
	}
}

function normalizeWinOptsizeConfig(rawConfig) {
	const defaults = JSON.parse(JSON.stringify(DEFAULT_WIN_OPTSIZE_CONFIG));
	const config =
		rawConfig && typeof rawConfig === "object" && !Array.isArray(rawConfig)
			? rawConfig
			: {};
	if (!Array.isArray(config["default-scales"])) {
		config["default-scales"] = defaults["default-scales"];
	}
	if (!Array.isArray(config.breakpoints)) {
		config.breakpoints = defaults.breakpoints;
	}
	if (typeof config.aspectBasedInversion !== "boolean") {
		config.aspectBasedInversion = defaults.aspectBasedInversion;
	}
	return config;
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
	spin.connectObject(
		"value-changed",
		() => {
			onChange(spin.get_value());
		},
		row,
	);
	row.add_suffix(spin);
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

	widthSpin.connectObject(
		"value-changed",
		() => {
			scale[0] = widthSpin.get_value();
			onChange();
		},
		row,
	);
	heightSpin.connectObject(
		"value-changed",
		() => {
			scale[1] = heightSpin.get_value();
			onChange();
		},
		row,
	);
	autoHeightToggle.connectObject(
		"toggled",
		() => {
			if (autoHeightToggle.get_active()) {
				scale[1] = null;
				heightSpin.set_sensitive(false);
			} else {
				scale[1] = heightSpin.get_value();
				heightSpin.set_sensitive(true);
			}
			onChange();
		},
		row,
	);
	removeButton.connectObject("clicked", onRemove, row);

	return row;
}

function buildWinOptsizeConfigGroup(settings) {
	const configGroup = new Adw.PreferencesGroup({
		title: "Config",
		description:
			"Configure breakpoints, scales, and aspect-based inversion. Auto keeps aspect height.",
	});

	const rows = [];
	let lastSerialized = null;
	let jsonDirty = false;
	let settingJson = false;
	const jsonGroup = new Adw.PreferencesGroup({
		title: "Config JSON",
		description: "Edit the JSON and apply it to update the config.",
	});
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

	const saveConfig = () => {
		const serialized = serializeConfig(config);
		lastSerialized = serialized;
		settings.set_string("win-optsize-config", serialized);
		if (!jsonDirty) {
			setJsonText(serialized);
		}
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
		aspectRow.connectObject(
			"notify::active",
			() => {
				config.aspectBasedInversion = aspectRow.get_active();
				saveConfig();
			},
			aspectRow,
		);
		addRow(aspectRow);

		addRow(
			new Adw.ActionRow({
				title: "Default scales",
				subtitle: "Used when no breakpoint matches",
			}),
		);

		const defaultScales = config["default-scales"];
		const defaultScaleRows = [];
		const updateDefaultScaleTitles = () => {
			defaultScaleRows.forEach((row, index) => {
				row.set_title(`Scale ${index + 1}`);
			});
		};
		const addDefaultScaleRowWidget = (scale) => {
			const row = buildScaleRow(
				scale,
				defaultScaleRows.length,
				saveConfig,
				() => {
					const rowIndex = defaultScaleRows.indexOf(row);
					if (rowIndex < 0) {
						return;
					}
					defaultScales.splice(rowIndex, 1);
					defaultScaleRows.splice(rowIndex, 1);
					removeRow(row);
					updateDefaultScaleTitles();
					saveConfig();
				},
			);
			defaultScaleRows.push(row);
			return row;
		};

		const addDefaultScaleRow = new Adw.ActionRow({
			title: "Add default scale",
		});
		const addDefaultScaleButton = new Gtk.Button({ label: "Add" });
		addDefaultScaleButton.connectObject(
			"clicked",
			() => {
				const scale = [0.8, 0.8];
				defaultScales.push(scale);
				const row = addDefaultScaleRowWidget(scale);
				removeRow(addDefaultScaleRow);
				addRow(row);
				addRow(addDefaultScaleRow);
				updateDefaultScaleTitles();
				saveConfig();
			},
			addDefaultScaleRow,
		);
		addDefaultScaleRow.add_suffix(addDefaultScaleButton);
		defaultScales.forEach((scale, index) => {
			if (!Array.isArray(scale)) {
				defaultScales[index] = [0.8, 0.8];
				scale = defaultScales[index];
			}
			addRow(addDefaultScaleRowWidget(scale));
		});
		addRow(addDefaultScaleRow);

		addRow(
			new Adw.ActionRow({
				title: "Breakpoints",
				subtitle: "Ordered; first match wins",
			}),
		);

		const breakpoints = config.breakpoints;
		breakpoints.forEach((breakpoint, index) => {
			const expander = new Adw.ExpanderRow({
				title: `Breakpoint ${index + 1}`,
			});

			const removeButton = new Gtk.Button({ label: "Remove" });
			removeButton.connectObject(
				"clicked",
				() => {
					breakpoints.splice(index, 1);
					saveConfig();
					render();
				},
				expander,
			);
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
					saveConfig();
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
					saveConfig();
				},
			});
			maxHeightRow.set_sensitive(hasMaxHeight);

			const maxHeightToggle = new Adw.SwitchRow({
				title: "Limit by max height",
				active: hasMaxHeight,
			});
			maxHeightToggle.connectObject(
				"notify::active",
				() => {
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
					saveConfig();
				},
				expander,
			);

			expander.add_row(maxHeightToggle);
			expander.add_row(maxHeightRow);

			const scalesHeader = new Adw.ActionRow({ title: "Scales" });
			expander.add_row(scalesHeader);

			const scales = breakpoint.scales ?? [];
			breakpoint.scales = scales;
			const scaleRows = [];
			const updateScaleTitles = () => {
				scaleRows.forEach((row, rowIndex) => {
					row.set_title(`Scale ${rowIndex + 1}`);
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
					const parent = row.get_parent();
					if (parent && typeof parent.remove === "function") {
						parent.remove(row);
					}
					updateScaleTitles();
					saveConfig();
				});
				scaleRows.push(row);
				return row;
			};
			scales.forEach((scale, scaleIndex) => {
				if (!Array.isArray(scale)) {
					scales[scaleIndex] = [0.8, 0.8];
					scale = scales[scaleIndex];
				}
				expander.add_row(addScaleRowWidget(scale));
			});

			const addScaleRow = new Adw.ActionRow({ title: "Add scale" });
			const addScaleButton = new Gtk.Button({ label: "Add" });
			addScaleButton.connectObject(
				"clicked",
				() => {
					const scale = [0.8, 0.8];
					scales.push(scale);
					const row = addScaleRowWidget(scale);
					const parent = addScaleRow.get_parent();
					if (parent && typeof parent.remove === "function") {
						parent.remove(addScaleRow);
					}
					expander.add_row(row);
					expander.add_row(addScaleRow);
					updateScaleTitles();
					saveConfig();
				},
				expander,
			);
			addScaleRow.add_suffix(addScaleButton);
			expander.add_row(addScaleRow);

			addRow(expander);
		});

		const addBreakpointRow = new Adw.ActionRow({
			title: "Add breakpoint",
		});
		const addBreakpointButton = new Gtk.Button({ label: "Add" });
		addBreakpointButton.connectObject(
			"clicked",
			() => {
				breakpoints.push({
					maxWidth: 1920,
					scales: [[0.8, 0.8]],
				});
				saveConfig();
				render();
			},
			addBreakpointRow,
		);
		addBreakpointRow.add_suffix(addBreakpointButton);
		addRow(addBreakpointRow);

		const resetRow = new Adw.ActionRow({
			title: "Reset to defaults",
		});
		const resetButton = new Gtk.Button({ label: "Reset" });
		resetButton.connectObject(
			"clicked",
			() => {
				const defaultValue = settings.get_default_value("win-optsize-config");
				if (defaultValue) {
					settings.set_value("win-optsize-config", defaultValue);
				}
			},
			resetRow,
		);
		resetRow.add_suffix(resetButton);
		addRow(resetRow);
	};

	render();
	settings.connectObject(
		"changed::win-optsize-config",
		() => {
			if (settings.get_string("win-optsize-config") === lastSerialized) {
				return;
			}
			render();
		},
		configGroup,
	);

	jsonBuffer.connectObject(
		"changed",
		() => {
			if (settingJson) {
				return;
			}
			jsonDirty = true;
			applyButton.set_sensitive(true);
			reloadButton.set_sensitive(true);
			jsonErrorRow.set_visible(false);
		},
		jsonGroup,
	);

	applyButton.connectObject(
		"clicked",
		() => {
			const result = parseWinOptsizeConfigStrict(getJsonText());
			if (!result.ok) {
				jsonErrorRow.set_subtitle(result.error);
				jsonErrorRow.set_visible(true);
				return;
			}
			const serialized = serializeConfig(result.value);
			lastSerialized = serialized;
			setJsonText(serialized);
			settings.set_string("win-optsize-config", serialized);
		},
		jsonGroup,
	);

	reloadButton.connectObject(
		"clicked",
		() => {
			setJsonText(serializeConfig(config));
		},
		jsonGroup,
	);

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

export default class P7ShortcutsPreferences extends ExtensionPreferences {
	fillPreferencesWindow(window) {
		const settings = this.getSettings();
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
		shortcutsPage.add(defaultsGroup);

		for (const command of COMMANDS) {
			shortcutsPage.add(buildKeybindingGroup(settings, command, window));
		}

		const optsizePage = new Adw.PreferencesPage({
			title: "Win optsize",
			icon_name: "window-maximize-symbolic",
		});
		window.add(optsizePage);
		optsizePage.add(buildWinOptsizeConfigGroup(settings));
	}
}
