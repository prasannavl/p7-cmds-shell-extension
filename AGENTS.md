# GNOME Extension that adds some sensible commands that can be activated with key mappings

- Commands live under `cmds/`, where each exported function can use the Mutter
  API. `cmds/index.js` creates the per-extension command registry and injects
  its private state map into command handlers.
- Commands are invoked through keybindings managed by
  `shell/keybindingmanager.js`.
- The keybinding manager, on enabling, ensures that any conflicting keybinds
  already set for the ones we want are removed while logging it.
- The keybind manager, on disabling, ensures that all keybinds we replaced are
  restored.
- `common/config.js` contains the GI-independent configuration definitions,
  validation, and `ConfigManager`. We manage the full GSettings configuration as
  a single object, load it on enabling, and reload it as a whole on change.
- `common/keybindings.js` contains shared GSettings conflict/lease logic.
- `common/window.js` contains pure window geometry algorithms.
- `shell/` contains Shell-only integration such as compatibility, logging, and
  keybinding management. `prefs/` contains preferences-only UI code.

Commands:

- `win_optsize`
  - A command that does optimal sizing for the focused window.
  - It checks for the current size of the monitor and centers the window, and
    sizes the windows to fixed percent widths and heights.

Compatibility:

- Tier 1: GNOME 50 (actively tested).
- Tier 2: GNOME 45+ (works, best effort).

Programming styles:

- Simplicity is a MUST. Keep the code as simple as possible.
- Avoid excessive defensiveness when not necessary.
- Avoid duplication and promote reusability as much as possible.

### Operations

#### General

- Use `nix develop` to get a shell with all the tools needed to work.
- Absolutely no global mutable state. Command state belongs to the registry
  created by `cmds/index.js` and is passed explicitly to command handlers.

#### Update version

- When asked to set a new version:
  - Run `make fmt`, `make clean` and `make pack`
  - Then increment the version in `metadata.json`
  - Add a new entry to change log with the current date and version info
  - Once all of this is done, stage all the changes, and ask me if we can commit
    with the message "Update version: <version-number>"
