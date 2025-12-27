# P7 Commands (GNOME Shell extension)

Sensible keyboard shortcuts with a small set of Mutter-aware commands. The
extension ships a preferences UI for binding keys and tuning behavior.

Compatibility: GNOME Shell 48 and 49.

## Features

- Keybindings managed by the extension (including clearing conflicts and
  restoring them on disable).
- Commands are defined in `cmds.js` and can be bound to multiple shortcuts.
- Preferences UI to manage shortcuts and the win_optsize config.

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

## Configuration

Configuration is stored in a single GSettings schema
`org.gnome.shell.extensions.p7-cmds`.

### Preferences UI

Open the extension preferences to:

- Add/remove keybindings for each command.
- Set `keybinding-flags` (Meta.KeyBindingFlags) and `keybinding-actionmode`
  (Shell.ActionMode).
- Edit win_optsize breakpoints and scales, or edit the JSON directly.

### win_optsize JSON

Key: `win-optsize-config`

Example (defaults):

```json
{
  "default-scales": [
    [0.8, null],
    [0.7, 0.8],
    [0.6, 0.8]
  ],
  "breakpoints": [
    {
      "maxWidth": 1920,
      "scales": [[0.8, null]]
    },
    {
      "maxWidth": 2560,
      "scales": [
        [0.8, 0.8],
        [0.7, 0.8]
      ]
    }
  ]
}
```

Notes:

- `default-scales` applies when no breakpoint matches.
- Each scale is `[widthScale, heightScale]`. Use `null` for auto height based on
  the monitor aspect ratio.
- Optional `aspectBasedInversion: true` will swap width/height scales on
  portrait screens.

## Development

Common tasks (see `Makefile`):

```sh
make schemas
make pack
make install
make enable
make disable
make reload
```

The built extension zip is written to `dist/`.

## License

See `LICENSE`.
