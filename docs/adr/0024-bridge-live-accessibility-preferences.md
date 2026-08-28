# ADR 0024: Bridge live accessibility preferences across renderer and native motion

## Status

Accepted

## Related work

- Accessibility contract: ADR 0013
- Roadmap PRD: [GitHub issue 11](https://github.com/techiesreviews/camframe/issues/11)
- Contrast and reduced motion: [GitHub issue 14](https://github.com/techiesreviews/camframe/issues/14)
- Future Custom-effect motion: [GitHub issue 17](https://github.com/techiesreviews/camframe/issues/17)

## Context

The Overlay already removed several CSS transitions under `prefers-reduced-motion`, but Full screen and visible compact Scene changes still interpolated native BrowserWindow bounds for 280 ms. Main cannot read a renderer CSS media query, and persisting an accessibility preference would become stale when the operating-system setting changes while CamFrame is running.

The reachable Overlay also lacked an explicit high-contrast treatment. Selected controls, focus, status, and effect-color swatches could depend on subtle dark-theme colors, shadows, or the selected Glow color.

## Decision

Derive accessibility presentation state live in the Overlay from `prefers-reduced-motion: reduce`, `forced-colors: active`, and `prefers-contrast: more`. Reflect the result as `data-reduced-motion` and `data-high-contrast` on the Overlay so current UI and future scoped Custom-effect descendants can consume it without native privileges or persisted state.

Send only the sanitized renderer preference booleans through a narrow preload IPC method. Main accepts the message only from a CamFrame renderer and retains reduced motion as transient process state. Native Full screen and Scene bounds use one pure transition plan: 280 ms normally and zero duration under reduced motion. If reduced motion becomes active during a native transition, complete the current target bounds and its completion callback immediately.

Disable renderer animation and transitions for every Overlay descendant while reduced motion is active. Under high contrast, use system colors and explicit borders for Toolbar, settings, onboarding, status, and notices. Preserve selected and current states with structure as well as color: selected controls use borders/fill, focused controls use a separate outline, progress segments have borders, and the selected effect swatch gains a check mark. Frame-effect color is never the only state indication.

Do not store either preference in `preferences.json` or Scenes.

## Consequences

- OS preference changes converge the live renderer immediately and reduced motion can finish an in-flight native transition at its intended final geometry.
- Main receives no media-query or DOM capability beyond a pair of booleans.
- Future Custom effects have an explicit reduced-motion state but still require their own issue-level motion contract.
- Windows forced-colors and macOS increased-contrast behavior require manual OS and assistive-technology verification.

