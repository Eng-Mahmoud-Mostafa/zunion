const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const port = Number(process.env.PORT || 5195);

const types = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
};

function send(res, status, body, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

function safeFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]).replace(/^\/+/, "");
  const file = path.resolve(dist, clean || "index.html");
  return file.startsWith(dist) ? file : path.join(dist, "index.html");
}

const server = http.createServer((req, res) => {
  if (!req.url) return send(res, 400, "Bad request");
  if (req.url.startsWith("/api/")) {
    return send(
      res,
      503,
      JSON.stringify({ message: "Backend API is not running on 127.0.0.1:4000. Start Docker/PostgreSQL/backend for OTP login." }),
      "application/json; charset=utf-8",
    );
  }

  let file = safeFile(req.url);
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(dist, "index.html");
  const ext = path.extname(file);
  fs.readFile(file, (error, data) => {
    if (error) return send(res, 404, "Not found");
    send(res, 200, data, types[ext] || "application/octet-stream");
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Zunion local server: http://127.0.0.1:${port}/`);
});

