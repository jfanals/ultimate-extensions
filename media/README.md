# Media

Plays audio and video files and shows text files from this machine inline in the transcript, on the Mac and over the tailnet on a phone.

An agent links a file by its absolute path, `[take 3](/Users/me/my-app/out/take-3.wav)`; a prompt section tells every
agent, in every project, to do so. The link becomes a card with the file's name and size and a play button; Play loads
the file and shows the browser's own audio or video controls, with seeking. A video with a `.vtt` or `.srt` of the same
name beside it (`take.srt` next to `take.mp4`) plays with those subtitles as a caption track.

A link to a narrated deck's `deck.json` (written by the `narrated-demo` skill's `deck.py`) becomes a slide player:
the first slide shows at once; Play loads the narration and the slides, and each spoken line shows as a caption over
its slide, with a CC button, slide skipping, a scrubber and full screen. Decks built before captions were text (each
line burned into its slide; their `deck.json` has no `"captions": true`) play as they are, with no caption overlay.

A deck can play while it builds. `deck.py` writes `deck.json` with `"building": true` as soon as it starts and
republishes it as lines are voiced (the first at once, then each time the deck has doubled), each part with a
narration track of its length. The card reads it again every second while it builds: "Building…" until the first
line is out, then the usual player, whose duration ends in "…". The next part loads while the current one plays and
takes over where it ends; if playing gets there first, a spinner waits on the slide. A build that fails keeps what it
published and shows "Build stopped:" with its `error` under the controls. A build killed outright (`kill -9`) leaves
the card building until the deck is built again.

## Text files

A link to a text file (`[plan](/Users/me/my-app/docs/plan.md)`) becomes a one-line chip in the text, styled like a
`#id` mention: a file icon and the link's label, with the path, size and line count on hover. The prompt section asks
agents to link files they wrote or mention this way. A click, a tap, or Enter once focused opens the file in a viewer
that fills a phone's screen: Markdown renders as the transcript renders it, its relative links pointing at the files
beside it; anything else shows with line numbers and the transcript's own Shiki highlighting. Copy copies the text
shown; **Open in Zed** opens the file in Zed (`zeditor`, else `zed`, on PATH) on the machine Ultimate runs on, so only
a page on that machine (loopback) shows it.

The file is read when it is opened, never from the message: it shows what is on disk now. A deleted file's chip is
struck through and says "File no longer exists" on hover. The first view holds the first 2,000 lines within 200 KB; **Load all** reads up to 5 MB.

What counts as text: an extension for notes, data, logs or source code (md, txt, json, yaml, toml, csv, log, ts, py,
…), or a known name (`Makefile`, `Dockerfile`, `.gitignore`), and no NUL byte in the first 8 KB, git's test for
binary. `.env` files and other dotfiles stay plain links, since they often hold secrets.

## Paths in inline code

A path in inline code (`src/app.ts`, `~/notes/todo.md`, an absolute path, `src/app.ts:42`) that names a text file
which exists gets a faint dotted underline and opens the same full-screen viewer on click, tap, or Enter once
focused. Relative paths count from the shown conversation's folder, `~/` from the home folder; a `:line` is dropped.
Fenced code blocks stay as they are, and so does every span that is not such a path: it renders exactly as before.

Only spans that look like paths are checked: a text extension or name as above (so `.env` and other dotfiles stay
out), no spaces, no shell syntax (`*`, `$`, quotes, brackets), and not a URL or an option. The spans of a page ask
together: they gather for 150 ms, then one `exists` call asks the server about all of them. Each answer counts for
30 seconds; a span shown again after that asks again, while one already shown keeps its link. When the check fails,
the spans stay plain code.

## Keys

YouTube's keys work on one player at a time: the full-screen one, else the one you last played or clicked while at
least half of it is on screen. Space or K plays and pauses, ← and → seek 5 seconds, J and L 10, F toggles full screen
(video and decks) and C the captions. Captions on or off is remembered for every player. The keys never fire while you
type in the composer or another field, and Space scrolls the page as usual when no player qualifies.

## Requirements

- Ultimate (upstream, unpatched). Optional: its built-in tailscale extension, to play over the tailnet.

## How it plays

Ultimate gives extensions no HTTP route of their own, so the file does not stream: Play reads it through the `read`
action in 4 MB base64 chunks (a progress bar shows them), builds a Blob, and plays that. Seeking within a Blob works
everywhere, iPhone Safari included, with no Range requests. The whole file sits in the page's memory while it plays,
so the card refuses files over 150 MB. iPhone Safari cannot play `.webm`, `.ogg`, `.opus` or `.flac`.

## What it serves

The `info`, `read`, `text`, `edit` and `exists` actions are user-only (the page calls them; agents cannot) and pass Ultimate's
admission like every action: same-origin on the loopback page, the owner's Tailscale login over the tailnet. They read a file only
when all of these hold:

- the path is absolute and ends in a media extension (wav, mp3, m4a, aac, ogg, oga, opus, flac, mp4, m4v, mov, webm),
  or is a deck's slide image (jpg, png);
- with symlinks resolved, it lies inside a project folder Ultimate knows (`host.projects()`), or that project's
  `attachments/` or `worktrees/` under its home;
- its first bytes look like an audio or video container, or a JPEG or PNG.

`text` and `edit` take text files under the same folder rule, with symlinks resolved and the binary test above.
`exists` takes up to 500 absolute paths and returns the ones `text` would open, reading at most 8 KB of each. The
`captions` action returns the `.vtt` or `.srt` beside a video that passes the same checks, under the same folder
rule. The `deck` action reads a `deck.json` under the same folder rule and returns its narration and slide paths only when
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

They cover what may be read (project folders only, symlinks resolved, media bytes only), which files count as text and
the size caps of the text viewer, subtitles beside a video, how links are spotted, and which inline code spans count
as paths, how they resolve (relative, `~/`, absolute) and that only text files in project folders open. The cards, chips and
the inline code links themselves were checked on the running host.
