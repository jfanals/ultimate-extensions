# To-dos badge

A count on the right panel's To-dos tab of what waits on you, so you see it without opening the tab.

## Requirements

- An Ultimate with `panelBadges` in its web SDK (a tab badge by panel id). Without it this extension loads and shows
  nothing.

## What it shows

One number: the questions waiting on your answer plus your open to-dos (the To-dos tab's "For you" list); @ultimate's
own to-dos never count.

| State                       | Badge       |
| --------------------------- | ----------- |
| a question waits on you     | amber count |
| only your to-dos are open   | grey count  |
| nothing waits on you        | none        |

It sits after the tab's label, or after its icon when the row is too narrow for labels (another tab shown, a phone).
Its tooltip names the parts, such as "1 question · 2 to-dos for you". It reads the same live documents as the To-dos
panel (`board` and `todos`), so it updates as you answer or tick, without polling. With the right panel closed, the
status line's waiting counter still shows the questions.

## Settings

None.

## Install, update, uninstall

```sh
git clone https://github.com/jfanals/ultimate-extensions ~/ultimate-extensions   # once
ln -s ~/ultimate-extensions/todos-badge ~/.ultimate/extensions/todos-badge        # install
git -C ~/ultimate-extensions pull                                                 # update
rm ~/.ultimate/extensions/todos-badge                                             # uninstall
```

Ultimate picks up each change live; no restart.

## Tests

```sh
node --test ~/ultimate-extensions/todos-badge/count.test.ts
```
