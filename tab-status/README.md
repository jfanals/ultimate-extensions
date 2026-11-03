# Tab status

The browser tab shows what the whole project needs from you, so several Ultimate tabs or app windows can be told apart
at a glance.

## Requirements

None beyond Ultimate. The Dock badge needs an installed app window (a PWA) in a Chromium browser.

## What it shows

One status per project, highest first:

| Status     | When                                                              | Favicon dot | Title |
| ---------- | ----------------------------------------------------------------- | ----------- | ----- |
| needs you  | a message to you waits on your answer (the To-dos "For you" list) | amber       | 🟡    |
| failed     | a branch or standing agent's latest run failed, not yet retried   | red         | 🔴    |
| working    | any agent in the project runs                                     | violet      | 🟣    |
| new answer | a conversation answered since you last looked at it               | green       | 🟢    |
| idle       | none of these                                                     | none        | none  |

The Dock badge of an installed app window counts the messages waiting on you (`navigator.setAppBadge`), and clears
when none does.

macOS shows that badge only for an app allowed to notify, so while the window has never been asked, the status line
shows **Allow Dock badge**. No notifications are sent; it is for the badge only. To turn the badge on:

1. Click **Allow Dock badge** in the app window, then **Allow** in the browser's prompt. The item disappears (also
   after **Block**, and it never asks again).
2. In System Settings › Notifications, find the app window's entry and turn on **Badge application icon**.

## Settings

None.

## Install, update, uninstall

```sh
git clone https://github.com/jfanals/ultimate-extensions ~/ultimate-extensions   # once
ln -s ~/ultimate-extensions/tab-status ~/.ultimate/extensions/tab-status          # install
git -C ~/ultimate-extensions pull                                                 # update
rm ~/.ultimate/extensions/tab-status                                              # uninstall
```

Ultimate picks up each change live; no restart. The [projects](../projects/) extension imports `status.ts` from this
folder, so keep tab-status in the clone while projects is installed (it need not be linked).

## How it works

A web facet only (`web.tsx`), rendered in the `overlay` slot, that draws nothing. It reads the same data the sidebar and
the To-dos panel do: the root's `board` (open messages to the user), `ultimate.conversation-overview` (run states), the
conversation list, and the sidebar's `ext.conversations.seen` and `ext.conversations.concluded` UI state.
`AllowBadge` in `statusline.right` asks for notification permission on its click (`offerBadge` decides when it
shows); the badge is set again as soon as permission changes. `status.ts` holds the priority (`tabStatus`), the title
prefix and the favicon (Ultimate's `web/public/favicon.svg` with a dot).

The core sets the title itself (`● name` while the shown conversation is busy); a `MutationObserver` on `<head>`
replaces that prefix with the status's after each change.

## Tests

```sh
cd ~/ultimate-extensions && node --test tab-status/status.test.ts
```
