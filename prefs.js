import { ExtensionPreferences } from "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js";
import { fillPreferencesWindow } from "./prefs/ui.js";

export default class P7ShortcutsPreferences extends ExtensionPreferences {
  fillPreferencesWindow(window) {
    fillPreferencesWindow(window, this.getSettings());
  }
}
