# ADR 0001: Keep overlay color controls in-app

## Status

Accepted

## Context

CamFrame's overlay is an always-on-top Electron window. Chromium's native `input[type="color"]` chooser opens outside the overlay's document and can appear behind CamFrame or other topmost windows. CSS stacking rules cannot control that separate native surface.

Frame effects also need a color control only when a color-driven effect is selected.

## Decision

Use an in-app effect-color editor consisting of preset swatches and an editable six-digit hex value. Do not use a native color input for frame-effect colors.

Show the editor only for color-driven frame effects. Progressive blur remains camera-derived and does not expose an artificial color setting. Edge bloom was subsequently removed by ADR 0002.

## Consequences

- The color controls remain inside the settings stacking context.
- Users can choose common colors quickly or enter any RGB color as hex.
- Invalid or incomplete hex values do not update persisted settings and revert when focus leaves the field.
- Future rich color controls must render inside CamFrame rather than opening a separate native chooser.
