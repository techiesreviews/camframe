# ADR 0025: Remove the unreachable Controller

## Status

Accepted — 2026-08-29

## Context

CamFrame shipped with one reachable application surface: the Overlay and its Inline settings. A second Controller renderer, BrowserWindow definition, IPC relays, and embedded Inter font remained in source, but no startup, tray, shortcut, or settings flow instantiated that window. Keeping the dormant surface increased the privileged bridge and reconstruction scope, made static tests look stronger than live behavior, and left two Controller-only actions that users could not reach.

## Decision

Remove the separate Controller renderer, its BrowserWindow lifecycle, Controller-only device/error relays and actions, and the Inter font assets used only by that renderer.

The Overlay remains the only renderer. “Open controls” continues to show the Overlay and open Inline settings. The unreachable Center action is removed. Persisted `borderColor` remains accepted for Preferences and Scene compatibility, but no new UI is implied by that compatibility field.

## Consequences

- There is one settings implementation and one renderer security boundary to maintain.
- Tray double-click, the open-controls shortcut, and tray “Open controls” retain their visible behavior.
- Old packages may still contain Controller assets, but current packages must not.
- Reintroducing a separate settings window would be a new product and security decision rather than reconstruction work.
