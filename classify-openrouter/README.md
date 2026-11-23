# Classify on OpenRouter

Ultimate's classification through your OpenRouter key, instead of the built-in `classify` extension and its TypeSafe
key. It asks decision models on OpenRouter and provides everything `classify` does, so Ultimate's consumers work
unchanged:

- the `classify` service (`ClassifyApi`): `ask({ state, questions }, signal)` with `choice`, `noul` and `score`
  questions, answering `{ model, answers, usage: { inputTokens } }` with the same answer shapes (a `score` keeps its
  `probabilities` and `legend`, a `noul` its probability);
- the `messages.judge` point: upstream's own judge (`extensions/classify/judge.ts`, its question and verdict
  unchanged), which weighs whether a branch's final answer wakes the agent that started it or arrives as a note; the
  verdict chip on the answer reads `report · 99%` or `note · 98%`. The judge has its own model (see
  [Models](#models));
- the codemode prompt section, telling agents to call `models.classify` on OpenRouter with the `classify` model for
  many small judgments.

With it, Ultimate's `recall` (bringing back a project memory deep in @ultimate's context, and the `memory` tool's
`query`) starts working too, since it uses the `classify` service.

## Requirements

- Ultimate at or after HazAT/ultimate `e1ca764d` (the `messages.judge` point).
- An OpenRouter key in Pi (`~/.pi/agent/auth.json`, `models.json` or `OPENROUTER_API_KEY`), and decision models Pi's
  catalogue lists as OpenRouter classifiers (both defaults are). Without a key every call fails: branch answers then
  report as before, and the prompt section tells agents classification isn't set up.
- Leave Ultimate's built-in `classify` off (it is off by default): it would provide the same services.

## Models

`classifyOpenRouter` in `~/.ultimate/settings.json` picks the OpenRouter model ids; leave one out for its default:

```json
"classifyOpenRouter": { "model": "typesafe/jev-1.14", "judge": "microsoft/microsoft-decision-1.1" }
```

- `model` answers the `classify` service, recall and the prompt section's script calls. Default: TypeSafe's Jev,
  `typesafe/jev-1.14`.
- `judge` answers the judge. Default: Microsoft's `microsoft/microsoft-decision-1.1`. On a replay of 38 labelled
  branch answers it got 36 right and missed no report; Jev got 32 right and missed 3 reports, answers that should
  have woken the starter. A missed report stalls a flow, while a wrong wake costs one turn.

A changed setting applies live. Errors throw with Pi's short cause and are never retried here beyond Pi's own
retries; there is no pause on a rejected key.

## Privacy

What these calls judge leaves the machine, to OpenRouter and from there to each model's provider (with the defaults,
Microsoft for the judge and TypeSafe for the rest):

- the judge: excerpts of every branch answer and the inputs it answered, including what the user typed in a branch;
- recall: @ultimate's incoming messages and every memory's one-line summary;
- scripts: whatever state a script passes to `models.classify`.

Every call this extension makes (the judge, the `classify` service and recall) asks OpenRouter for zero data
retention (`provider: { zdr: true }`): only an endpoint that retains nothing may serve it, and without one the call
fails (a branch answer then reports). Scripts calling `models.classify` go to Pi directly, not through this
extension, so for those only your account setting applies: turn on no logging or zero data retention in your
OpenRouter account, under Settings → Privacy.

## Install, update, uninstall

```sh
git clone https://github.com/jfanals/ultimate-extensions ~/ultimate-extensions             # once
ln -s ~/ultimate-extensions/classify-openrouter ~/.ultimate/extensions/classify-openrouter  # install
git -C ~/ultimate-extensions pull                                                           # update
rm ~/.ultimate/extensions/classify-openrouter                                               # uninstall
```

Ultimate picks up each change live; no restart. Uninstalled, branch answers report without a verdict and recall
stops, until another provider (such as `classify` with a TypeSafe key) is enabled.

## How it works

`adapter.ts` asks Pi's model runtime (`host.modelRuntime.classify`), which resolves the OpenRouter key and posts the
System One request to OpenRouter. Pi turns `noul` answers into `bool` and drops a score's probabilities and legend, so
the adapter keeps the wire answers from the response Pi has already checked. `server.ts` reads the setting and
registers the service on `model`, upstream's judge fed with a second one on `judge`, and the prompt section.

## Tests

```sh
cd ~/ultimate-extensions && node --test classify-openrouter/*.test.ts
```
