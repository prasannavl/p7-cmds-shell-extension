# p7 Commands

Sensible keyboard shortcuts with a small set of Mutter-aware commands to make
the GNOME shell experience more intuitive for power users.

- Tier 1: GNOME Shell 50 (actively tested).
- Tier 2: GNOME Shell 45+ (works, best effort).
- Extension Store: https://extensions.gnome.org/extension/9065/p7-commands/
- Project is also a Nix flake for direct install on NixOS.

## Screencasts

<p align="center">
  <img src="docs/assets/screencast-optsize.gif" alt="Window optimal-size command demonstration" width="100%" style="max-width: 640px; height: auto;"/>
  <br/>
  Window auto optimal size (based on output size): `Super` + `x`
</p>

<p align="center">
  <img src="docs/assets/screencast-resize.gif" alt="Mouse-driven window resize demonstration" width="100%" style="max-width: 640px; height: auto;"/>
  <br/>
  Window auto resize on mouse move: `Super` + `Shift` + `x`
</p>

## Commands

### win_optsize

Resizes the focused window to an optimal size for the current monitor work area
and centers it. It cycles through configured scales, and the final step restores
the original window size.

Default keybinding: `<Super>x`

#### Notes

- Currently, GNOME is buggy with multiple monitors, and it often misplaces
  windows out of bounds or at extremely large sizes. This can quickly help bring
  those windows into an optimal size.

### win_mouseresize

Resizes the focused window using the mouse by locking to the nearest edge once
you move the cursor past it, then dragging to the target size.

- Default keybinding: `<Super><Shift>x`
- Press and hold Super and move mouse to resize.
- Shift in the activation shortcut is ignored. After movement locks an edge,
  each new Shift press flips the currently locked edges; holding Shift does not
  affect edges locked later.

#### Notes

- This brings Sway like mouse resize behavior to GNOME shell.

## Install

For a local install:

```sh
nix develop
make ginstall
```

Log out, login again and enable.

## Configuration

Configuration is stored in a single GSettings schema
`org.gnome.shell.extensions.p7-cmds`.

### Preferences UI

Open the extension preferences to:

- Add/remove keybindings for each command.
- Edit win_optsize breakpoints and scales, or edit the JSON directly.
- Export, import, inspect, or replace the full configuration as JSON.

Preference changes are saved immediately. The win_optsize fallback scales are
used only when no breakpoint matches; the first matching breakpoint supplies the
active scales.

### win_optsize JSON

Key: `win-optsize-config`

Example (defaults):

```json
{
  "aspectBasedInversion": false,
  "scales": [
    [0.95, 0.9]
  ],
  "breakpoints": [
    {
      "maxWidth": 1920,
      "scales": [[0.95, 0.9]]
    },
    {
      "maxWidth": 2560,
      "scales": [[0.95, 0.9]]
    },
    {
      "maxWidth": 3840,
      "scales": [[0.55, 0.9]]
    }
  ]
}
```

Notes:

- `scales` applies when no breakpoint matches.
- Each scale is `[width, height]`.
- Values greater than `0` and up to `1` are fractions of the current work area.
- Values greater than `1` are treated as exact pixel sizes.
- Exact pixel sizes larger than the current monitor axis fall back to `0.95` of
  that axis.
- The height scale may be `null` to preserve the monitor aspect ratio.
- Optional `aspectBasedInversion: true` will swap width/height scales on
  portrait screens.

### win_mouseresize colors

Keys:

- `win-mouseresize-border-color`
- `win-mouseresize-background-color`
- `win-mouseresize-border-size`

Color syntax is passed to St after rejecting characters that could start another
CSS declaration. Border size is 1–20 pixels.

## Development

Common tasks (see `Makefile`):

Useful Make targets:

- `make lint` - run linters
- `make test` - run behavioral, GSettings, module-load, and package tests
- `make test-versions` - run integration tests on GNOME Shell 45 through 50
- `make fmt` - run formatters
- `make schemas` - compile GSettings schema
- `make pack` - build zip into `dist/`
- `make ginstall` - build and install using `gnome-extensions`
- `make install` - Manually install into `DESTDIR` dir
- `make enable` / `make disable` / `make reload`
- `make clean`

## License

See `LICENSE`.
