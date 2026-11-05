# Voice

Ultimate's built-in voice input, with one addition: a `voice.transcriptionUrl` setting that sends recordings to a local
OpenAI-compatible transcription server, such as [speech](../speech/)'s Parakeet, with no OpenAI API key.

It replaces the built-in `voice` extension (a user extension with the same folder name wins, both facets), but copies
none of it: `web.tsx` re-exports upstream's mic button, and `server.ts` imports upstream's server facet from the
Ultimate clone and wraps two of its exports. Without the setting, every call is upstream's.

## Requirements

- Ultimate (upstream, unpatched).
- A transcription server that takes OpenAI's `/v1/audio/transcriptions` form (`file`, answered with `{ text }`):
  [speech](../speech/) on this repository, or [whisper.cpp](https://github.com/ggml-org/whisper.cpp)'s
  `whisper-server --convert --inference-path /v1/audio/transcriptions`.

## Settings

In `~/.ultimate/settings.json`, read at each call:

```json
{ "voice": { "transcriptionUrl": "http://127.0.0.1:8179/v1/audio/transcriptions" } }
```

With it set:

- `status` answers available, so the mic button works without a key;
- `transcribe` posts the recording to the URL without a key; when the server is down, the composer says the URL is not
  reachable;
- voice declares no `OPENAI_API_KEY`, so neither the Secrets panel nor the setup check asks for it on voice's behalf
  (Ultimate's `voice-live` still declares it when enabled).

Remove it and voice transcribes through OpenAI again, as upstream.

## Install, update, uninstall

```sh
git clone https://github.com/jfanals/ultimate-extensions ~/ultimate-extensions   # once
ln -s ~/ultimate-extensions/voice ~/.ultimate/extensions/voice                    # install
git -C ~/ultimate-extensions pull                                                 # update
rm ~/.ultimate/extensions/voice                                                   # uninstall: the built-in returns
```

Ultimate picks up each change live; no restart.

## Following upstream

Only `local.ts` holds behaviour of its own. What it follows from the clone's `extensions/voice/`:

- `web.tsx`: re-exported as is; an upstream change applies with the next update.
- `server.ts`: `default`, `secrets`, `MAX_AUDIO_BYTES` and `actions` are imported; `status` and `transcribe` are
  wrapped and call upstream's when no URL is set. Recheck the wrapper when upstream renames them or changes their
  arguments (`refs.ts`).
- `openaiTranscribe` in upstream's `server.ts`: `local.ts` posts the same form fields to the local URL. Recheck it
  when upstream changes the form.

## Tests

```sh
node --test voice/voice.test.ts
```

They cover the setting and the local post (no key, the server's failures). Upstream's OpenAI path is tested in Ultimate.
