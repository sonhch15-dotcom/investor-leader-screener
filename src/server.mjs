import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";

const portFlagIndex = process.argv.indexOf("--port");
const PORT = Number(portFlagIndex >= 0 ? process.argv[portFlagIndex + 1] : process.env.PORT ?? 4173);
const ROOT = process.cwd();

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

function resolvePath(urlPath) {
  if (urlPath === "/" || urlPath === "") return path.join(ROOT, "dashboard", "index.html");
  if (urlPath === "/app.js") return path.join(ROOT, "dashboard", "app.js");
  if (urlPath === "/styles.css") return path.join(ROOT, "dashboard", "styles.css");
  if ([
    "/us-strategy-history.html",
    "/us-strategy-history.css",
    "/us-strategy-history.js",
    "/point-in-time-audit.html",
    "/point-in-time-audit.css",
    "/point-in-time-audit.js",
    "/c-robustness-audit.html",
    "/c-robustness-audit.css",
    "/c-robustness-audit.js",
    "/us-100m-capital-audit.html",
    "/us-100m-capital-audit.css",
    "/taxonomy-leader-group-audit.html",
    "/taxonomy-leader-group-audit.css",
    "/taxonomy-leader-group-audit.js"
  ].includes(urlPath)) return path.join(ROOT, "dashboard", urlPath.slice(1));
  const normalized = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, "");
  return path.join(ROOT, normalized);
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    const filePath = resolvePath(url.pathname);
    if (!filePath.startsWith(ROOT)) {
      response.writeHead(403);
      response.end("Forbidden");
      return;
    }
    const body = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath)] ?? "text/plain; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(body);
  } catch (error) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
  }
});

server.listen(PORT, () => {
  console.log(`Dashboard: http://localhost:${PORT}`);
});
