// extension.js

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import { KeyBindManager } from "./keybindmanager.js";
import { cleanupCommands, STATE_MAP } from "./cmds.js";
import { Logger } from "./logger.js";

export default class P7ShortcutsExtension extends Extension {
	constructor(metadata) {
		super(metadata);

		this._logger = null;
		this.keyBindManager = null;
	}

	enable() {
		// For compatibility with gnome 45, we fall back to console
		const settings = this.getSettings();
		const baseLogger = this.getLogger?.() || console;
		this._logger = new Logger(settings, baseLogger);
		this._logger.log("Extension enabled");

		this.keyBindManager = new KeyBindManager(settings, this._logger);
		this.keyBindManager.enable();
	}

	disable() {
		this._logger.log("Extension disabled");
		this._logger?.destroy?.();
		if (this.keyBindManager) {
			this.keyBindManager.disable();
			this.keyBindManager = null;
		}
		cleanupCommands();
		STATE_MAP.clear();
		this._logger = null;
	}
}
