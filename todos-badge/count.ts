/** What waits on the user, from the messages `board` and the `todos` documents of the project's root. */
export type Message = { to: number | 'user' | 'remote'; reply: boolean; state: string }
export type Todo = { owner: 'user' | 'ultimate'; done?: number }

export type Waiting = { questions: number; todos: number }

/**
 * Questions to the user not yet answered or dismissed (Ultimate's `openQuestion` in `lib/message-state.ts`), and the
 * user's open to-dos; @ultimate's own to-dos never count.
 */
export function waiting(messages: readonly Message[], todos: readonly Todo[]): Waiting {
  return {
    questions: messages.filter(
      (message) => message.to === 'user' && message.reply && message.state === 'delivered',
    ).length,
    todos: todos.filter((todo) => todo.owner === 'user' && !todo.done).length,
  }
}

/** The badge's tooltip: "2 questions · 1 to-do for you". */
export function title({ questions, todos }: Waiting) {
  const parts = [
    questions > 0 && `${questions} ${questions === 1 ? 'question' : 'questions'}`,
    todos > 0 && `${todos} ${todos === 1 ? 'to-do' : 'to-dos'}`,
  ].filter(Boolean)
  return `${parts.join(' · ')} for you`
}
