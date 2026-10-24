# Task View

The overview uses a compact header, centered window cards, live window counts,
clear active/minimized states and a separate desktop dock. Desktop tiles show
their actual member-app icons (up to three) and window counts; these are visual
summaries, not captured window thumbnails. The card grid adapts to available
width and scrolls when needed, while the desktop dock remains accessible.
Keyboard focus uses the accent outline and skips disabled controls.
Opening and closing shares Applications’ fade/slide transition (220 ms in,
150 ms out). Closing releases keyboard capture immediately; reopening mid-close
continues from the current opacity. Disabling GTK animations makes both views
appear and disappear immediately.

Super + Tab opens/closes the window overview. The Panel also has a Task View
button between Applications and Terminal. Each open window has a card with
its application icon, title and minimized/current state. Click a card or use
Tab/arrows/Home/End and Enter to activate it, including restoring minimized
windows. Escape or the close button dismisses the overview. A card's X sends
the normal compositor close request, allowing apps to show unsaved-work prompts.
Cards update as windows open, close and change titles. These are icon/title
cards, not live window screenshots. The foreign-toplevel protocol does not expose
per-window capture, so this version does not offer Windows-style thumbnails.

The Desktops strip lists the compositor's actual workspaces (four by default).
Click a desktop to switch immediately while keeping Task View open. Cards show
only that desktop's windows, plus windows pinned to all desktops. Each desktop
shows its window count and current state. The Move to control on each card moves
that window to another desktop without switching desktops. Tab/Shift+Tab reach
the desktop buttons and move controls; arrows navigate desktop buttons, and
Enter selects. Desktop names come from compositor configuration. Existing
Super+1…4 and Super+Shift+1…4 shortcuts remain available. This version uses the
configured desktop list initially. **New desktop** appends an empty desktop and
switches to it while keeping Task View open. More desktops can be added repeatedly
and receive windows through Move to. Added desktops last for the compositor session;
restarting Dev OS restores the configured initial list. **Remove desktop** removes
the current desktop and moves all its windows to the preceding desktop, or the
next desktop when removing the first. Apps stay open, the remaining desktop IDs
are renumbered, and at least one desktop is always kept. Removal is session-only.

The patched compositor exports `devos_workspace_manager_v1` for snapshots,
switching and moving foreign-toplevel handles. Protocol version 2 adds desktop
creation and version 3 adds removal; each button appears only when the compositor
supports its action.
Handles are resolved within the
requesting client's resource namespace; invalid IDs and locked-session actions
are ignored. The native tracker polls snapshots every 250 ms and the shell
publishes only changed data. State reflects external desktop shortcuts too.
An unpatched compositor continues to provide the basic all-window overview
without a desktop strip. Full session restart is required to load the protocol.

The launcher extension owns Task View and the `task-view` / `task-view-show`
commands. `task-view` toggles the overlay; `task-view-show` is idempotent for
gesture activation. The overview uses an exclusive-keyboard layer-shell surface
on the chosen/primary monitor and releases its window subscription on hide.
The native window tracker supports a polite `close` action alongside activation
and minimization. Existing Applications and Alt+Tab behavior remain separate.

Four-finger swipe up opens Task View; four-finger horizontal swipes switch
desktops without wrapping. Three-finger swipes now control app windows.
See [Touchpad gestures](touchpad.md) for the complete mapping, guard conditions
and hardware requirements. Global swipes are consumed before forwarding to apps.

Completed horizontal swipes now use a 300 ms compositor slide with cubic ease-out.
The outgoing desktop is retained through temporary scene-buffer references while
the incoming windows and background (including that desktop’s widgets) slide in.
Panel, menus, Task View and lock surfaces stay stationary above the transition.
Workspace changes are pushed immediately to shell clients so desktop widgets
update without waiting for the tracker’s periodic refresh. Explicit desktop
switches through the workspace protocol share this transition; selecting desktops
inside Task View keeps its existing overview behavior. This is an animation after
the completed gesture, not an interactive finger-tracking preview.

Starting another switch finishes the previous transition, restores scene positions,
and starts from the current desktop. Locking, allocation failure or scene teardown
also releases retained buffers and restores positions. Keyboard workspace switches
cancel an active slide. At desktop-list boundaries there is no switch or animation.
`tools/test/desktop-animation-smoke.dev` checks actual outgoing/incoming rendered
frames, completion, rapid reversal and closing a window in a private compositor.
Physical touchpad delivery still requires hardware validation.

