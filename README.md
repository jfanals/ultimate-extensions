# Ultimate extensions

Personal extensions for [Ultimate](https://github.com/HazAT/ultimate), each one installable on its own. They are user
extensions built on Ultimate's public extension API (facets, documents, actions, services and the `@/sdk`); none
changes Ultimate itself. Two exceptions: prompt-cache loads Pi's internal `cache-stats.js` from the Ultimate clone's
`node_modules`, so a Pi upgrade in Ultimate can break it; voice replaces Ultimate's built-in voice by name and
imports it from the clone (its README says which files it follows).

| Extension                     | What it does                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| [awake](awake/)               | Keeps the Mac from sleeping on AC power while agents work; macOS only.                             |
| [project-icon](project-icon/) | Each project's tile: two initials on a colour from its name, for the favicon and Projects rows.    |
| [tab-status](tab-status/)     | The browser tab's favicon and title show whether the project needs you, failed, works or answered. |
| [projects](projects/)         | Every Ultimate project on the machine on one surface, with a counter of questions waiting on you.  |
| [prompt-cache](prompt-cache/) | Marks keep-warm pings; the status line totals cache rebuilds and warms with their cost.            |
| [speech](speech/)             | Local Parakeet speech to text and Kokoro text to speech, started on demand; Apple Silicon.         |
| [voice](voice/)               | Ultimate's voice input, transcribing through a local server (`voice.transcriptionUrl`) keylessly.  |
| [drive](drive/)               | A phone screen to talk to @ultimate and hear its answers aloud.                                    |
| [media](media/)               | Audio and video files that agents link play inline, on the Mac and over the tailnet.               |

## Install

```sh
git clone https://github.com/jfanals/ultimate-extensions ~/ultimate-extensions
mkdir -p ~/.ultimate/extensions
ln -s ~/ultimate-extensions/<name> ~/.ultimate/extensions/<name>
```

Link each extension you want, for example `ln -s ~/ultimate-extensions/awake ~/.ultimate/extensions/awake`. Ultimate
loads a new user extension within seconds, in every project; no restart. Uninstall with
`rm ~/.ultimate/extensions/<name>` (it removes the link, not the clone).

## Update

```sh
git -C ~/ultimate-extensions pull
```

No restart: Ultimate reloads an extension when its files change.

## Dependencies

- **tab-status** needs **project-icon**: it imports `../project-icon/icon.ts` for the favicon, so the folders must
  stay side by side as in the clone. Link project-icon too, or its `projectIcon` setting is not read.
- **projects** needs **tab-status** and **project-icon**: it imports `../tab-status/status.ts` and the project-icon
  tile. Install all three.
- **drive** needs **speech** (Kokoro for its voice, Parakeet for its talk button) and **voice** for local speech to
  text; with Ultimate's built-in voice instead it transcribes through OpenAI only.
- **voice** needs a transcription server for its setting: **speech**, or any OpenAI-compatible one.
- **speech** needs an Apple Silicon Mac, Python 3.12 and ffmpeg; see its README.
- **awake** works on macOS only.

The others stand alone. Each README lists its requirements, settings and tests.

## Tests

Each extension has `node --test` tests (Node 26, as Ultimate requires):

```sh
cd ~/ultimate-extensions
node --test awake/awake.test.ts project-icon/icon.test.ts tab-status/status.test.ts projects/projects.test.ts speech/speech.test.ts voice/voice.test.ts drive/drive.test.ts media/media.test.ts
ULTIMATE_ROOT=/path/to/ultimate node --test prompt-cache/cache.test.ts
```

prompt-cache's test loads Pi from your Ultimate clone's `node_modules`.

## Licence

[MIT](LICENSE)
