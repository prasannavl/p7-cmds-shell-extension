import Gio from "gi://Gio";
import GLib from "gi://GLib";
import { assertEquals } from "./testlib.js";

const resourcePath = GLib.getenv("GNOME_SHELL_EXTENSIONS_RESOURCE");
if (!resourcePath) throw new Error("GNOME Shell extensions resource not set");

const resource = Gio.Resource.load(resourcePath);
resource._register();

await import("../prefs.js");
const { getScaleIncrement, normalizeScaleSpinValue } = await import(
  "../prefs/ui.js"
);
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
print("preferences module loaded");
