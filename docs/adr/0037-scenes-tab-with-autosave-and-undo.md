# ADR 0037: Scenes tab with autosave and Undo

## Status

Accepted — 2026-11-09 (Lex approved the final interactive sketch, Orbit TOOLS-132).

Supersedes, without rewriting them:

- ADR 0008, the parts "Allow a selected scene to be renamed and updated in place. Put reorder, delete, import, and export actions inside a collapsed 'Manage scenes' disclosure", and the behaviour that a Scene changes only on an explicit Update and that Save, Delete and Apply close Inline settings.
- ADR 0036, the part "The notice stays for other events: Scene deleted, scenes imported or exported".
- ADR 0007, the part that applies Start at login in packaged builds.
- ADR 0032, the Inline settings → Scenes Prompter link group (heading, switch, status line, Face full / Face small / Corner margin inset); the toolbar button stays.

## Context

The Scenes tab mixed four things: a name field with a Save/Update button, a select that applied a Scene and closed the settings, a "Manage scenes" disclosure, Start at login, a shortcut reference and the Prompter link section (switch, status, Face full, Face small, Corner margin). Lex found it unclear how a Scene is saved, and asked (2026-11-09, in order):

1. Remove Start at login and the shortcut overview; the toolbar's scroll icon is enough to turn the Prompter link on and off; show one slot when there are no Scenes; drop the "x of 6" text; add a list/grid switch.
2. Use a check for save, no orange "changed" dot, an Undo button instead; autosave is fine, because the previous place is easy to recover by hand. Start with a few Scenes. Tiles should show position, size and frame as accurately as possible.
3. Undo lives 10 seconds. Full screen is not a Scene. Starters: Small bottom and Big right.

## Decision

- The Scenes tab holds only Scenes, with Import and Export under them. Start at login, the shortcut list and the Prompter link section are gone from the tab. The toolbar's Prompter link button stays its only control; its status becomes the button's screen reader description (a visually hidden element). Face full, Face small and Corner margin leave the UI and keep their stored values and defaults, so cues behave as before (`docs/prompter-link-api.md` is unchanged).
- **Start at login is removed**: no setting, no control, no code path. An old Preferences file with `launchAtLogin` still loads (the field is ignored and dropped at the next save). A packaged build turns the old login item off once, when the loaded file had it on, so CamFrame does not keep starting at sign-in with no switch left to stop it.
- **Views**: a list (number, name, shape · size · place · frame) or a grid of small 16:9 screens, switched by two icon buttons at the top right of the Scenes. The choice is kept in Preferences (`sceneView`).
- **Tiles** draw the camera at its real place, size and shape, with its glow or border, from CamFrame's geometry (`scenePreviews()` in `scenes.js`: the camera surface inside the window chrome, as shares of the bounds of the display it sits on; a layout Scene planned like applying it). Hovering a Scene shows its details.
- **Clicking a Scene puts it on camera and the settings stay open.** Save, rename, delete, Undo and reorder never close them either. Escape cancels a rename or save in progress, else closes the settings.
- **Save look slot**: with no Scenes it is the only thing shown, drawing the live look, "Save the live look as scene 1". Later it shows the live look and the number the new Scene gets ("Save look"); at six Scenes it says "Full". Save and confirm buttons are check icons; a taken name turns the button into "Replace".
- **Autosave**: the active Scene follows the live look. A hand change (Inline settings, the toolbar's Shape, dragging the Overlay, a corner resize) is written into the active Scene at once, and the Scene stays active (`followLiveLook()`). It follows everything a Scene stores except the camera and its quality: a missing camera falling back to the default, or a quality the device refused, must never rewrite a Scene. A layout Scene (ADR 0035, and both starters) becomes an exact Scene of the live look on its first hand change. Prompter link cues are not hand changes: a cue that moves the camera still clears the active Scene, as before.
- **Saved check and Undo**: the Scene's number flashes a green check when it saves itself. An Undo button shows on that Scene for 10 seconds after the last change, with a thin line running out; Undo (or Ctrl+Z) puts the Scene back as it was when it went on camera (or when the previous Undo window closed), live look included, and on camera. Switching Scenes closes the window. No orange dot.
- **Delete** has no confirm dialog: the Scene leaves at once and its place shows "<name> deleted" with Undo for 6 seconds (Ctrl+Z works too). Undo puts it back in its place, on camera again if it was. A save or import closes that window. No notice is drawn on the camera for a delete, an import or an export; the Import and Export buttons show the result on themselves.
- **Rename** (pencil, or F2) changes only the name and keeps the look.
- **Keyboard**: arrows move between Scenes (all four in the grid), Enter puts one on camera, F2 renames, Delete deletes, Ctrl+Z undoes, Alt+arrow moves a Scene one place, Escape cancels or closes. Scenes can also be dragged into a new order.
- **Starter Scenes**: a new installation, and an older Preferences file (schema below 15) without Scenes, start with "Small bottom" (288 px, bottom right) and "Big right" (540 px, right), both layout Scenes planned on the display the Overlay is on with the default Corner margin. A file with Scenes keeps exactly those. From schema 15 on, an empty list is the user's choice and stays empty.
- **Full screen is not a Scene**: it stays its own toolbar button, shortcut and cue.
- Main keeps both Undo windows (`createSceneEdits()` in `scenes.js`) and sends them with every state update as runtime-only fields (`sceneUndo`, `sceneDeleted`, `sceneSaved`, `scenePreviews`), like the active Scene. The renderer draws them (`src/scenes-panel.js`).
- Numbered Prompter cues ("2 Big right") are not part of this decision (separate card).

## Consequences

- Preferences schema 15: `launchAtLogin` is gone, `sceneView` is new, and older files without Scenes get the starters. An older CamFrame build opening a schema-15 file ignores `sceneView` and reads the starters as layout Scenes or, before schema 14, as ordinary Scenes.
- A hand change can no longer be made "outside" the active Scene: to try a look without changing a Scene, switch to another Scene first, or use Undo within 10 seconds. Lex accepted this: the previous place is easy to recover by hand.
- Changing the look while an unedited starter is on camera gives that starter its own look; the other starter keeps following the live look until it is edited.
- Start at login users lose the feature; the one-time unregister means CamFrame no longer starts at sign-in after the update.
- The Prompter link API, its cues and the Scenes data the prompter reads are unchanged; a starter is reported as a layout Scene until it is edited, then as a snapshot Scene.
- Manual rows changed: W-25 and M-08 (Start at login) are retired; new rows check autosave, Undo, delete Undo, the tiles' geometry on a real display, the list/grid switch and the keyboard on Windows.
