# ADR 0006: Group settings by task

## Status

Accepted

## Context

Adding resolution, frame effects, tuning controls, and named presets made the settings surfaces feel crowded, especially inside the compact overlay panel.

## Decision

Use a three-part segmented control—Camera, Style, and Presets—to progressively disclose settings by task. Camera remains the default because device selection and capture behavior are the most common setup actions.

Keep the quick-action toolbar unchanged. Switching sections only changes which settings are visible; it does not change camera state.

## Consequences

- Each settings view has a shorter, more focused list of controls.
- Existing features remain one click away and retain their current behavior.
- Camera settings fit in the compact panel without routine scrolling; contextual effect tuning can still scroll when expanded.
- The same grouping is used in the overlay and controller to keep navigation predictable.