`tools/setup/patch-task-view-gesture.dev` (DevLang, run with `d`) applies the
compositor integration; `tools/setup/bootstrap-wsl.sh` builds the private labwc
and the OpenEmbedded layer applies the same source transform when building
labwc. The build host therefore needs the DevLang runtime (`d`) in `PATH` or at
`~/.local/bin/d`. Restart the entire Dev OS session after upgrading the compositor.
Reloading shell preferences alone cannot replace a running compositor.

Physical touchpad validation remains required. WSLg, a VM or the Windows host
may consume Super+Tab or three-finger gestures before Linux receives them. Use
a native Linux session or configure the VM/host to forward those inputs; the
Linux shell cannot intercept gestures that never reach its compositor.

Three-finger swipe down dismisses both Task View and Applications with the
idempotent `overlays-hide` command. When neither overlay is focused, the existing
gesture still minimizes the active window. Upgrade/restart the compositor for
the new dispatch; reloading shell preferences alone does not change it.

Validation:

- `npm run build`
- `gjs -m dist/task-view-test.js` in a GTK-capable session
- Compile/run `tests/task-view-gesture.c` with a C11 compiler
- `d tools/test/task-view-smoke.dev --` in Linux/WSL with the private compositor,
  wtype and grim. This uses an isolated headless desktop to exercise real
  Super+Tab, workspace metadata/moves, switching to Desktop 2, keyboard selection,
  minimized restoration, native close, repeated
  gesture show commands and Escape. It does not inject input into the user's
  session. Physical gesture dispatch is not simulated by this test.

## Snap Layouts and Snap Groups

Press Super+Z or the grid button in an application title bar to open the independent, full-screen Snap panel. Task View (Super+Tab) contains only open windows and virtual desktops. Choose two equal columns, a wide left or right column, three columns, or four quarters. Select a different open window for each numbered region, then choose **Arrange & save group**. Windows must belong to the same desktop; pinned windows are excluded.

The Snap panel has separate **Snap Layouts** and **Snap Groups** tabs. The Groups tab lists saved arrangements with a preview and window titles. Select a group to switch to its desktop, restore minimized members and apply its layout again. The remove button forgets the group without closing its windows. Groups belong to the running desktop session and are cleared after logout. Closing a member removes that member; groups with fewer than two remaining windows disappear. Moving members to different desktops dissolves the group. Assigning a window to a new group replaces its previous group.

The compositor applies named regions within each window's current monitor, respecting panel reservations, scale, gaps and client minimum sizes. Windows on different monitors stay on their existing monitors. Applications with large minimum sizes can extend beyond a narrow region. This feature requires version 5 of the private Dev OS workspace protocol; older compositors show an unavailable message.

Validation: `npm run build`, `gjs -m dist/snap-layouts-test.js`, `gjs -m dist/task-view-test.js`, and `gjs -m dist/snap-native-test.js` inside a running Dev OS Wayland session.

### Shared window dividers

Snapped windows use a 4 logical pixel gap, including a small margin around the usable desktop. A three-dot grip appears between the active group's windows. Drag it to resize neighboring windows together; four-quarter layouts also have a horizontal grip. Three-column layouts have two independent dividers. The compositor validates the complete set before applying a resize, honors application minimum sizes and rejects mixed monitors/desktops or overlapping cells. Groups remember adjusted proportions when restored.

Initial split positions are adjusted for application minimum sizes when the set fits the available area. The transparent grip surface accepts pointer input only over its small handles. It does not take keyboard focus or cover application content with an input surface. Grips hide when a member is minimized, maximized, fullscreen, closed, moved out of its snap region, or another application becomes active. Shared resizing requires version 6 of the Dev OS workspace protocol. Applications with minimum sizes larger than a region can still require a wider initial snap layout.

Dev OS application windows retain 10 logical pixel rounded client corners while snapped. The shared header renders the entire client surface inside the same rounded boundary, including the bottom corners. Maximized and fullscreen windows keep rectangular edges to fill their output. Shared grips hide while a member is maximized or fullscreen; returning to the group reapplies its saved proportions.
