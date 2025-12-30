// extension.js

import { ConfigManager } from "./config.js";
import { KeyBindManager } from "./keybindmanager.js";
import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";

export default class P7ShortcutsExtension extends Extension {
	constructor(metadata) {
		super(metadata);

		/** @type {ConfigManager | null} */
		this.configManager = null;
		/** @type {KeyBindManager | null} */
		this.keyBindManager = null;
		this._configChangeCallback = null;
		this._logger = null;
	}

	enable() {
		this._logger = this.getLogger();
		this._logger.log("Extension enabled");

		this.configManager = new ConfigManager(this.getSettings(), this._logger);
		this.keyBindManager = new KeyBindManager(
			this.getSettings(),
			this.configManager,
			this._logger,
		);
		this.keyBindManager.enable();
		this._configChangeCallback = (x) => this._onConfigChanged(x);
		this.configManager.addConfigChangeListener(this._configChangeCallback);
	}

	disable() {
		if (this._logger) {
			this._logger.log("Extension disabled");
		}
		if (this._configChangeCallback && this.configManager) {
			this.configManager.removeConfigChangeListener(this._configChangeCallback);
		}

		if (this.keyBindManager) {
			this.keyBindManager.disable();
			this.keyBindManager = null;
		}

		if (this.configManager) {
			this.configManager.destroy();
			this.configManager = null;
		}
		this._configChangeCallback = null;
		this._logger = null;
	}

	_onConfigChanged(changeType) {
		this._logger.log(`Config changed: ${changeType}`);
		if (changeType === "settings-changed" && this.keyBindManager) {
			this.keyBindManager.reload();
		}
	}
}
