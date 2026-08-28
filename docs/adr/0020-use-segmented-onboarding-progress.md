# ADR 0020: Use segmented onboarding progress

## Status

Accepted

## Related work

- Contextual coach marks: ADR 0016
- Stable Toolbar placement: ADR 0019
- Implementation slice: [GitHub issue 13](https://github.com/techiesreviews/camframe/issues/13)

## Context

The coach-mark header displayed “Getting started · Step N of 4” while an existing four-segment progress component remained hidden. The text conveyed position but added visual noise to the small tooltip. The orange focus outline identified the explained Toolbar button, but did not resemble the familiar state users see when hovering that control.

## Decision

Show the four compact progress segments and reduce the visible header label to “Getting started.” Filled orange segments represent progress through the four-step guide. Expose the current numeric position through progressbar semantics rather than duplicating it in visible text.

Give the current Toolbar target the same icon and background colors as its real hover state for the entire step. Retain the established orange focus outline so target identity remains unambiguous and keyboard focus remains distinguishable.

## Consequences

- Progress is quicker to scan and consumes less header attention.
- Assistive technology still receives the current value, minimum, maximum, and progress label.
- The highlighted control previews its interactive hover affordance without activating the feature.
