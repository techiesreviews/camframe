# ADR 0014: Add scoped Custom frame effects

## Status

Proposed

## Related work

- Roadmap PRD: [GitHub issue 11](https://github.com/techiesreviews/camframe/issues/11)
- Safe Custom effect: [GitHub issue 15](https://github.com/techiesreviews/camframe/issues/15)
- Named effects and Scenes: [GitHub issue 18](https://github.com/techiesreviews/camframe/issues/18)
- Reduced-motion animation: [GitHub issue 17](https://github.com/techiesreviews/camframe/issues/17)
- Scene portability: [GitHub issue 20](https://github.com/techiesreviews/camframe/issues/20)

## Context

CamFrame currently provides None, Glow, and Progressive blur Frame effects. People may want branded, expressive, or presentation-specific treatments that cannot be represented by a fixed list of controls.

Unrestricted CSS over the Overlay could hide controls, alter input behavior, load remote resources, escape the camera geometry, or become incompatible with future internal markup. ADR 0003 also limits effects to the existing 18-pixel overscan unless Overlay geometry is reconsidered.

## Decision

Add Custom as a Frame effect. A Custom effect renders only in a dedicated, non-interactive effect layer associated with the Camera surface. User CSS cannot select or modify the camera video, toolbar, Inline settings, onboarding, status copy, or resize handles.

Accept a deliberately restricted stylesheet syntax rather than injecting raw text. Parse CSS into a syntax tree, validate selectors, at-rules, properties, values, and complexity limits, then serialize the accepted stylesheet before rendering or persistence. Regular expressions alone are not a sufficient security boundary.

Allow the dedicated `.custom-frame` selector and locally defined keyframes. Allow visual properties needed for borders, backgrounds, shadows, filters, opacity, transforms, transitions, and animations. Reject network-bearing values and rules, including `url()`, `@import`, and font loading, as well as layout, stacking, generated-content, and interaction properties such as fixed positioning, unrestricted `z-index`, `content`, and `pointer-events`.

Constrain rule count, keyframe count, source length, animation duration, and visual overflow. Custom effects use the existing effect overscan and never resize the native Overlay. Invalid edits show an actionable validation message and never replace the last valid rendered or persisted stylesheet.

Provide live preview, reset, and starter examples. Store named Custom frame effects locally in Preferences. Scenes capture an embedded sanitized snapshot of the selected Custom effect so that Scene application and export remain self-contained even if the named local effect is later edited or deleted. Imported effects pass through the same sanitizer as editor input.

When reduced motion is active, retain the static visual result while disabling Custom effect animation and transition behavior, following ADR 0013.

## Consequences

- A dedicated parser/compiler becomes a deep, security-sensitive module with pure input/output tests.
- Preferences and Scene formats require versioned additions and bounded storage.
- User styles remain creative but are not general Overlay theming.
- Some otherwise valid web CSS will be rejected by design.
- Effects extending beyond the existing overscan may clip; increasing that space requires a separate geometry decision.
- Scene import remains untrusted input and cannot bypass Custom effect validation.
