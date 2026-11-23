# Jev on OpenRouter

TypeSafe's Jev for Ultimate through your OpenRouter key, instead of the built-in `classify` extension and its TypeSafe
key. It provides everything `classify` does, so Ultimate's consumers work unchanged:

- the `classify` service (`ClassifyApi`): `ask({ state, questions }, signal)` with `choice`, `noul` and `score`
  questions, answering `{ model, answers, usage: { inputTokens } }` with the same answer shapes (a `score` keeps its
  `probabilities` and `legend`, a `noul` its probability);
- the `messages.judge` point: upstream's own judge (`extensions/classify/judge.ts`, its question and verdict
  unchanged), which weighs whether a branch's final answer wakes the agent that started it or arrives as a note; the
  verdict chip on the answer reads `report · 99%` or `note · 98%`. The judge asks Microsoft's decision model on
  OpenRouter, not Jev (see [Models](#models));
- the codemode prompt section, telling agents to call
  `models.classify({ provider: 'openrouter', id: 'typesafe/jev-1.14' }, { state, questions })` for many small
  judgments.

With it, Ultimate's `recall` (bringing back a project memory deep in @ultimate's context, and the `memory` tool's
`query`) starts working too, since it uses the `classify` service.

## Requirements

- Ultimate at or after HazAT/ultimate `e1ca764d` (the `messages.judge` point).
- An OpenRouter key in Pi (`~/.pi/agent/auth.json`, `models.json` or `OPENROUTER_API_KEY`). Pi's catalogue lists
  `openrouter/typesafe/jev-1.14` and `openrouter/microsoft/microsoft-decision-1.1` as classifier models. Without a key every call fails: branch answers then report
  as before, and the prompt section tells agents Jev isn't set up.
- Leave Ultimate's built-in `classify` off (it is off by default): it would provide the same services.

## Privacy

What these calls judge leaves the machine, to OpenRouter and from there to the model's provider:

- to Microsoft: excerpts of every branch answer and the inputs it answered, including what the user typed in a branch
  (the judge);
- to TypeSafe: @ultimate's incoming messages and every memory's one-line summary (recall), and whatever state a
  script passes to `models.classify`.

To keep OpenRouter and its providers from logging or retaining it, turn on no logging or zero data retention in
your OpenRouter account, under Settings → Privacy.

## Models

Both are pinned in `adapter.ts`; change them there to follow a newer model on OpenRouter.

- `jev` (`typesafe/jev-1.14`) answers the `classify` service, recall and scripts.
- `judgeModel` (`microsoft/microsoft-decision-1.1`) answers the judge. On a replay of 38 labelled branch answers it
  got 36 right and missed no report; Jev got 32 right and missed 3 reports, answers that should have woken the
  starter. A missed report stalls a flow, while a wrong wake costs one turn.

Errors throw with Pi's short cause and are never retried here beyond Pi's own retries; there is no pause on a
rejected key.

## Install, update, uninstall

```sh
git clone https://github.com/jfanals/ultimate-extensions ~/ultimate-extensions   # once
ln -s ~/ultimate-extensions/jev-openrouter ~/.ultimate/extensions/jev-openrouter  # install
git -C ~/ultimate-extensions pull                                                 # update
rm ~/.ultimate/extensions/jev-openrouter                                          # uninstall
```

Ultimate picks up each change live; no restart. Uninstalled, branch answers report without a verdict and recall
stops, until another provider (such as `classify` with a TypeSafe key) is enabled.

## How it works

`adapter.ts` asks Pi's model runtime (`host.modelRuntime.classify`), which resolves the OpenRouter key and posts
TypeSafe's System One request to OpenRouter. Pi turns `noul` answers into `bool` and drops a score's probabilities and
legend, so the adapter keeps the wire answers from the response Pi has already checked. `server.ts` registers the
service on Jev, upstream's judge fed with a second one on Microsoft's model, and the prompt section.

## Tests

```sh
cd ~/ultimate-extensions && node --test jev-openrouter/*.test.ts
```
