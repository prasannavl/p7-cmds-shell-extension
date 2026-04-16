// common.js

export const KEYBINDING_FLAG_NAMES = [
  "IGNORE_AUTOREPEAT",
  "NONE",
  "PER_WINDOW",
  "BUILTIN",
  "IS_REVERSED",
  "NON_MASKABLE",
];

export const ACTION_MODE_NAMES = [
  "NORMAL",
  "ALL",
  "NONE",
  "OVERVIEW",
  "LOCK_SCREEN",
  "UNLOCK_SCREEN",
  "LOGIN_SCREEN",
  "SYSTEM_MODAL",
  "LOOKING_GLASS",
  "POPUP",
  "PANEL",
];

export const COMMON_KEYBINDING_SCHEMAS = [
  "org.gnome.desktop.wm.keybindings",
  "org.gnome.shell.keybindings",
  "org.gnome.mutter.keybindings",
  "org.gnome.mutter.wayland.keybindings",
  "org.gnome.settings-daemon.plugins.media-keys",
];

export const DEFAULT_WIN_OPTSIZE_CONFIG = {
  aspectBasedInversion: false,
  scales: [
    [0.95, 0.9],
  ],
  breakpoints: [
    {
      maxWidth: 1920,
      scales: [[0.95, 0.9]],
    },
    {
      maxWidth: 2560,
      scales: [[0.95, 0.9]],
    },
    {
      maxWidth: 3840,
      scales: [[0.55, 0.9]],
    },
  ],
};

export const COMMAND_DEFINITIONS = [
  {
    id: "cmd-win-optsize",
    title: "cmd:win-optsize",
    icon: "window-maximize-symbolic",
    description:
      "Resize the focused window to a size based on the monitor work area and center it.",
  },
  {
    id: "cmd-win-mouseresize",
    title: "cmd:win-mouseresize",
    icon: "transform-move-symbolic",
    description:
      "Resize the focused window by moving the mouse beyond the window edges; press Esc or the keybinding again to stop.",
  },
];
