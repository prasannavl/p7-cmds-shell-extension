import Adw from "gi://Adw";
import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { acceleratorsEqual } from "../common/config.js";
import { assertEquals } from "./testlib.js";

const resourcePath = GLib.getenv("GNOME_SHELL_EXTENSIONS_RESOURCE");
if (!resourcePath) throw new Error("GNOME Shell extensions resource not set");

const resource = Gio.Resource.load(resourcePath);
resource._register();

await import("../prefs.js");
const {
  fillPreferencesWindow,
  getScaleIncrement,
  normalizeAcceleratorKey,
  normalizeScaleSpinValue,
} = await import(
  "../prefs/ui.js"
);
assertEquals(Boolean(Adw.SpinRow), true);
assertEquals([0.5, 1, 2, 512, 513, 1024, 1025].map(getScaleIncrement), [
  0.1,
  0.1,
  8,
  8,
  16,
  16,
  32,
]);
assertEquals(normalizeScaleSpinValue(1.2, 0.9), 2);
assertEquals(normalizeScaleSpinValue(10.9, 10), 10);
assertEquals(normalizeScaleSpinValue(0.95, 0.9), 0.95);
assertEquals(
  acceleratorsEqual("<Alt>F12", "<Mod1>f12", normalizeAcceleratorKey),
  true,
);

Adw.init();
const window = new Adw.PreferencesWindow();
const settings = new Gio.Settings({
  schema_id: "org.gnome.shell.extensions.p7-cmds",
});
settings.set_string("win-optsize-config", '{"scales":"wide"}');
fillPreferencesWindow(window, settings);
assertEquals(window.default_width, 760);
assertEquals(window.default_height, 640);
assertEquals(window.get_visible_page() instanceof Adw.PreferencesPage, true);

function descendants(widget) {
  const result = [];
  for (
    let child = widget.get_first_child?.();
    child;
    child = child.get_next_sibling()
  ) {
    result.push(child, ...descendants(child));
  }
  return result;
}

const widthRows = descendants(window).filter((widget) =>
  widget instanceof Adw.SpinRow && widget.title === "Width"
);
assertEquals(widthRows.length > 0, true);
assertEquals(
  descendants(window).some((widget) =>
    widget instanceof Adw.ActionRow &&
    widget.title === "JSON error" &&
    widget.visible
  ),
  true,
);
widthRows[0].set_value(0.7);
assertEquals(
  JSON.parse(settings.get_string("win-optsize-config")).scales[0][0],
  0.7,
);
assertEquals(
  descendants(window).some((widget) =>
    widget instanceof Adw.PreferencesPage && widget.title === "Full Config"
  ),
  true,
);

let closed = false;
window.connect("close-request", () => {
  closed = true;
  return false;
});
window.emit("close-request");
assertEquals(closed, true);
window.destroy();

print("preferences window constructed");
