# ADR 0032: Add a toolbar shortcut for the Prompter link, and use switches for on/off settings

## Status

Accepted — 2026-10-30 (Lex).

## Context

Lex tested the Prompter link (ADR 0031) and it works, but he asked for two things. Turning it on meant hover → sliders → Scenes → scroll to the bottom, every recording session; he wanted one icon in CamFrame to do it directly. And the setting looked bolted on: a bright orange browser checkbox, two plain selects and a long sentence, with no heading, next to a panel of quiet grey controls.

The toolbar has been kept to a few icon buttons on purpose (ADR 0004 moved Mirror out of it; 0.4.2 tightened it to five). The other on/off settings (Mirror camera, Always on top, Start at login) used the same orange browser checkbox.

## Decision

- The hover toolbar gets a sixth button, **Prompter link** (Phosphor `scroll`), between Crosshair and Settings. One click (or Enter/Space) flips the stored `prompterLink` setting through the same `updateState` patch as the Inline settings switch; main turns the server on or off, and both controls render from the next state through one function (`src/prompter-link-view.js`). It is a toggle button (`aria-pressed`) with a fixed name "Prompter link", described by the settings status line. While the link is on it has the selected ring of the other toolbar toggles, plus a small dot: green when ready, grey while starting, orange when there is a problem such as a busy port.
- The normal toolbar grows from 196 px to `min(234 px, camera width − 8 px)` so six 36 px buttons fit the default 288 px camera; smaller cameras shrink the buttons as before.
- In Inline settings → Scenes the link becomes one group: a heading row (scroll icon, "Prompter link", switch), a dot-and-short-text status line, and Face full / Face small / Corner margin in one inset that shows only while the link is on.
- Every on/off setting is a switch (`role="switch"` on the checkbox, drawn in CSS in the slider's colors: grey track, white once on), not only the Prompter link, so the panel stays consistent. High contrast uses system colors (Highlight when on) and a hollow dot for a problem; reduced motion removes the switch and inset motion.

## Consequences

- The Prompter link can be turned on without opening settings, and its state is visible whenever the toolbar is. Onboarding still points at the same four controls; its Toolbar now has six buttons.
- At the smallest Portrait camera (135 px wide) the six buttons shrink to about 18 px each, a little narrower than before (about 22 px).
- The settings panel no longer uses the browser's own checkbox anywhere; the switch look is ours to keep consistent.
