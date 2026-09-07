# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [38] - 2026-09-07

- Apply preference edits immediately, distinguish fallback from breakpoint
  optsize scales, and add validated full-config editing, import, and export with
  confirmation and failed-write rollback.
- Make optsize follow Mutter-accepted geometry: resolve transient windows, wait
  for restoration, clamp results to the current work area, and reset cycles on
  external moves or configuration changes.
- Rebuild mouse resize around one owned session that coalesces geometry work,
  preserves pending Wayland size requests while correcting anchors, and flips
  locked edges only on a later Shift press.
- Make keybinding suppression transactional across P7, Shell, window-manager,
  and custom shortcuts, with canonical accelerator matching, failed-registration
  rollback, and merge-safe restoration after concurrent edits.
- Centralize configuration, geometry, command, and preferences ownership;
  isolate Shell compatibility, keep verbose logging settings-owned, and bound
  accelerator, JSON, optsize, and generated CSS inputs.
- Expand reproducible regression and package coverage for lifecycle cleanup,
  configuration reloads, Mutter behavior, shortcut restoration, and GNOME Shell
  45 through 50.

## [37] - 2026-09-04

- Simplify GNOME Shell compatibility code by using stable APIs while retaining
  the feature branches required for Shell 45 through 50.
- Use the correct resize cursor APIs and names across supported Shell versions.
- Remove unsupported display window-removal signal probes.

## [36] - 2026-09-03

- Rename the Shell-only integration layer from `ext/` to `shell/` and update
  imports, documentation, tests, and release packaging to match.

## [35] - 2026-09-01

- Add comprehensive behavioral, GSettings, command lifecycle, package, and GNOME
  Shell 45 through 50 compatibility tests.
- Preserve unrelated and concurrently edited system shortcuts while overriding
  conflicts, with safe rollback when registration fails.
- Wait for restored window geometry before resizing and guard stale monitor
  indices during display changes.
- Validate accelerators and optimal-size configuration before applying them.
- Simplify shared configuration, geometry, compatibility, and preferences code.

## [34] - 2026-06-16

- Add GNOME Shell 50 support.
- Use the GNOME 50 cursor API while preserving older Shell compatibility.

## [33] - 2026-04-17

- Add additional Shift modifer to cycle locked edges for mouse resize
- More resilient opt resize to mutter quirks

## [32] - 2026-04-17

- Fix mouse resize out of bounds reversal
- Add keyboard shortcut during mouse resize
- More refined, predicatable, intuitive behavior for opt resize

## [31] - 2026-02-22

- Revert shortcut defaults.

## [30] - 2026-02-13

- Swap shortcut defaults:
  - `Super` + `x`: Resize with cursor
  - `Super` + `Shift` + `x`: Cycle window optimal size

## [29] - 2026-02-13

- Yet another compatibility fix release
- Uses a timer to check exit conditions to ensure that it works

## [28] - 2026-02-13

- Another compatibility fix release

## [27] - 2026-02-13

- Better exit semantics with larger compatibility

## [25] - 2026-02-13

- Switch mouse resize exit to look for meta key hold
- Also fixes <= GNOME 48 release semantics

## [24] - 2026-02-12

- Fix maximize state update compat <= GNOME 48

## [23] - 2026-01-25

- Harden compat and cleanup

## [22] - 2026-01-24

- Add config for mouse resize options
- Cleanup compat layers

### [20] - 2026-01-14

- Internal cleanup

### [18] - 2026-01-12

- Add missing touchpad support for mouse resize drag.

### [16] - 2026-01-12

- New command: win_mouseresize

## [1] - 2025-12-27

### Added

- Initial release with cmd: win_optsize
