# 25 & 5

A small always-on-top, see-through study timer: 25 minutes of focus, 5 minutes of break, repeating.

## Run

Needs [Node.js](https://nodejs.org) 18 or newer.

```sh
npm install
npm start
```

The overlay appears in the top-right corner. Drag it anywhere; it remembers where you put it.

## Shortcuts (work from any app)

| Action | Windows / Linux | macOS |
|---|---|---|
| Start / pause / resume | Ctrl+Alt+P | ⌘⌥P |
| Skip to next session | Ctrl+Alt+N | ⌘⌥N |
| Reset to 25:00 | Ctrl+Alt+R | ⌘⌥R |
| Show / hide overlay | Ctrl+Alt+O | ⌘⌥O |

**Linux on GNOME with Wayland** (default on Ubuntu): apps can't register system-wide shortcuts there, so run this once to add them as GNOME custom shortcuts:

```sh
scripts/gnome-shortcuts.sh           # add
scripts/gnome-shortcuts.sh --remove  # undo
```

On other Linux desktops, bind these commands in your system keyboard settings instead:
`npm run toggle`, `npm run skip`, `npm run reset`, `npm run show-hide`, `npm run quit`.

To move the overlay from a shortcut or script: `node scripts/launch.js --corner=bottom-left`
(also `top-left`, `top-right`, `bottom-right`). Appearance: `--theme=auto`, `--theme=dark`, `--theme=light` or `--theme=neutral`.

## Menu

Hover the overlay and click **⋯**, or use the tray / menu-bar icon (the coral dot), for:

- **Appearance**: Auto, Dark, Light or Neutral glass. Every change fades smoothly.
  - **Auto** (the default) stays dark and turns light only when the screen right around the overlay is white or near-white. It checks 4 times a second (2 on battery). When it sees the other colour, a small ring in the top-left fills up for 1.5 seconds; if the background is still the other colour when the ring completes, the overlay fades across. Brief flashes cancel the ring.
  - **Neutral glass** has no colour tint. On macOS and Windows 11 (22H2+) it uses the system's real blur of whatever is behind the overlay. On Linux and older Windows it uses a frosted look instead, since those systems can't blur behind an app's window. Text switches between light and dark the same way as Auto.
  - **Dark** and **Light** stay fixed.
  - Where Auto and Neutral can look at the screen:
    - Windows and Linux on X11: right away.
    - macOS: asks for Screen Recording permission the first time you pick Auto or Neutral from the menu. While it's watching, macOS shows its screen-recording indicator.
    - Linux on Wayland (e.g. Ubuntu): GNOME's "Share screen" dialog appears once each time the app starts. Pick your screen and click Share. GNOME shows its screen-sharing indicator while the app runs. If you cancel, the text colour follows the system light/dark setting and the app stops asking until you pick Auto or Neutral from the menu again.
  - Screen pixels around the overlay are checked in memory for brightness only; nothing is saved or sent anywhere. Watching stops while you use Dark or Light, while the overlay is hidden, and while the screen is locked.
- **To-do list** (below the timer): shows only the top item; the button on its right (with a "+N" count) opens the full list.
  - Click **+ List item** to add one. **Enter** starts a new item (splitting at the cursor), **Backspace** at the start of an item merges it into the one above, **↑/↓** move between items.
  - Drag the ⠿ grip to reorder. The × deletes an item.
  - Checked items move to **completed** below, in the same order as the list (unchecking puts an item back where it was). **Clear** deletes all completed items, with **Undo** for 5 seconds.
  - The overlay grows to fit the open list, away from the nearest screen edge. The list is saved automatically.
- **Glass opacity…**: opens a slider in the overlay (0% = almost clear, 100% = solid). Click ✓ or press Esc when done.
- **Move to**: slides the overlay to any corner of its current screen
- **Quit**

Starting or pausing plays a short click; switching between focus and break plays a chime.

## Platform notes

- **Windows:** clicking the overlay never takes keyboard focus away from the app you're typing in.
- **macOS:** it runs as a floating panel with no Dock icon, stays above fullscreen apps, and shows the countdown in the menu bar.
- **Linux:** it runs through X11/XWayland, because Wayland doesn't let apps keep themselves on top. Transparency needs a compositor; GNOME and KDE have one.

## Build installers

```sh
npm run dist:linux   # AppImage + .deb  (dist:win / dist:mac on those OSes)
```

See [RELEASING.md](RELEASING.md) for publishing to GitHub Releases and app stores.

## Files

- `src/main.js`: window, always-on-top behaviour, shortcuts, tray, appearance
- `src/background.js`, `src/sampler.*`: watches the screen around the overlay for Auto / Neutral
- `src/renderer.js`, `src/index.html`, `src/styles.css`: timer and glass look
- `src/todo.js`: the to-do list
- `src/preload.js`: bridge between the two
- `scripts/launch.js`: cross-platform launcher used by `npm start`
- `web/index.html`: the original single-file browser version
