# Sync, backups and mobile

Stacks keeps the whole library in ordinary vault files: one Markdown note per reference, PDFs in the attachments folder, and the settings in `.obsidian/plugins/stacks/data.json`. Whatever syncs or backs up your vault syncs and backs up the library. Stacks has no server and no database of its own.

> **Status.** The behaviour below is covered by automated tests: unit tests against an in-memory stand-in for Obsidian, and end-to-end tests in real Obsidian on desktop, with the mobile UI emulated, and (nightly) in the Android app. See [What is tested](#what-is-tested) for what that covers and what still needs real devices and sync services. Reports from real setups are welcome.

## Supported setups

Stacks assumes file-level sync: a tool that copies whole files between devices and eventually makes every device see the same files. That covers Obsidian Sync, iCloud Drive, Dropbox, OneDrive, Syncthing, and git (for example the Obsidian Git plugin or a scheduled commit). It also covers backup tools that copy or restore the vault folder.

Stacks does not coordinate devices with each other. It relies on what it can see in the vault on the device where it runs.

## How Stacks avoids filing an item twice

The same item can reach two devices: a clip saved on your phone and synced to your laptop, a PDF restored from a backup, or a git pull that brings in notes another device filed. Each create and file step checks the vault first:

- **The duplicate check runs before every capture.** Add reference, New reference without a lookup, and inbox processing look for an existing reference with the same DOI, ISBN (either form) or URL. A clip also keeps the URL it was captured from, so a second clip of the same page matches even after the first got a canonical URL.
- **Notes Obsidian hasn't indexed yet count.** A note that just arrived through sync may not be in Obsidian's metadata cache for a moment. Before creating a note, Stacks reads the properties of any reference note the cache doesn't know yet, so a just-synced copy is still found.
- **An identical PDF isn't filed again.** When a PDF in the inbox belongs to an existing reference and the same file (byte for byte) is already filed under that reference's attachment name, or is already the reference's `pdf`, Stacks leaves the inbox copy where it is and tells you. It doesn't add `name 1.pdf`. A PDF with different content for the same reference is still attached.
- **A PDF that is still arriving waits.** A PDF copied or synced into the inbox in pieces can sit there half written for a while. Stacks only files a PDF whose end it can see (the `%%EOF` marker in its last bytes). Until then it stays in the inbox with a notice, and Stacks looks at it again when it next changes. **Process inbox now** files such a PDF as it is, for the rare PDF written without that marker.
- **Nothing is overwritten.** New notes are created with Obsidian's create call, which fails rather than replacing an existing file. Renames and moves pick a free name (`name 1.md`) when the target exists. Property edits go through Obsidian's frontmatter API, which rewrites only the note's properties. Files copied to the tablet folder are written to a temporary name and then renamed, so a sync client never uploads half a file.
- **One capture at a time on each device.** Duplicate checks and writes on one device run in a queue, so two captures of the same item on the same device can't both create a note.

What this can't prevent: two devices that file the same item at the same moment, before either has received the other's result. Each sees no duplicate and creates a note. Your sync tool then holds two notes for one source (or a sync conflict on one filename). Ways to avoid it:

- Process the inbox on one device. If your sync tool shares the `.obsidian` folder, the **Process inbox automatically** setting is shared too. In that case, turn it off and run **Process inbox now** on the device you choose.
- Let sync finish before processing. Stacks waits a few seconds after startup before it processes the inbox (see below), which gives most sync clients time to bring in what changed.

References created with **New reference without a lookup** and no ISBN, DOI or URL have nothing to match on, so the same manual reference created on two devices becomes two notes, with citekeys `key` and `keya`.

## Offline capture

You can capture while offline. Web Clipper notes and PDFs land in the inbox like any other file.

- **A lookup that gets no answer leaves the item in the inbox, unchanged.** When none of the requests for a clip's URL (or a PDF's DOI or ISBN) gets any response from a server, Stacks treats the network as unreachable. The clip or PDF stays in the inbox exactly as it was, and a notice says so. Nothing is renamed, moved or half filled.
- **A server that answers with an error is different.** A site that blocks Stacks, or a service that is down but reachable, still answers. Then the clip is filed with what Web Clipper saved, as before. A PDF whose identifier finds nothing is filed under its own metadata or filename.
- **Retrying.** Run **Process inbox now**, or restart Obsidian with **Process inbox automatically** on. Stacks doesn't retry on a timer while it keeps running.
- A site whose address doesn't resolve at all looks the same as being offline, so its clips stay in the inbox. To file such a clip, delete its URL property and use **New reference without a lookup**, or remove the clip.

## Processing the inbox at startup

With **Process inbox automatically** on, Stacks processes new inbox files as they arrive while Obsidian runs. It also processes everything already in the inbox about five seconds after Obsidian finishes loading. That covers files dropped in while Obsidian was closed (a Web Clipper save, a PDF copied in Finder, a file another device synced) and offline clips waiting for a retry. When the inbox is empty, this is silent.

## Mobile

Stacks is not marked desktop-only. On phones and tablets, everything works except what needs the computer's file system or the ability to run programs:

| Feature | Mobile |
|---|---|
| Add reference, New reference without a lookup, Refresh metadata, Complete current reference | Yes. Lookups use Obsidian's `requestUrl`, which works on mobile |
| Inbox processing (clips and PDFs), at startup and as files arrive | Yes. PDFs are read with the PDF.js that Obsidian bundles |
| Extract annotations, extract when a PDF is saved | Yes |
| Batch edits, Create library base, the Stacks batch view | Yes |
| Bibliography export, Zotero import | Yes |
| Reading round trip: Send PDF to tablet folder, Check tablet folder, sending on a status change | No. The tablet folder is a path outside the vault. The commands don't appear, and a status change doesn't try to send |
| Pre-extraction command | No. Running a command needs the desktop app. Extraction runs on the PDF as it is |

On mobile the desktop-only settings are hidden. They are still kept in the settings file, so a desktop that shares the settings keeps using them. The tablet folder is an absolute path on one computer; if two computers share settings, set a path that exists on both or leave the round trip on one of them.

## What is tested

The end-to-end tests ([test/e2e](../test/e2e/README.md)) run Stacks in real Obsidian, with every lookup answered from fixtures instead of the network.

**Covered automatically**, on every pull request (desktop: the oldest supported Obsidian and the latest; the latest with the mobile UI emulated):

- A clip a sync client writes into the inbox is filed once.
- Two clips of the same item arriving together, or a clip arriving together with the reference note another device already filed for it, give one note.
- A PDF written in two pieces, quickly or slowly, is filed once and arrives intact.
- Files that reached the inbox while Obsidian was closed are processed at startup, after the startup wait.
- Offline: clips and PDFs stay in the inbox unchanged, and **Process inbox now** files them once the network is back.
- A DOI changed by another device while a batch lookup is pending isn't overwritten.
- Mobile: Stacks loads, the round-trip commands and desktop-only settings are absent, a status change to the send status sends nothing, and capture from the inbox works.

**Covered nightly** in the Android app on an emulator: Stacks loads, capture from the inbox, **Insert citation** and **Check library health**.

**Still manual:**

- iOS and iPadOS. The test tools can't run the iOS app.
- Real sync services (Obsidian Sync, iCloud Drive, Dropbox, OneDrive, Syncthing, git). The tests imitate a sync client by writing files into the vault; each service has its own timing, temporary files and conflict handling.
- Two devices filing the same item at the same moment (see above).
- Touch use on a real phone or tablet: tapping through dialogs, the on-screen keyboard, small screens.
