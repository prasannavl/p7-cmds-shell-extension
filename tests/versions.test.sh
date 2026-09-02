set -euo pipefail

for version in 45 46 47 48 49 50; do
  nix --quiet develop ".#gnome-$version" --command \
    env GNOME_TEST_VERSION="$version" bash -c '
    set -euo pipefail
    unset GIO_EXTRA_MODULES
    shell_gi_path=$(nix-store -qR "$GNOME_SHELL_STORE" | while IFS= read -r dependency; do
      find "$dependency/lib" -maxdepth 3 -type f -name "*.typelib" -printf "%h\\n" 2>/dev/null
    done | sort -u | paste -sd:)
    export GI_TYPELIB_PATH="$shell_gi_path"

    shell_version=$(gnome-shell --version)
    echo "$shell_version"
    shell_major=${shell_version#GNOME Shell }
    shell_major=${shell_major%%.*}
    if [[ "$shell_major" != "$GNOME_TEST_VERSION" ]]; then
      echo "FAIL - expected GNOME Shell $GNOME_TEST_VERSION"
      exit 1
    fi
    gjs --version
    glib-compile-schemas schemas
    bash tests/run-gjs-tests.sh
  '
done
