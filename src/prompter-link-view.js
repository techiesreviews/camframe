// What the Overlay shows for the Prompter link. The Inline settings switch, its status line and the
// toolbar button all read this one view of `prompterLink` (the stored choice) and
// `prompterLinkStatus` (what main's link is doing), so they can never disagree.

// `state` is 'off' | 'starting' | 'on' | 'error'. A switched-on link whose status has not caught up
// yet (no status, or still 'off') reads as starting; a switched-off link always reads as off.
export function prompterLinkView({ prompterLink, prompterLinkStatus } = {}) {
  const on = prompterLink === true
  const reported = prompterLinkStatus?.state
  const state = !on ? 'off' : ['starting', 'on', 'error'].includes(reported) ? reported : 'starting'
  const message = prompterLinkStatus?.message || 'The Prompter link stopped.'
  const port = prompterLinkStatus?.port ? ` on port ${prompterLinkStatus.port}` : ''
  const { status, title } = {
    off: { status: 'Off. Turn it on so the prompter can switch this view.', title: 'Prompter link: off' },
    starting: { status: 'Starting…', title: 'Prompter link: starting' },
    on: { status: `On. Waiting for prompter cues${port}.`, title: 'Prompter link: on, waiting for cues' },
    error: { status: `${message} Turn it off and on to retry.`, title: `Prompter link: problem. ${message}` },
  }[state]
  return { on, state, status, title }
}

// The Overlay's last `prompterLink` request that main has not answered yet (`undefined` when none),
// shared by the toolbar button and the settings switch, so a quick second press flips that request
// instead of repeating the one before it.
export function toggledPrompterLink(pending, stored) {
  return !(pending ?? stored)
}

// Clears the pending request once the stored setting has caught up with it.
export function settledPrompterLink(pending, stored) {
  return pending === stored ? undefined : pending
}
