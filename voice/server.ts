/**
 * Ultimate's built-in voice, plus `voice.transcriptionUrl`: with it set, recordings go to that local OpenAI-compatible
 * server, with no key, and OpenAI's key is not asked for. Without it, every call is upstream's. Upstream's facet is
 * imported from the Ultimate clone (`@` is the clone's `web/src`); only the local path lives here (`local.ts`).
 */
import upstream, * as builtin from '@/../../extensions/voice/server.ts'
import { localTranscribe, transcriptionUrl } from './local.ts'

export default upstream
export const MAX_AUDIO_BYTES = builtin.MAX_AUDIO_BYTES
/** Upstream's limit for one transcription. */
const TIMEOUT_MS = 65_000

/** OpenAI's key is declared only when voice needs it, so the Secrets panel and the setup check ask for it only then. */
export const secrets = async (host: { userHome: string }) =>
  (await transcriptionUrl(host)) ? [] : builtin.secrets
/** A settings change runs `secrets` again. */
export const reloadOnSettings = true

const { status, transcribe } = builtin.actions
type Args = Parameters<typeof status>[0]
type Ctx = Parameters<typeof status>[1]

export const actions = {
  ...builtin.actions,
  status: async (args: Args, ctx: Ctx) =>
    (await transcriptionUrl(ctx.host)) ? { available: true as const } : status(args, ctx),
  transcribe: async (args: Args, ctx: Ctx) => {
    const url = await transcriptionUrl(ctx.host)
    if (!url) return transcribe(args, ctx)
    const signal = AbortSignal.any([ctx.signal, AbortSignal.timeout(TIMEOUT_MS)])
    return { text: await localTranscribe(url, args, MAX_AUDIO_BYTES, signal) }
  },
}
