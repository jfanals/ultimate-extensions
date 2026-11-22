/** @jsxImportSource @solidjs/web */
import { Coffee } from '@lucide/solid'
import { Show } from 'solid-js'
import { ROOT, actionRef, defineWebExtension, keepLast, plural, useAction } from '@/sdk/solid'

type State = { held: boolean; busy: number; ac: boolean }

const StateAction = actionRef<null, State>('awake', 'state')

const agents = (state: State) =>
  state.busy === 0 ? 'agents just finished' : `${plural(state.busy, 'agent')} working`

/** `awake` in the status line while the Mac is kept awake: the hold is on and it runs on AC power. */
function Chip() {
  const { data } = useAction(StateAction, null, {
    conversation: ROOT,
    onError: keepLast,
    every: 15_000,
  })
  return (
    <Show when={data()?.held && data()?.ac && data()}>
      {(state) => (
        <span
          class="flex items-center gap-1.5"
          data-awake
          title={`Keeping the Mac awake: ${agents(state())}`}
        >
          <Coffee class="size-3" />
          awake
        </span>
      )}
    </Show>
  )
}

export default defineWebExtension({
  slots: { 'statusline.right': [{ component: Chip, order: -2 }] },
})
