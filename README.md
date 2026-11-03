# Ultimate extensions

Personal extensions for [Ultimate](https://github.com/HazAT/ultimate), each one installable on its own. They are user
extensions built on Ultimate's public extension API (facets, documents, actions, services and the `@/sdk`); none
changes Ultimate itself. One exception: prompt-cache loads Pi's internal `cache-stats.js` from the Ultimate clone's
`node_modules`, so a Pi upgrade in Ultimate can break it.

| Extension                     | What it does                                                                                       |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| [awake](awake/)               | Keeps the Mac from sleeping on AC power while agents work; macOS only.                             |
| [tab-status](tab-status/)     | The browser tab's favicon and title show whether the project needs you, failed, works or answered. |
| [projects](projects/)         | Every Ultimate project on the machine on one surface, with a counter of questions waiting on you.  |
| [prompt-cache](prompt-cache/) | Marks replies that rebuilt the prompt cache, with their cost, and keep-warm pings.                 |
| [speech](speech/)             | Local Parakeet speech to text and Kokoro text to speech, started on demand; Apple Silicon.         |
| [drive](drive/)               | A phone screen to talk to @ultimate and hear its answers aloud.                                    |

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

- **projects** needs **tab-status**: it imports `../tab-status/status.ts`, so the folders must stay side by side as in
  the clone. Install both.
- **drive** needs **speech** (Kokoro for its voice, Parakeet for its talk button) **and a patched Ultimate with a
  `voice.transcriptionUrl` setting** for local speech to text. Upstream Ultimate does not have that setting; without
  it drive transcribes through OpenAI only.
- **speech** needs an Apple Silicon Mac, Python 3.12 and ffmpeg; see its README.
- **awake** works on macOS only.

The others stand alone. Each README lists its requirements, settings and tests.

## Tests

Each extension has `node --test` tests (Node 26, as Ultimate requires):

```sh
cd ~/ultimate-extensions
node --test awake/awake.test.ts tab-status/status.test.ts projects/projects.test.ts speech/speech.test.ts drive/drive.test.ts
ULTIMATE_ROOT=/path/to/ultimate node --test prompt-cache/cache.test.ts
```

prompt-cache's test loads Pi from your Ultimate clone's `node_modules`.

## Licence

[MIT](LICENSE)
