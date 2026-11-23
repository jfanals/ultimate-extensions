/**
 * Classify on OpenRouter: what Ultimate's built-in classify provides (its `classify` service, the `messages.judge` point
 * and the codemode prompt section), asked of decision models through Pi's OpenRouter provider, so no TypeSafe key is
 * needed. The `classifyOpenRouter` setting picks the models.
 */
import { defineExtension, section } from '@earendil-works/pi-durable'
// Ultimate's own modules, from the clone (`@` is its web/src).
import { readSettings, userSettingsPath } from '@/../../lib/settings.ts'
import type { ExtensionHost } from '@/../../server/extensions.ts'
import { ClassifyApi } from '@/../../extensions/classify/api.ts'
import { judge } from '@/../../extensions/classify/judge.ts'
import { Judge } from '@/../../extensions/messages/api.ts'
import { modelsOf, openRouterClassify, provider } from './adapter.ts'

export const reloadOnSettings = true

export default async function classifyOpenRouter(host: ExtensionHost) {
  const models = modelsOf((await readSettings(userSettingsPath(host.userHome))).classifyOpenRouter)
  host.implement(ClassifyApi, openRouterClassify(host.modelRuntime, models.model))
  host.implement(Judge, judge(openRouterClassify(host.modelRuntime, models.judge)))
  return defineExtension({
    name: 'classify-openrouter',
    sections: [
      section('classify-openrouter', async ({ agent }) => {
        if (!agent.tools.some((tool) => tool.name === 'codemode')) return undefined
        if (!(await host.modelRuntime.getAuth(provider)))
          return "Classification isn't set up: Pi has no OpenRouter key. Ask the user to log in to OpenRouter in Pi."
        return `For many small judgments (hundreds of entries, inputs, traces), write the workflow in code: call \`models.classify({provider: '${provider}', id: '${models.model}'}, {state, questions})\` per item and branch with plain \`if\`s on each answer's choice and probabilities instead of reading items yourself. It answers in about half a second for a fraction of a cent; at most 4 run at once and 1000 per script. A script stops after 60 s unless its first line sets more (\`// @options: {"timeout_ms": 600000}\` for a few hundred items). A script resumes after a restart; keep long-run progress with store() so a later call can continue.`
      }),
    ],
  })
}
