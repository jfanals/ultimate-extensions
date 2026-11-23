/**
 * Jev on OpenRouter: what Ultimate's built-in classify provides (its `classify` service, the `messages.judge` point
 * and the codemode prompt section), asked of Jev through Pi's OpenRouter provider, so no TypeSafe key is needed.
 */
import { defineExtension, section } from '@earendil-works/pi-durable'
// Ultimate's own modules, from the clone (`@` is its web/src).
import type { ExtensionHost } from '@/../../server/extensions.ts'
import { ClassifyApi } from '@/../../extensions/classify/api.ts'
import { judge } from '@/../../extensions/classify/judge.ts'
import { Judge } from '@/../../extensions/messages/api.ts'
import { modelId, openRouterClassify, provider } from './adapter.ts'

export default function jevOpenRouter(host: ExtensionHost) {
  const service = openRouterClassify(host.modelRuntime)
  host.implement(ClassifyApi, service)
  host.implement(Judge, judge(service))
  return defineExtension({
    name: 'jev-openrouter',
    sections: [
      section('jev-openrouter', async ({ agent }) => {
        if (!agent.tools.some((tool) => tool.name === 'codemode')) return undefined
        if (!(await host.modelRuntime.getAuth(provider)))
          return "Jev isn't set up: Pi has no OpenRouter key. Ask the user to log in to OpenRouter in Pi."
        return `For many small judgments (hundreds of entries, inputs, traces), write the workflow in code: call \`models.classify({provider: '${provider}', id: '${modelId}'}, {state, questions})\` per item and branch with plain \`if\`s on each answer's choice and probabilities instead of reading items yourself. Jev answers in about half a second for a fraction of a cent; at most 4 run at once and 1000 per script. A script stops after 60 s unless its first line sets more (\`// @options: {"timeout_ms": 600000}\` for a few hundred items). A script resumes after a restart; keep long-run progress with store() so a later call can continue.`
      }),
    ],
  })
}
