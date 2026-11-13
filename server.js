import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";

const root = process.cwd();
const port = Number(process.env.PORT || 3000);
const types = { ".html":"text/html; charset=utf-8", ".css":"text/css; charset=utf-8", ".js":"text/javascript; charset=utf-8", ".json":"application/json; charset=utf-8", ".svg":"image/svg+xml", ".png":"image/png", ".jpg":"image/jpeg", ".ico":"image/x-icon" };

http.createServer(async (req,res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    let file = normalize(join(root, pathname === "/" ? "index.html" : pathname));
    if (!file.startsWith(root)) throw new Error("Invalid path");
    let data;
    try { data = await readFile(file); }
    catch { data = await readFile(join(root, "index.html")); file = join(root, "index.html"); }
    res.writeHead(200, { "Content-Type": types[extname(file)] || "application/octet-stream", "Cache-Control":"no-store" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type":"text/plain; charset=utf-8" });
    res.end("Not found");
  }
}).listen(port, "0.0.0.0", () => console.log("Thunder AI listening on " + port));
