set -euo pipefail

archive="dist/p7-cmds@prasannavl.com.shell-extension.zip"
expected_files=$(printf '%s\n' \
  CHANGELOG.md \
  README.md \
  cmds/ \
  cmds/index.js \
  cmds/win_mouseresize.js \
  cmds/win_optsize.js \
  common/ \
  common/config.js \
  common/keybindings.js \
  common/window.js \
  extension.js \
  ext/ \
  ext/compat.js \
  ext/keybindingmanager.js \
  ext/logger.js \
  metadata.json \
  prefs/ \
  prefs/ui.js \
  prefs.js \
  schemas/ \
  schemas/org.gnome.shell.extensions.p7-cmds.gschema.xml | LC_ALL=C sort)
actual_files=$(unzip -Z1 "$archive" | LC_ALL=C sort)

if [[ "$actual_files" != "$expected_files" ]]; then
  diff -u <(printf '%s\n' "$expected_files") <(printf '%s\n' "$actual_files")
  exit 1
fi

if ! cmp -s metadata.json <(unzip -p "$archive" metadata.json); then
  echo "packaged metadata.json differs from the source" >&2
  exit 1
fi

echo "ok - package contains exactly the runtime files and current metadata"
