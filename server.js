const http = require("node:http");
const fs = require("node:fs/promises");
const path = require("node:path");

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "entries.json");

const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

async function ensureDataFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    await fs.access(DATA_FILE);
  } catch {
    await fs.writeFile(DATA_FILE, "[]\n", "utf8");
  }
}

async function readEntries() {
  await ensureDataFile();
  const text = await fs.readFile(DATA_FILE, "utf8");
  const parsed = JSON.parse(text || "[]");
  if (!Array.isArray(parsed)) {
    throw new Error("data/entries.json must contain an array.");
  }
  return parsed;
}

async function writeEntries(entries) {
  if (!Array.isArray(entries)) {
    throw new Error("Expected entries to be an array.");
  }
  await ensureDataFile();
  await fs.writeFile(DATA_FILE, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 25 * 1024 * 1024) {
        reject(new Error("Request body is too large."));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function handleApi(req, res) {
  if (req.url !== "/api/entries") {
    sendJson(res, 404, { error: "Not found" });
    return;
  }

  if (req.method === "GET") {
    sendJson(res, 200, { entries: await readEntries() });
    return;
  }

  if (req.method === "PUT") {
    const body = await readBody(req);
    const parsed = JSON.parse(body || "{}");
    await writeEntries(parsed.entries);
    sendJson(res, 200, { entries: parsed.entries });
    return;
  }

  sendJson(res, 405, { error: "Method not allowed" });
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(ROOT, requestedPath));

  if (!filePath.startsWith(ROOT) || filePath.includes(`${path.sep}.git${path.sep}`)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  try {
    const content = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME_TYPES[ext] || "application/octet-stream",
      "cache-control": "no-store",
    });
    res.end(content);
  } catch (error) {
    if (error.code === "ENOENT") {
      res.writeHead(404);
      res.end("Not found");
      return;
    }
    throw error;
  }
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }
    await serveStatic(req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error.message });
  }
});

ensureDataFile()
  .then(() => {
    server.listen(PORT, "127.0.0.1", () => {
      console.log(`Food at Work is running at http://127.0.0.1:${PORT}`);
      console.log(`Entries are saved to ${DATA_FILE}`);
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
