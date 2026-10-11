# ADR 0029: Remove the unapplied Compositor mask

## Status

Accepted — 2026-10-11. Resolves KG-01.

## Context

`settings.js` computed native window regions for each shape, Frame effect halo, toolbar, corner brackets, and open Inline settings (`regionsFor()` and `overlayRegionsFor()`). Nothing outside the tests called them, and main never called `BrowserWindow.setShape()`. They made up about 30% of `settings.js`. Two tests protected them, and `frameEffect` was listed as a geometry-changing setting only so a future mask would refresh. That made every Frame effect change re-apply identical window bounds.

KG-01 recorded the mismatch and required an issue or ADR before either applying or removing the helpers. CSS `clip-path` already clips every visible camera shape, and whole-window mouse pass-through is the shipped input behavior.

## Decision

Delete the region helpers and their tests. Remove `frameEffect` from the settings that re-apply Overlay window bounds. Keep CSS clipping and whole-window interactivity as the input model.

A native input or render mask can return later as a deliberate feature. It would need its own ADR and cross-platform manual tests for click-through, hover, resize handles, and Frame effects.

## Consequences

- `settings.js` holds only the Preferences schema, its sanitizing and loading rules, and camera/window dimensions.
- The Compositor mask is no longer a domain term. Transparent pixels inside the outer window still block clicks while the Overlay is interactive, as before (product spec, KG-01 history).
- Frame effect changes no longer call `setBounds()` with unchanged bounds. Shape, size, and position changes still do.
