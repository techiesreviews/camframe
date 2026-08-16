# ADR 0008: Evolve presets into scenes

## Status

Accepted

## Context

Named presets make layouts reusable, but live presentations also need predictable direct shortcuts, ordering, safe backup, and smoother visual switching.

## Decision

Present saved presets as Scenes while retaining the existing internal `presets` data for backward compatibility. Scene order determines the direct shortcuts `Ctrl/Cmd + Shift + 1` through `6`.

Allow a selected scene to be renamed and updated in place. Put reorder, delete, import, and export actions inside a collapsed “Manage scenes” disclosure. Export scenes as a versioned JSON document, and merge imports by ID or case-insensitive name without exceeding six scenes.

Animate the native overlay bounds and camera surface geometry when applying a scene in compact mode. Keep full-screen state transient, following the earlier decision that saved layouts do not control temporary window state.

When saving a scene, snapshot the live compact `BrowserWindow` coordinates synchronously. Electron's asynchronous `moved` event remains useful for general persistence but is not authoritative at the moment of scene capture.

## Consequences

- Existing saved presets continue to load without migration or data loss.
- Reordering a scene also changes its numbered shortcut.
- Importing replaces matching scenes and fills available slots; it does not delete unrelated local scenes.
- Advanced management remains available without making the default Scenes view visually dense.
