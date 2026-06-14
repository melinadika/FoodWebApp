const http = require("node:http");
const { execFile } = require("node:child_process");
const fs = require("node:fs/promises");
const path = require("node:path");
const { promisify } = require("node:util");

const PORT = Number(process.env.PORT || 4173);
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "entries.json");
const PUBLISH_DELAY_MS = Number(process.env.PUBLISH_DELAY_MS || 5 * 60 * 1000);
const AUTO_PUBLISH = process.env.AUTO_PUBLISH !== "false";
const execGitFile = promisify(execFile);

const publishState = {
  enabled: AUTO_PUBLISH,
  status: AUTO_PUBLISH ? "idle" : "disabled",
  pending: false,
  publishing: false,
  nextRunAt: null,
  lastPublishedAt: null,
  lastError: null,
  lastCommit: null,
};

let publishTimer = null;

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

function publishSnapshot() {
  return {
    ...publishState,
    delayMs: PUBLISH_DELAY_MS,
  };
}

function schedulePublish() {
  if (!AUTO_PUBLISH) return;

  if (publishTimer) {
    clearTimeout(publishTimer);
  }

  publishState.pending = true;
  publishState.status = "pending";
  publishState.nextRunAt = new Date(Date.now() + PUBLISH_DELAY_MS).toISOString();
  publishState.lastError = null;

  publishTimer = setTimeout(() => {
    publishTimer = null;
    publishChanges().catch((error) => {
      console.error(error);
    });
  }, PUBLISH_DELAY_MS);
}

async function git(args, options = {}) {
  return execGitFile("git", args, {
    cwd: ROOT,
    maxBuffer: 1024 * 1024,
    ...options,
  });
}

async function publishChanges() {
  if (!AUTO_PUBLISH || publishState.publishing) return;

  publishState.publishing = true;
  publishState.pending = false;
  publishState.status = "publishing";
  publishState.nextRunAt = null;
  publishState.lastError = null;

  try {
    await git(["add", "data/entries.json"]);

    try {
      await git(["diff", "--cached", "--quiet", "--", "data/entries.json"]);
      publishState.status = "idle";
      publishState.lastCommit = null;
      return;
    } catch (error) {
      if (error.code !== 1) {
        throw error;
      }
    }

    const timestamp = new Date().toISOString();
    await git(["commit", "-m", `Update meal log ${timestamp}`, "--", "data/entries.json"]);
    const { stdout } = await git(["rev-parse", "--short", "HEAD"]);
    await git(["push"]);

    publishState.status = "published";
    publishState.lastPublishedAt = new Date().toISOString();
    publishState.lastCommit = stdout.trim();
  } catch (error) {
    publishState.status = "error";
    publishState.lastError = [error.message, error.stderr, error.stdout].filter(Boolean).join("\n").trim();
  } finally {
    publishState.publishing = false;
  }
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
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/api/publish/status") {
    if (req.method === "GET") {
      sendJson(res, 200, publishSnapshot());
      return;
    }

    sendJson(res, 405, { error: "Method not allowed" });
    return;
  }

  if (url.pathname !== "/api/entries") {
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
    schedulePublish();
    sendJson(res, 200, { entries: parsed.entries, publish: publishSnapshot() });
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
      console.log(AUTO_PUBLISH ? `Auto-publish is enabled after ${PUBLISH_DELAY_MS}ms of inactivity.` : "Auto-publish is disabled.");
    });
  })
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
