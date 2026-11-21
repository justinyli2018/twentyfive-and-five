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
(also `top-left`, `top-right`, `bottom-right`).

## Menu

Hover the overlay and click **⋯**, or use the tray / menu-bar icon (the coral dot), for:

- **Glass opacity…**: opens a slider in the overlay (0% = almost clear, 100% = solid). Click ✓ or press Esc when done.
- **Move to**: slides the overlay to any corner of its current screen
- **Quit**

Starting or pausing plays a short click; switching between focus and break plays a chime.

## Platform notes

- **Windows:** clicking the overlay never takes keyboard focus away from the app you're typing in.
- **macOS:** it runs as a floating panel with no Dock icon, stays above fullscreen apps, and shows the countdown in the menu bar.
- **Linux:** it runs through X11/XWayland, because Wayland doesn't let apps keep themselves on top. Transparency needs a compositor; GNOME and KDE have one.

## Files

- `src/main.js`: window, always-on-top behaviour, shortcuts, tray
- `src/renderer.js`, `src/index.html`, `src/styles.css`: timer and glass look
- `src/preload.js`: bridge between the two
- `scripts/launch.js`: cross-platform launcher used by `npm start`
- `web/index.html`: the original single-file browser version
