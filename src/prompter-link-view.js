// What the Overlay shows for the Prompter link. The Inline settings switch, its status line and the
// toolbar button all read this one view of `prompterLink` (the stored choice) and
// `prompterLinkStatus` (what main's link is doing), so they can never disagree.

const STATE_TITLES = Object.freeze({
  off: 'Prompter link: off',
  starting: 'Prompter link: starting',
  on: 'Prompter link: on, waiting for cues',
})

// `state` is 'off' | 'starting' | 'on' | 'error'. A switched-on link whose status has not caught up
// yet (no status, or still 'off') reads as starting; a switched-off link always reads as off.
export function prompterLinkView({ prompterLink, prompterLinkStatus } = {}) {
  const on = prompterLink === true
  const reported = prompterLinkStatus?.state
  const state = !on ? 'off' : ['starting', 'on', 'error'].includes(reported) ? reported : 'starting'
  const message = prompterLinkStatus?.message || 'The Prompter link stopped.'
  const status = {
    off: 'Off. Turn it on so the prompter can switch this view.',
    starting: 'Starting…',
    on: `On. Waiting for prompter cues on port ${prompterLinkStatus?.port}.`,
    error: `${message} Turn it off and on to retry.`,
  }[state]
  return {
    on,
    state,
    status,
    title: state === 'error' ? `Prompter link: problem. ${message}` : STATE_TITLES[state],
  }
}
