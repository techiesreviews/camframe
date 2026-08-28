# ADR 0013: Establish an Overlay accessibility contract

## Status

Proposed

## Related work

- Roadmap PRD: [GitHub issue 11](https://github.com/techiesreviews/camframe/issues/11)
- Keyboard and screen reader: [GitHub issue 16](https://github.com/techiesreviews/camframe/issues/16)
- Contrast and reduced motion: [GitHub issue 14](https://github.com/techiesreviews/camframe/issues/14)
- Custom effect motion: [GitHub issue 17](https://github.com/techiesreviews/camframe/issues/17)

## Context

CamFrame has accessible names, visible focus styles, live status regions, and CSS reduced-motion rules in parts of the reachable Overlay. It does not yet define complete keyboard behavior, focus management, high-contrast behavior, or reduced motion for native window animations.

The Overlay normally avoids focus and ignores pointer input, which makes accessibility behavior a coordination problem across renderer interaction state and main-process native window state.

## Decision

Make every reachable CamFrame action operable without a pointer once the user invokes the existing Open controls shortcut or a tray action that requests interaction. Use semantic controls and predictable tab order, and provide keyboard equivalents for moving and resizing the Overlay and for adjusting camera framing.

Treat Inline settings and onboarding as managed focus regions. Opening a region moves focus to its heading or first relevant control, `Escape` closes the innermost transient region, and closing restores focus to its invoker when possible. Full screen retains its existing `Escape` behavior when no inner region consumes the key.

Announce camera state, Scene application, validation failures, Full screen changes, and update state through concise status regions without repeatedly announcing continuous drag, resize, or framing movement.

Support operating-system high-contrast and reduced-motion preferences. High contrast must preserve control boundaries, selection, and focus without depending on effect colors. Reduced motion disables CSS transitions and animations, custom-frame animation, and main-process bounds interpolation; state changes complete immediately while preserving final geometry.

Add automated tests for externally visible keyboard, focus, announcement, contrast, and animation-plan behavior. Record manual verification with NVDA on Windows and VoiceOver on macOS for release candidates that implement this contract. Do not claim formal accessibility conformance solely from these checks.

## Consequences

- Renderer and main-process interaction state must share an explicit reduced-motion decision.
- Native movement, resize, framing, and Full screen actions gain keyboard contracts in addition to direct manipulation.
- New transient surfaces must define focus entry, focus restoration, and `Escape` precedence.
- Visual effects, including user-authored effects, cannot be the only indication of state.
- Accessibility verification becomes part of the Windows and macOS manual release matrix.
