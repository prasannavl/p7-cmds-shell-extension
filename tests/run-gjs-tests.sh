set -euo pipefail

repo_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
cd "$repo_dir"

run_test() {
  local label=$1
  shift
  if output=$("$@" 2>&1); then
    echo "ok - $label"
  else
    echo "FAIL - $label"
    echo "$output"
    return 1
  fi
}

run_output_test() {
  local label=$1
  local expected=$2
  shift 2
  if output=$("$@" 2>&1) && grep -Fq "$expected" <<<"$output"; then
    echo "ok - $label"
  else
    echo "FAIL - $label"
    echo "$output"
    return 1
  fi
}

without_gi_namespace() {
  local namespace=$1
  local -a directories
  local filtered_path=""
  local directory
  local has_namespace
  local typelib
  IFS=: read -ra directories <<<"${GI_TYPELIB_PATH:-}"
  for directory in "${directories[@]}"; do
    has_namespace=false
    for typelib in "$directory/$namespace-"*.typelib; do
      if [[ -e "$typelib" ]]; then
        has_namespace=true
        break
      fi
    done
    if $has_namespace; then
      continue
    fi
    filtered_path="${filtered_path:+$filtered_path:}$directory"
  done
  printf '%s' "$filtered_path"
}

run_test compat gjs -m tests/compat.test.js
run_test settings env \
  GSETTINGS_SCHEMA_DIR="$repo_dir/schemas" \
  GSETTINGS_BACKEND=memory \
  gjs -m tests/settings.test.js
run_test keybindings env \
  GSETTINGS_SCHEMA_DIR="$repo_dir/schemas" \
  GSETTINGS_BACKEND=memory \
  G_RESOURCE_OVERLAYS="/org/gnome/shell=$repo_dir/tests/fixtures/org/gnome/shell" \
  gjs -m tests/keybindmanager.test.js
run_test commands env \
  G_RESOURCE_OVERLAYS="/org/gnome/shell=$repo_dir/tests/fixtures/org/gnome/shell" \
  gjs -m tests/commands.test.js
run_output_test prefs-module "preferences module loaded" \
  gjs -m tests/prefs-module.test.js
run_output_test prefs-module-without-clutter "preferences module loaded" \
  env GI_TYPELIB_PATH="$(without_gi_namespace Clutter)" \
  gjs -m tests/prefs-module.test.js
run_output_test runtime-modules "runtime modules loaded" \
  env G_RESOURCE_OVERLAYS="/org/gnome/shell=$repo_dir/tests/fixtures/org/gnome/shell" \
  gjs -m tests/runtime-modules.test.js
