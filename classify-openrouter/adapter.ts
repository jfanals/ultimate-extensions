/** Ultimate's classify service, answered by a decision model through Pi's runtime on OpenRouter, without a TypeSafe key. */
import type { ClassifierContext, ClassifierModel, ClassifierResult } from '@earendil-works/pi-ai'
import type { ClassifyAnswer, ClassifyService } from '@/../../extensions/classify/api.ts'

export const provider = 'openrouter'
/** The decision models without a setting: the judge's was right on 36 of 38 labelled branch answers, Jev on 32 (README). */
export const defaults = { model: 'typesafe/jev-1.14', judge: 'microsoft/microsoft-decision-1.1' }

/** The models from the `classifyOpenRouter` setting, each one unset taking its default. */
export function modelsOf(setting: unknown): typeof defaults {
  if (setting === undefined) return defaults
  if (!setting || typeof setting !== 'object' || Array.isArray(setting))
    throw new Error('classifyOpenRouter must be an object')
  const { model = defaults.model, judge = defaults.judge } = setting as Record<string, unknown>
  if (typeof model !== 'string' || typeof judge !== 'string')
    throw new Error('classifyOpenRouter.model and .judge must be OpenRouter model ids')
  return { model, judge }
}

/** The part of Pi's model runtime the adapter uses. */
export type Runtime = {
  getModelOfType(type: 'classifier', provider: string, id: string): ClassifierModel | undefined
  classify(
    model: ClassifierModel,
    context: ClassifierContext,
    options: {
      signal: AbortSignal
      fetch: typeof fetch
      onPayload: (payload: unknown) => unknown
    },
  ): Promise<ClassifierResult>
}

export function openRouterClassify(
  runtime: Runtime,
  modelId: string,
  request = fetch,
): ClassifyService {
  return {
    async ask({ state, questions }, signal) {
      const model = runtime.getModelOfType('classifier', provider, modelId)
      if (!model) throw new Error(`${provider}/${modelId} is not in Pi's model catalogue`)
      // Pi turns `noul` answers into `bool` and drops a score's probabilities and legend; the wire answers are
      // classify's own contract, so keep those once Pi has checked them.
      let wire: Record<string, ClassifyAnswer> | undefined
      const result = await runtime.classify(model, { state, questions } as ClassifierContext, {
        signal,
        // Only providers that retain nothing may serve it; without one the call fails.
        onPayload: (payload) => ({ ...(payload as object), provider: { zdr: true } }),
        async fetch(input, init) {
          const response = await request(input, init)
          if (response.ok)
            wire = ((await response.clone().json()) as { answers?: typeof wire }).answers
          return response
        },
      })
      if (result.stopReason !== 'stop') throw new Error(result.errorMessage ?? result.stopReason)
      if (!wire) throw new Error('OpenRouter sent no answers')
      return {
        model: result.model,
        answers: wire,
        usage: { inputTokens: result.usage?.input ?? 0 },
      }
    },
  }
}
