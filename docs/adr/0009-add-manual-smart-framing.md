# ADR 0009: Add manual smart framing

## Status

Accepted

## Context

Overlay size controls how much screen space the camera occupies, but it cannot bring the speaker closer without also enlarging the window. Camera crop position already exists, so zoom and crop should feel like one direct manipulation instead of two more settings rows.

## Decision

Add camera zoom from 100% to 250% as a setting independent from overlay size. Make the existing target tool the single framing mode: drag the camera to pan, scroll over it to zoom in 5% steps, and double-click to restore 100% zoom with a centered crop.

Do not expose Size or Zoom sliders in either settings surface. The visible overlay continues to resize directly from its corner handles.

Apply the same crop origin and zoom transform to the primary camera and progressive-blur effect source. Scale pan sensitivity using the amount of zoom overflow so the available drag distance maps to the available cropped image.

Persist camera zoom automatically and include it in Scenes alongside crop position.

## Consequences

- People can create close-up scenes without changing the overlay footprint.
- Camera framing stays discoverable through a focused toolbar guide with the live zoom value while the target tool is active, without covering the camera preview.
- Settings stay compact because resizing and framing are handled directly on the camera.
- Existing settings and imported scenes default safely to 100% zoom.
- Double-click reset changes only camera zoom and crop origin; it does not resize or move the overlay.
- Automatic face tracking remains a separate future enhancement and can build on the same framing settings.
