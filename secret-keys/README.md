# Secret keys

Add a secret that no extension asks for yet. Ultimate's Secrets panel only lists names an extension declares; this one
declares yours. Name a key in ⌘K **New secret…**, with its value now or later. An agent that needs one asks with
`request_secret`, and you paste the value in the panel. Scripts and configs read it back with `ultimate-secret NAME`.

## Requirements

- Ultimate with its Secrets extension (built in, always on).
- Node 26 for `ultimate-secret`, as Ultimate requires.

## What it adds

- **⌘K New secret…**: a name (checked as you type: capital letters, digits and `_`), an optional value, and an
  optional description and link. With a value it saves it, as the panel does. Without one it adds an **empty key**,
  shown in Secrets as missing with its Add button, and in the status line's setup check until you add it. Either way
  the Secrets panel then opens at the key. The setup check words an empty key as "Without it, secret-keys can't
  work": that is Ultimate's text for any missing secret. Nothing here breaks; it only reminds you to add the value.
- **⌘K Forget a secret…**: the keys added here or by an agent; Forget takes one off the Secrets list. A value you
  stored stays until you delete it in the panel.
- **`request_secret {name, description, url?}`**, an agent tool: it adds an empty key and tells the agent to send you to
  ⌘K → Secrets. It never takes or returns a value. A prompt section tells agents to use it instead of asking for a key
  in chat.
- **`ultimate-secret NAME`**: prints one stored value to stdout, with no newline. It exits 1 with a message on stderr
  when the value is not set, and 2 on a bad name.

Keys live as `secretKeys` in `~/.ultimate/settings.json`. Ultimate reloads extensions that declare secrets when that
file changes, so a new key reaches the panel and the setup check of every running Ultimate in a second or two, with no
restart. The web bundle also rebuilds on any change to that file, so a page might briefly show "building…". Values
stay in Ultimate's `~/.ultimate/secrets.json`. This extension never reads them; only `ultimate-secret` does, when you
run it.

## `ultimate-secret`

Link it onto your PATH once:

```sh
ln -s ~/ultimate-extensions/secret-keys/ultimate-secret ~/bin/ultimate-secret
```

Use it where the value goes into a config or a variable:

```json
"apiKey": "!/Users/me/bin/ultimate-secret OPENROUTER_API_KEY"
```

```sh
curl -H "Authorization: Bearer $(ultimate-secret MY_API_KEY)" https://api.example.com/
```

Pi runs an `apiKey` that starts with `!` as a command. Use the absolute path there: an app launched outside your shell
may not have `~/bin` on its PATH. The script checks the store as Ultimate does: it refuses a store others can read,
or one behind a symlink.

**Agents:** never run `ultimate-secret` in a way that prints the value where your transcript records it, for example
bare or with `echo`. Pipe it into the program that needs it. To check that a key is there, use
`ultimate-secret NAME | wc -c` or `ultimate-secret NAME >/dev/null`.

## Settings

`secretKeys` in `~/.ultimate/settings.json`, which the dialog and the tool write for you:

```json
"secretKeys": [
  { "name": "MY_API_KEY", "description": "Key for my-app's API", "url": "https://example.com/keys" }
]
```

## Install, update, uninstall

```sh
git clone https://github.com/jfanals/ultimate-extensions ~/ultimate-extensions   # once
ln -s ~/ultimate-extensions/secret-keys ~/.ultimate/extensions/secret-keys        # install
git -C ~/ultimate-extensions pull                                                 # update
rm ~/.ultimate/extensions/secret-keys ~/bin/ultimate-secret                       # uninstall
```

Ultimate picks up each change live; no restart. Uninstalling leaves `secretKeys` in settings and your stored values
alone.

## Tests

```sh
node --test ~/ultimate-extensions/secret-keys/keys.test.ts
```
