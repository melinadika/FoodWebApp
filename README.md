# Food at Work

A local-first cafeteria tracker with a calendar dashboard.

## Run

```sh
npm start
```

Then open:

```text
http://127.0.0.1:4173
```

## Storage

When the app is run with `npm start`, entries are read from and written to:

```text
data/entries.json
```

Photos are stored as separate files in:

```text
data/photos/
```

Entries keep relative photo paths, so `data/entries.json` stays small and GitHub Pages can still serve the photos.

If neither `server.js` nor `data/entries.json` is available, it falls back to browser IndexedDB storage.

## Auto-Publish

When the local server writes changes to `data/entries.json`, it waits for 5 minutes of inactivity and then automatically commits and pushes the updated meal log to GitHub.

The server commits `data/entries.json` and `data/photos/`.

You can adjust or disable auto-publish when starting the server:

```sh
PUBLISH_DELAY_MS=300000 npm start
AUTO_PUBLISH=false npm start
```

## GitHub Pages

This repo can also be hosted as a static GitHub Pages site. In that mode, the app reads committed entries from:

```text
data/entries.json
```

Static hosting is read-only. To add or edit meals, run the app locally with `npm start`, make changes in the local app, then commit and push the updated `data/entries.json` file.
