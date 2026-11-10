# Drive

A hands-light screen for talking to @ultimate from a phone, which answers aloud with a local voice: Underdog Woof's
Juno by default.

Voice by Underdog Woof (<https://huggingface.co/ConwayResearch/Underdog-Woof>), free for non-commercial use only; the
screen shows the same credit while a Woof voice speaks.

## Requirements

- **speech**, from this repository, set up with Parakeet and the Underdog Woof download (see its README).
- **voice**, from this repository, for local speech to text. Drive turns speech into text through voice's
  `transcribe` action, pointed at speech's local Parakeet by the `voice.transcriptionUrl` setting. With Ultimate's
  built-in voice instead, the talk button transcribes only through OpenAI (with an OpenAI API key in Secrets).
- HTTPS for the phone's microphone: open Ultimate over the built-in tailscale extension's tailnet URL.

## Using it

Open the **Drive** surface on the phone. Tap the big button to talk, tap again to send. The status words say what is
happening: listening, transcribing, thinking, speaking. **Replay** reads the last thing again, **Stop** stops speaking.
The screen keeps itself on (Wake Lock) while shown. Browsers play audio only after a tap: the first tap on the talk
button unlocks it, and anything that arrives before then shows **Tap to hear it**.

Talk for as long as you need: a recording is sent on its own only at about 40 minutes (7.5 MB at 24 kbps, what one
transcription takes), and a voice says "One minute left" before that. If sending fails, the screen says so aloud and
keeps the recording: **Try again** sends it without speaking again.

While the screen is open it reads aloud what is new for the user:

- @ultimate's final answers;
- landings and failed landings (`workspaces.lander-report`) and failed runs (`watchdog.failure`) in its transcript;
- messages to the user from any conversation, with their questions and numbered options. After a question, the next
  thing said answers it (the screen says so; ✕ talks normally instead);
- with the **projects** extension installed, other running projects' new questions to the user, as "tts says: … Your
  reply goes to tts." The next thing said answers it in that project (the screen says "Your answer goes to tts").

Nothing is read over you while you speak. What arrives then plays a soft chime and shows **New message**, with two
buttons under the talk button: **Listen first** pauses the recording and plays it, then **Keep talking** records on
into the same recording, or the big button sends it; **Discard** drops the recording. Whatever is still held plays once
the recording is sent or discarded.

To talk to another project's @ultimate, name it ("ask RevenueHunt what it is working on"): @ultimate passes your words
on with `ultimate.tell` and reads the answer back starting with the project's name.

## Settings

In `~/.ultimate/settings.json`, read at each call:

```json
{ "drive": { "voice": "woof:juno" } }
```

- `drive.voice`: `woof:juno` (default) or `woof:mira` for Underdog Woof, or a Kokoro voice such as `af_heart` (its
  first letter is the language: `a` American, `b` British English, …), which needs Kokoro installed.

The Python is `speech.python` (see speech's README). Without the model, `speak` fails with the reason and the screen
shows it.

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
  applies as it does for the composer. The browser records Opus at 24 kbps (browsers default to 128 kbps, which
  would reach voice's 8 MiB limit in 8 minutes) and sends the whole recording in one action at the end. Speech's
  Parakeet transcribes long audio in 2-minute chunks: 30 minutes take about 45 s. OpenAI's transcription caps a
  recording at 25 MB and voice's request at 65 s, so long recordings need the local path.
- **To @ultimate:** the `ask` action submits a `drive.spoken` input that steers a busy @ultimate. Its model text asks
  for a short, plain spoken answer (`SPOKEN` in `server.ts`), so no system-prompt section changes and the prompt cache
  stays warm; the transcript shows only what was said, marked "spoken". With `re`, `ask` answers that open message
  instead, as the user's reply.
- **Other projects:** `ask { text, re?, project? }` with `project` posts to that project's own `drive/ask` (every
  Ultimate on the machine loads the same user extensions), over loopback with its origin, located by the clone's
  `lib/remote.ts` as codemode's `{ project }` reads are; the phone only ever talks to this instance.
  `question { project, message }` reads that project's `board` through its `codemode/read` and returns the message as
  it is read aloud. The screen polls the projects extension's `overview` every 20 s while shown for new questions.
  Talking to another project's @ultimate goes through this one: `SPOKEN` asks it to relay with `ultimate.tell`.
- **Speech out:** `speak { text }` returns a WAV from speech's worker for `drive.voice` (the `speech` service), which
  starts on demand and stops after `speech.idleMinutes` idle. The screen calls `warm` as it opens, on each Talk tap (not
  awaited) and every minute while it is visible: it starts Parakeet and the voice's engine and loads their models, or only restarts
  their idle clocks, so neither starts cold while Drive is in use. Once Drive is closed or hidden, the normal
  `speech.idleMinutes` countdown applies. The browser splits replies into sentences (`speech.ts`) and fetches the next
  one while the current one plays, so speech starts after the first sentence.

It imports only packages, `@/sdk` and, on the server, the clone's `lib/remote.ts`, never Ultimate's extension files:
other extensions' documents, actions and services are named by string (`board`, `ultimate.standing-agents`,
`voice/transcribe`, `projects/overview`, `codemode/read`, the `messages`, `subagents` and `speech` services), with the
shapes it reads mirrored in `types.ts`. If an Ultimate update renames one of those, the
screen breaks; check them against the built-ins' `refs.ts` and `api.ts` after an update.

## Tests

```sh
cd ~/ultimate-extensions && node --test drive/drive.test.ts
```
