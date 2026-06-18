const fs = require("node:fs/promises");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");
const DATA_FILE = path.join(ROOT, "data", "entries.json");
const PHOTO_DIR = path.join(ROOT, "data", "photos");
const PHOTO_PUBLIC_DIR = "data/photos";

function photoExtensionFromMime(mimeType) {
  const extensions = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
  };
  return extensions[mimeType.toLowerCase()] || "jpg";
}

function slugify(value) {
  return String(value || "meal")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "meal";
}

async function main() {
  await fs.mkdir(PHOTO_DIR, { recursive: true });
  const entries = JSON.parse(await fs.readFile(DATA_FILE, "utf8"));
  let migrated = 0;

  const normalized = [];
  for (const entry of entries) {
    if (!entry.photo || typeof entry.photo !== "string" || !entry.photo.startsWith("data:")) {
      normalized.push(entry);
      continue;
    }

    const match = entry.photo.match(/^data:([^;]+);base64,(.+)$/);
    if (!match) {
      throw new Error(`Invalid photo data URL for ${entry.id}`);
    }

    const [, mimeType, base64] = match;
    const extension = photoExtensionFromMime(mimeType);
    const fileName = `${entry.date || "undated"}-${entry.mealType || "meal"}-${slugify(entry.dishName)}-${entry.id}.${extension}`;
    await fs.writeFile(path.join(PHOTO_DIR, fileName), Buffer.from(base64, "base64"));
    normalized.push({ ...entry, photo: `${PHOTO_PUBLIC_DIR}/${fileName}` });
    migrated += 1;
  }

  await fs.writeFile(DATA_FILE, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
  console.log(`Migrated ${migrated} photos to ${PHOTO_DIR}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
