/** @jsxImportSource @solidjs/web */
import { createMemo, Show } from 'solid-js'
import { ROOT, cn, defineWebExtension, docRef, useDocOf } from '@/sdk/solid'
import { title, waiting } from './count.ts'
import type { Message, Todo } from './count.ts'

/** The messages extension's `board` document: only the fields that tell an open question for the user. */
const MessagesDoc = docRef<{ messages: Message[] }>('board')
/** The todos extension's document. */
const TodosDoc = docRef<{ items: Todo[] }>('todos')

/**
 * The To-dos tab's count of what waits on you: amber while a question waits for your answer, grey when only your
 * to-dos do, nothing when neither. It reads the same live documents as the To-dos panel, so the two always agree.
 */
function TodosBadge() {
  const messages = useDocOf(() => ROOT, MessagesDoc)
  const todos = useDocOf(() => ROOT, TodosDoc)
  const count = createMemo(() => waiting(messages()?.messages ?? [], todos()?.items ?? []))
  const total = () => count().questions + count().todos
  return (
    <Show when={total() > 0}>
      <span
        class={cn(
          'inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] leading-none tabular-nums',
          count().questions > 0
            ? 'bg-amber-500/15 text-amber-700 dark:bg-amber-500/20 dark:text-amber-300'
            : 'bg-muted-foreground/15 text-muted-foreground',
        )}
        data-todos-badge={total()}
        title={title(count())}
      >
        {total()}
      </span>
    </Show>
  )
}

export default defineWebExtension({ panelBadges: { todos: TodosBadge } })
