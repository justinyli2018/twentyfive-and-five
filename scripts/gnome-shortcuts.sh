#!/usr/bin/env bash
# Adds GNOME custom keyboard shortcuts that control the 25 & 5 overlay.
# Needed on GNOME + Wayland, where an app's own global shortcuts only fire
# while one of its windows is focused.
#
#   scripts/gnome-shortcuts.sh           add / update the shortcuts
#   scripts/gnome-shortcuts.sh --remove  remove them
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
ELECTRON="$DIR/node_modules/.bin/electron"
SCHEMA=org.gnome.settings-daemon.plugins.media-keys
BASE=/org/gnome/settings-daemon/plugins/media-keys/custom-keybindings

#        id            name                          keys                arg
ENTRIES=("tf5-toggle|25 & 5: start / pause|<Control><Alt>p|--toggle"
         "tf5-skip|25 & 5: skip|<Control><Alt>n|--skip"
         "tf5-reset|25 & 5: reset|<Control><Alt>r|--reset"
         "tf5-showhide|25 & 5: show / hide|<Control><Alt>o|--show-hide")

command -v gsettings >/dev/null || { echo "gsettings not found (is this GNOME?)"; exit 1; }

current=$(gsettings get "$SCHEMA" custom-keybindings)
paths=()
for e in "${ENTRIES[@]}"; do paths+=("$BASE/${e%%|*}/"); done

# Merge (or remove) our paths in the existing list, keeping everything else.
new_list=$(python3 - "$current" "${1:-}" "${paths[@]}" <<'PY'
import sys
cur, mode, ours = sys.argv[1], sys.argv[2], sys.argv[3:]
cur = cur.replace("@as ", "")
items = [s.strip().strip("'") for s in cur.strip("[]").split(",") if s.strip()]
items = [i for i in items if i not in ours]
if mode != "--remove":
    items += ours
print("[" + ", ".join(f"'{i}'" for i in items) + "]")
PY
)

if [[ "${1:-}" == "--remove" ]]; then
  for p in "${paths[@]}"; do gsettings reset-recursively "$SCHEMA.custom-keybinding:$p" || true; done
  gsettings set "$SCHEMA" custom-keybindings "$new_list"
  echo "Removed 25 & 5 shortcuts."
  exit 0
fi

[[ -x "$ELECTRON" ]] || { echo "Run 'npm install' in $DIR first."; exit 1; }

for e in "${ENTRIES[@]}"; do
  IFS='|' read -r id name keys arg <<<"$e"
  p="$SCHEMA.custom-keybinding:$BASE/$id/"
  gsettings set "$p" name "'$name'"
  gsettings set "$p" command "'\"$ELECTRON\" \"$DIR\" --ozone-platform=x11 $arg'"
  gsettings set "$p" binding "'$keys'"
done
gsettings set "$SCHEMA" custom-keybindings "$new_list"

echo "Added: Ctrl+Alt+P start/pause · Ctrl+Alt+N skip · Ctrl+Alt+R reset · Ctrl+Alt+O show/hide"
echo "(Ctrl+Alt+P/N/R/O also start the overlay if it isn't running.)"
