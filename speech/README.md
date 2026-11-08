# Speech

Local speech engines, started on demand and stopped when idle. Parakeet v3 turns speech into text; Underdog Woof
(English) and Kokoro (several languages) turn text into speech for other extensions, such as [drive](../drive/).

## Requirements

- **Apple Silicon Mac** (Parakeet runs on MLX).
- **Python 3.12** with `parakeet-mlx`, `kokoro` and `soundfile` (Kokoro does not support 3.13 yet).
- **ffmpeg** on Ultimate's `PATH`, to decode browser recordings.
- **Speech to text in Ultimate's composer needs [voice](../voice/)** from this repository: Ultimate's built-in voice
  transcribes with OpenAI only, while this one reads the `voice.transcriptionUrl` setting that points it here. Without
  it, speech still serves text to speech to other extensions (the `speech` service).

Set it up once, in a virtual environment of its own:

```sh
brew install python@3.12 ffmpeg
python3.12 -m venv ~/.ultimate/speech-venv
~/.ultimate/speech-venv/bin/pip install parakeet-mlx kokoro soundfile
```

Then point `speech.python` at it (below). The models (`mlx-community/parakeet-tdt-0.6b-v3`, `hexgrad/Kokoro-82M`)
download into the Hugging Face cache on first use.

[Underdog Woof](https://huggingface.co/ConwayResearch/Underdog-Woof) (40 MB, numpy only) is not a package; download
its folder once to where `speech.woofDir` points:

```sh
hf download ConwayResearch/Underdog-Woof --local-dir ~/.ultimate/models/underdog-woof
```

Its licence (Underdog Non-Commercial 1.0) allows non-commercial use only, with credit: an app that uses it shows
"Voice by Underdog Woof" (drive does), and anything published with its audio names "Underdog Woof" or "underdog.ai".
Commercial use needs a licence from its authors.

## Settings

In `~/.ultimate/settings.json`:

```json
{
  "speech": {
    "python": "/absolute/path/to/speech-venv/bin/python",
    "idleMinutes": 15,
    "port": 8179,
    "woofDir": "/absolute/path/to/underdog-woof"
  },
  "voice": { "transcriptionUrl": "http://127.0.0.1:8179/v1/audio/transcriptions" }
}
```

- `speech.python`: the Python with the packages above, as an absolute path (`~` is not expanded); default `python3` from `PATH`. Read at
  each request; a change starts new workers.
- `speech.idleMinutes`: how long a worker stays warm after its last answer; default 15. Read at each request.
- `speech.port`: the local transcription port; default 8179. Read when the extension loads.
- `speech.woofDir`: the downloaded Underdog Woof folder; default `~/.ultimate/models/underdog-woof`. Read at each
  request.
- `voice.transcriptionUrl` (read by [voice](../voice/)): this port for Parakeet, or any other OpenAI-compatible
  transcription server instead.

## Install, update, uninstall

```sh
git clone https://github.com/jfanals/ultimate-extensions ~/ultimate-extensions   # once
ln -s ~/ultimate-extensions/speech ~/.ultimate/extensions/speech                  # install
git -C ~/ultimate-extensions pull                                                 # update
rm ~/.ultimate/extensions/speech                                                  # uninstall
```

Ultimate picks up each change live; no restart.

## How it works

- **One worker per engine.** `parakeet-transcribe.py`, `woof-speak.py` and `kokoro-speak.py` each run as one warm
  Python process, driven by `worker.ts`: a JSON request per stdin line, answered by a `{"bytes": N}` header line and N
  bytes (text or WAV), or `{"error": "..."}`. The first request starts the process (Woof loads in under a second,
  Parakeet in about a second, Kokoro in about ten); it stays warm and is killed `speech.idleMinutes` after its last
  answer. Nothing starts at login or with Ultimate.
- **Speech to text** is served as OpenAI's `POST /v1/audio/transcriptions` on `127.0.0.1:<speech.port>`. The audio
  (WebM/Opus from browsers, MP4 on iOS) goes to Parakeet as a temporary file, which it decodes with ffmpeg.
- **Text to speech** is the `speech` service, `speak(text, voice)`; drive calls it with `host.need({ name: 'speech' })`.
  The voice picks the engine: `woof:juno` or `woof:mira` is Underdog Woof (24 kHz, reads numbers, times and codes as
  spoken, same take for the same text), any other name a Kokoro voice (`af_heart`, `ef_dora`, …).
- **Warming:** `warm(engine, voice?)` on the service starts an engine and loads its model (an empty request, queued
  like any other on the same worker), or only restarts its idle clock. Parakeet is warmed through
  `POST /v1/speech/warm` on the port, so it is the process that serves transcription. Only drive calls it.
- Several Ultimate processes on one Mac each load this extension; the first one to bind the port serves it, the others
  try again every 30 seconds, so one takes over when that one quits.

Model memory, measured on Apple Silicon: Parakeet about 1.3 GB while warm (MLX's buffer cache is turned off; it
would add 2.7 GB for about 0.1 s per request), Woof about 0.3 GB, Kokoro about 2.4 GB; all 0 once stopped.

## Tests

The tests use fake workers; they need neither Python nor the models.

```sh
cd ~/ultimate-extensions && node --test speech/speech.test.ts
```
