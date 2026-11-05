# Drive

A hands-light screen for talking to @ultimate from a phone, which answers aloud with a local Kokoro voice.

## Requirements

- **speech**, from this repository, set up with Kokoro and Parakeet (see its README).
- **voice**, from this repository, for local speech to text. Drive turns speech into text through voice's
  `transcribe` action, pointed at speech's local Parakeet by the `voice.transcriptionUrl` setting. With Ultimate's
  built-in voice instead, the talk button transcribes only through OpenAI (with an OpenAI API key in Secrets).
- HTTPS for the phone's microphone: open Ultimate over the built-in tailscale extension's tailnet URL.

## Using it

Open the **Drive** surface on the phone. Tap the big button to talk, tap again to send. The status words say what is
happening: listening, transcribing, thinking, speaking. **Replay** reads the last thing again, **Stop** stops speaking.
The screen keeps itself on (Wake Lock) while shown. Browsers play audio only after a tap: the first tap on the talk
button unlocks it, and anything that arrives before then shows **Tap to hear it**.

While the screen is open it reads aloud what is new for the user:

- @ultimate's final answers;
- landings and failed landings (`workspaces.lander-report`) and failed runs (`watchdog.failure`) in its transcript;
- messages to the user from any conversation, with their questions and numbered options. After a question, the next
  thing said answers it (the screen says so; ✕ talks normally instead).

## Settings

In `~/.ultimate/settings.json`, read at each call:

```json
{ "drive": { "voice": "af_heart" } }
```

- `drive.voice`: a Kokoro voice; its first letter is the language (`a` American, `b` British English, …). Default
  `af_heart`.

Kokoro's Python is `speech.python` (see speech's README). Without Kokoro, `speak` fails with the reason and the
screen shows it.

## Install, update, uninstall

```sh
git clone https://github.com/jfanals/ultimate-extensions ~/ultimate-extensions   # once
ln -s ~/ultimate-extensions/speech ~/.ultimate/extensions/speech                  # install (needed by drive)
ln -s ~/ultimate-extensions/drive ~/.ultimate/extensions/drive                    # install
git -C ~/ultimate-extensions pull                                                 # update
rm ~/.ultimate/extensions/drive                                                   # uninstall
```

Ultimate picks up each change live; no restart.

## How it works

- **Speech in** reuses voice's `transcribe` action, so `voice.transcriptionUrl` (speech's Parakeet) or the OpenAI key
  applies as it does for the composer.
- **To @ultimate:** the `ask` action submits a `drive.spoken` input that steers a busy @ultimate. Its model text asks
  for a short, plain spoken answer (`SPOKEN` in `server.ts`), so no system-prompt section changes and the prompt cache
  stays warm; the transcript shows only what was said, marked "spoken". With `re`, `ask` answers that open message
  instead, as the user's reply.
- **Speech out:** `speak { text }` returns a WAV from speech's Kokoro worker (the `speech` service), which starts on
  demand and stops after `speech.idleMinutes` idle. The screen calls `warm` as it opens, on each Talk tap (not
  awaited) and every minute while it is visible: it starts Parakeet and Kokoro and loads their models, or only restarts
  their idle clocks, so neither starts cold while Drive is in use. Once Drive is closed or hidden, the normal
  `speech.idleMinutes` countdown applies. The browser splits replies into sentences (`speech.ts`) and fetches the next
  one while the current one plays, so speech starts after the first sentence.

It imports only packages and `@/sdk`, never Ultimate's extension files: other extensions' documents, actions and
services are named by string (`board`, `ultimate.standing-agents`, `voice/transcribe`, the `messages`, `subagents` and
`speech` services), with the shapes it reads mirrored in `types.ts`. If an Ultimate update renames one of those, the
screen breaks; check them against the built-ins' `refs.ts` and `api.ts` after an update.

## Tests

```sh
cd ~/ultimate-extensions && node --test drive/drive.test.ts
```
