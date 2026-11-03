import { CoffeeIcon } from 'lucide-react'
import { useEffect } from 'react'
import { actionRef, defineWebExtension, useAction, useNow } from '@/sdk'

type State = { held: boolean; busy: number; ac: boolean }

const StateAction = actionRef<null, State>('awake', 'state')

/** `awake` in the status line while the Mac is kept awake: the hold is on and it runs on AC power. */
function Chip() {
  const now = useNow(15_000)
  const { data, refetch } = useAction(StateAction, null, {
    // A failed poll keeps the last state; the next one asks again.
    onError: () => {},
  })
  useEffect(() => {
    // oxlint-disable-next-line typescript/no-floating-promises -- useAction reports failures and resolves undefined rather than rejecting.
    void refetch()
  }, [now, refetch])
  if (!data?.held || !data.ac) return null
  const agents =
    data.busy === 0
      ? 'agents just finished'
      : `${data.busy} agent${data.busy === 1 ? '' : 's'} working`
  return (
    <span
      className="flex items-center gap-1.5"
      data-awake
      title={`Keeping the Mac awake: ${agents}`}
    >
      <CoffeeIcon className="size-3" />
      awake
    </span>
  )
}

export default defineWebExtension({
  slots: { 'statusline.right': [{ component: Chip, order: -2 }] },
})
