# GNOME Extension that adds some sensible commands that can be activated with key mappings

- We have a bunch of commands that are defined in cmds.js, where each exported
  function can be a command that can be executed with access to the Mutter API.
- We call them by connecting them to a key binding.
- Keybindings are managed in keybindmanager.js.
- The keybinding manager, on enabling, ensures that any conflicting keybinds
  already set for the ones we want are removed while logging it.
- The keybind manager, on disabling, ensures that all keybinds we replaced are
  restored.
- config.js is where the config store through GSettings is managed. We manage
  the full config as a single object, which is loaded on enabling and then
  reloaded as a whole on GSettings change notification. We also instruct the
  downstream classes that use ConfigManager to propagate the change notification
  so they can reload themselves.

Commands:

- `win_optsize`
  - A command that does optimal sizing for the focused window.
  - It checks for the current size of the monitor and centers the window, and
    sizes the windows to fixed percent widths and heights.
  - Currently, GNOME is buggy with multiple monitors, and it often misplaces
    windows out of bounds or at extremely large sizes. This can quickly help
    bring those windows into an optimal size.

Compatibility:

- GNOME 48, 49 in particular.

Programming styles:

- Simplicity is a MUST. Keep the code as simple as possible.
- Avoid excessive defensiveness when not necessary.
- Avoid duplication and promote reusability as much as possible.
