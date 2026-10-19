// Servidor local de la PWA (sin dependencias): sirve .output/public en http://localhost:4321.
// El puerto es fijo a propósito: los datos, la instalación de la PWA y el login de Google dependen del origen exacto.
// (3000 lo usa otro proyecto local; por eso 4321.)
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'

const ROOT = resolve(import.meta.dirname, '..', '.output', 'public')
const PORT = 4321
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8',
}

async function file(path) {
  try {
    return (await stat(path)).isFile() ? path : null
  } catch {
    return null
  }
}

const server = createServer(async (req, res) => {
  const url = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname)
  const safe = normalize(join(ROOT, url))
  if (!safe.startsWith(ROOT)) return res.writeHead(403).end()
  // SPA: cualquier ruta desconocida devuelve index.html.
  const path = (await file(safe)) ?? (await file(join(safe, 'index.html'))) ?? join(ROOT, 'index.html')
  const body = await readFile(path)
  const type = TYPES[extname(path)] ?? 'application/octet-stream'
  // El service worker y el HTML no se cachean en el navegador, para que las actualizaciones lleguen.
  const noCache = /sw\.js$|\.html$|webmanifest$/.test(path)
  res.writeHead(200, { 'Content-Type': type, 'Cache-Control': noCache ? 'no-cache' : 'public, max-age=31536000, immutable' })
  res.end(body)
})
// Solo este equipo: IPv4 e IPv6 de localhost (no se expone a la red).
server.listen(PORT, '127.0.0.1', () => console.log(`Taurus en http://localhost:${PORT}  (Ctrl+C para detener)`))
const server6 = createServer((req, res) => server.emit('request', req, res))
server6.on('error', () => {}) // sin IPv6: basta con IPv4
server6.listen(PORT, '::1')
