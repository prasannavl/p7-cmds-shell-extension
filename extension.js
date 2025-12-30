// extension.js

import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import { KeyBindManager } from "./keybindmanager.js";
export default class P7ShortcutsExtension extends Extension {
	constructor(metadata) {
		super(metadata);
		this._logger = this.getLogger();
		this.keyBindManager = null;
	}

	enable() {
		this._logger.log("Extension enabled");
		this.keyBindManager = new KeyBindManager(this.getSettings(), this._logger);
		this.keyBindManager.enable();
	}

	disable() {
		this._logger.log("Extension disabled");
		if (this.keyBindManager) {
			this.keyBindManager.disable();
			this.keyBindManager = null;
		}
	}
}
