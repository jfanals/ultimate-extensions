# Pushover

Sends a [Pushover](https://pushover.net) notification to your phone when an Ultimate project has a question waiting for
you, lands work, or @ultimate reports something to you. Nothing is sent while you are using Ultimate.

## Requirements

- A Pushover account and an application token for it.
- The secrets `PUSHOVER_TOKEN` (the application's API token) and `PUSHOVER_USER` (your user key), added in ⌘K →
  Secrets. Without them the extension sends nothing and says so in one notice.
- Optional: Ultimate's `tailscale` extension. With it, links open the project over the tailnet (HTTPS); without it
  they use the loopback address, which only opens on the Mac itself.

## What it sends

Each project's Ultimate sends only its own events, so with several projects open nothing arrives twice. Every kind
uses Pushover's normal priority and your default sound; the title tells them apart.

| When                                                | Title                           | Text                                        | Tap opens             |
| --------------------------------------------------- | ------------------------------- | ------------------------------------------- | --------------------- |
| a message to you that waits for your answer         | `my-app · Fix login asks`       | the first question and its recommended pick | the question in Inbox |
| several questions within a minute of the first      | `3 questions waiting in my-app` | each question's first line                  | the Inbox             |
| a landing (`workspaces.landed`)                     | `my-app · landed`               | the landing's title                         | the branch            |
| @ultimate's message to you that waits for no answer | `my-app · done`                 | its bold lead, or else its first line       | @ultimate             |

The asker is a branch's title (`#id` without one) or a standing agent's `@name`. A question reads like "Which opening
next? → recommended: 1a Italian", with "(+1 more)" when the message asks more than one. Questions wait up to a minute
from the first before going out, so a burst becomes one notification; one answered in that minute is left out. Landed
and done notifications expire on the phone after a day (`ttl` 86400).

## While you are here

Every Ultimate page reports every 15 s while it is visible, focused and touched in the last minute; the report goes to
`~/.ultimate/pushover-presence.json`, shared by all projects on the machine. Nothing is sent while that file is younger
than a minute, from any project. A skipped or folded notification is not sent later.

**Limitation:** Pushover cannot withdraw a notification once sent, so a question you answer on the Mac right after
stays on the phone until you dismiss it.

## Actions

- `present` (user only): what the pages call.
- `test {message?, landing?, force?}`: sends what message `message` (a question or @ultimate's report to you) or the
  newest landing (`landing: true`) would send, or a test line; skipped while you are here unless `force`. Returns
  Pushover's outcome (`status: 1` is accepted) and the notification:
  `await ultimate.action('pushover', 'test', { force: true })`.

API failures (`status` other than 1, with Pushover's `errors`) become notices; they never stop the event that caused
them.

## Settings

None.

## Install, update, uninstall

```sh
git clone https://github.com/jfanals/ultimate-extensions ~/ultimate-extensions   # once
ln -s ~/ultimate-extensions/pushover ~/.ultimate/extensions/pushover              # install
git -C ~/ultimate-extensions pull                                                 # update
rm ~/.ultimate/extensions/pushover                                                # uninstall
```

Ultimate picks up each change live; no restart.

## Tests

```sh
node --test ~/ultimate-extensions/pushover/rules.test.ts
```
