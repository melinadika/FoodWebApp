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

Photos are stored inline as data URLs in that JSON file, so the file can grow if many large photos are added.

If neither `server.js` nor `data/entries.json` is available, it falls back to browser IndexedDB storage.

## GitHub Pages

This repo can also be hosted as a static GitHub Pages site. In that mode, the app reads committed entries from:

```text
data/entries.json
```

Static hosting is read-only. To add or edit meals, run the app locally with `npm start`, make changes in the local app, then commit and push the updated `data/entries.json` file.
