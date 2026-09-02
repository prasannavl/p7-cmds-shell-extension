import { Extension } from "resource:///org/gnome/shell/extensions/extension.js";
import { createCommands } from "./cmds/index.js";
import { KeybindingManager } from "./shell/keybindingmanager.js";
import { Logger } from "./shell/logger.js";

export default class P7ShortcutsExtension extends Extension {
  enable() {
    const settings = this.getSettings();
    this._logger = new Logger(settings, this.getLogger?.() || console);
    this._logger.log("Extension enabled");
    this._commands = createCommands();
    this._keybindingManager = new KeybindingManager(
      settings,
      this._logger,
      this._commands.list,
    );
    this._keybindingManager.enable();
  }

  disable() {
    this._logger?.log("Extension disabled");
    this._keybindingManager?.disable();
    this._keybindingManager = null;
    this._commands?.destroy();
    this._commands = null;
    this._logger?.destroy();
    this._logger = null;
  }
}
