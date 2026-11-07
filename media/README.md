# Media

Plays audio and video files from this machine inline in the transcript, on the Mac and over the tailnet on a phone.

An agent links a file by its absolute path, `[take 3](/Users/me/my-app/out/take-3.wav)`; a prompt section tells every
agent, in every project, to do so. The link becomes a card with the file's name and size and a play button; Play loads
the file and shows the browser's own audio or video controls, with seeking.

A link to a narrated deck's `deck.json` (written by the `narrated-demo` skill's `deck.py`) becomes a slide player:
the first slide shows at once; Play loads the narration and the slides, and each slide shows with its spoken line,
with slide skipping, a scrubber and full screen.

## Requirements

- Ultimate (upstream, unpatched). Optional: its built-in tailscale extension, to play over the tailnet.

## How it plays

Ultimate gives extensions no HTTP route of their own, so the file does not stream: Play reads it through the `read`
action in 4 MB base64 chunks (a progress bar shows them), builds a Blob, and plays that. Seeking within a Blob works
everywhere, iPhone Safari included, with no Range requests. The whole file sits in the page's memory while it plays,
so the card refuses files over 150 MB. iPhone Safari cannot play `.webm`, `.ogg`, `.opus` or `.flac`.

## What it serves

The `info` and `read` actions are user-only (the page calls them; agents cannot) and pass Ultimate's admission like
every action: same-origin on the loopback page, the owner's Tailscale login over the tailnet. They read a file only
when all of these hold:

- the path is absolute and ends in a media extension (wav, mp3, m4a, aac, ogg, oga, opus, flac, mp4, m4v, mov, webm),
  or is a deck's slide image (jpg, png);
- with symlinks resolved, it lies inside a project folder Ultimate knows (`host.projects()`), or that project's
  `attachments/` or `worktrees/` under its home;
- its first bytes look like an audio or video container, or a JPEG or PNG.

The `deck` action reads a `deck.json` under the same folder rule and returns its narration and slide paths only when
they lie inside the deck's own folder.

Anything else answers with the reason the card shows: "Outside your project folders", "Not an audio or video file".

## Install, update, uninstall

```sh
git clone https://github.com/jfanals/ultimate-extensions ~/ultimate-extensions   # once
ln -s ~/ultimate-extensions/media ~/.ultimate/extensions/media                    # install
git -C ~/ultimate-extensions pull                                                 # update
rm ~/.ultimate/extensions/media                                                   # uninstall
```

## Tests

```sh
node --test media/media.test.ts
```

They cover what may be read (project folders only, symlinks resolved, media bytes only) and how links are spotted. The
card itself was checked on the running host.
