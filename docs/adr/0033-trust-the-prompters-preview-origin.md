# ADR 0033: Trust the prompter's preview origin

## Status

Accepted — 2026-10-31 (Lex). Reversed 2026-11-08: see the note at the end. Supersedes in part ADR 0031 (its list of allowed `Origin`s).

## Context

The prompter now has a test copy at https://preview.prompter.techies.tools, its own Cloudflare Worker (`techies-prompter-preview`), where Lex tries a prompter build from any computer before it goes live (Lex, 2026-10-31: yes to the preview address). Microphone, voice and CamFrame tests run there or on `http://localhost`, never on a `file://` copy, whose microphone permission does not stick. ADR 0031 allowed only the live site, localhost pages, `null` and no `Origin`, so the Prompter link refused the preview with `403`.

## Decision

- `originAllowed` in `src/prompter-link.js` also accepts exactly `https://preview.prompter.techies.tools` (`PROMPTER_PREVIEW_SITE`), by string equality like the live site: its http form, other ports, other subdomains and longer look-alike names stay refused.
- Everything else from ADR 0031 stays: off by default, `127.0.0.1` only, the `Host` check, the strict cue shape and Chrome's Private Network Access answer, which the preview gets like the live site.

## Consequences

- Whoever can deploy the `techies-prompter-preview` Worker (today only Lex's Cloudflare account) can, while the link is on, move or resize the camera view and read the Scene names, as the live site can. The effect stays view-only.
- Chrome and Edge treat the preview as its own public origin, so it asks once more for permission to reach apps on this device (W-30 in `docs/verification/README.md`).

## Note, 2026-11-08: preview address removed

Lex decided on 2026-11-04 to ignore the preview and remove it later ("ignore the preview, and remove it in a future issue"; Orbit card TOOLS-49). The Prompter link no longer trusts `https://preview.prompter.techies.tools`: `PROMPTER_PREVIEW_SITE` is gone and `originAllowed` refuses that address with `403` and no CORS header, like any other unknown site. The live site `https://prompter.techies.tools`, localhost pages, `file://` copies and local programs are unchanged. The text above stays as the record of the 2026-10-31 decision. `test/prompter-link.test.js` checks that the live site still works and the preview address is refused.
