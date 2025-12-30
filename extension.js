// extension.js

import { ConfigManager } from "./config.js";
import { KeybindManager } from "./keybindmanager.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

export default class P7ShortcutsExtension extends Extension {
	constructor(metadata) {
		super(metadata);

		/** @type {ConfigManager | null} */
		this.configManager = null;
		/** @type {KeybindManager | null} */
		this.keybindManager = null;
		this._configChangeCallback = null;
		this._logger = null;
	}

	enable() {
		this._logger = this.getLogger();
		this._logger.log("Extension enabled");

		this.configManager = new ConfigManager(this.getSettings(), this._logger);
		this.keybindManager = new KeybindManager(
			this.getSettings(),
			this.configManager,
			this._logger,
		);
		this.keybindManager.enable();
		this._configChangeCallback = (changeType) => {
			this._logger.log(`Config changed: ${changeType}`);
			this._onConfigChanged(changeType);
		};
		this.configManager.addConfigChangeListener(this._configChangeCallback);
	}

	disable() {
		if (this._logger) {
			this._logger.log("Extension disabled");
		}
		if (this._configChangeCallback && this.configManager) {
			this.configManager.removeConfigChangeListener(this._configChangeCallback);
		}

		if (this.keybindManager) {
			this.keybindManager.disable();
			this.keybindManager = null;
		}

		if (this.configManager) {
			this.configManager.destroy();
			this.configManager = null;
		}
		this._configChangeCallback = null;
		this._logger = null;
	}

	_onConfigChanged(changeType) {
		if (changeType === "settings-changed" && this.keybindManager) {
			this.keybindManager.reload();
		}
	}
}
