/** Ultimate's classify service, answered by Jev through Pi's model runtime on OpenRouter instead of a TypeSafe key. */
import type { ClassifierContext, ClassifierModel, ClassifierResult } from '@earendil-works/pi-ai'
import type { ClassifyAnswer, ClassifyService } from '@/../../extensions/classify/api.ts'

export const provider = 'openrouter'
export const modelId = 'typesafe/jev-1.14'

/** The part of Pi's model runtime the adapter uses. */
export type Runtime = {
  getModelOfType(type: 'classifier', provider: string, id: string): ClassifierModel | undefined
  classify(
    model: ClassifierModel,
    context: ClassifierContext,
    options: { signal: AbortSignal; fetch: typeof fetch },
  ): Promise<ClassifierResult>
}

export function openRouterClassify(runtime: Runtime, request = fetch): ClassifyService {
  return {
    async ask({ state, questions }, signal) {
      const model = runtime.getModelOfType('classifier', provider, modelId)
      if (!model) throw new Error(`${provider}/${modelId} is not in Pi's model catalogue`)
      // Pi turns `noul` answers into `bool` and drops a score's probabilities and legend; the wire answers are
      // classify's own contract, so keep those once Pi has checked them.
      let wire: Record<string, ClassifyAnswer> | undefined
      const result = await runtime.classify(model, { state, questions } as ClassifierContext, {
        signal,
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
