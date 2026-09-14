# Zeli Inventory

Zeli Inventory is intended to become Zeli's inventory-counting product — a field tool for scanning and reconciling physical stock in retail and warehouse environments.

This repository contains **two surfaces**:

1. **Barcode scanner technical spike** — React/Vite app validating phone-browser barcode scanning with `@zxing/browser`
2. **Inventory concept demo (Carlos pilot)** — self-contained interactive demo served by a small Python static file server

---

## Barcode scanner spike

The scanner spike is a separate frontend under `src/`. It is **not** merged into the concept demo yet.

### Local development

Requirements: Node.js 18+ and npm.

```bash
npm install
npm run dev
```

Open the URL shown by Vite (typically `http://localhost:5173`).

### Build

```bash
npm run build
npm run preview
```

Production output is written to `dist/`.

### Camera access

Browsers require a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts) for camera access (`localhost` or HTTPS). To test on a physical phone during development, use an HTTPS tunnel or deploy to an HTTPS host.

Supported formats: EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39, ITF.

### Why `@zxing/browser`

[`@zxing/browser`](https://github.com/zxing-js/browser) wraps the ZXing decoder for continuous scanning from a live camera stream. It works across mobile browsers without relying on the native `BarcodeDetector` API, which has inconsistent support.

---

## Inventory concept demo (Carlos pilot)

Interactive concept demo for the inventory-counting workflow: master upload, worker scanning, exception capture with photo, supervisor resolution, and in-session barcode mapping.

**Location:** `demo/`

### Start locally

Requirements: Python 3.9+ (stdlib only — no pip packages required).

```bash
python demo/inventory_server.py
```

Default port: **8080** (override with `PORT` environment variable).

### Health check

```bash
curl http://localhost:8080/health
# {"ok":true,"service":"zeli-inventory-demo"}
```

### Routes

| Route | Description |
|-------|-------------|
| `/` | Concept demo homepage (`scanner-test.html`) |
| `/demo`, `/demo.html` | Same demo |
| `/scanner-test`, `/scanner-test.html` | Same demo |
| `/health` | JSON health check for Railway |

All demo UI, styles, and client-side logic live in a single file: `demo/static/scanner-test.html`. The demo uses Quagga2 from jsDelivr CDN for optional real-camera scanning within the interactive flow. Session barcode mappings are stored in browser `localStorage`.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8080` | HTTP listen port |

No other environment variables are required.

### Demo flow (client-side simulation)

1. Upload master / setup team
2. Worker scans or simulates barcode
3. Known product → quantity → save
4. Unknown barcode → quantity + required photo → exception → continue
5. Supervisor reviews exception, confirms mapping
6. Subsequent scans of same barcode resolve automatically (localStorage)

---

## Production deployment status

The live demo at **inventory.lab.zeli.lat** is currently deployed from **`ralmanz/zeli-recruitment`** via a Railway service named `zeli-inventory`:

- Start command: `python inventory_server.py`
- Health check: `/health`
- Custom domain: `inventory.lab.zeli.lat`
- Target port: `8080`

**This repository has not been wired to Railway yet.** After migration review, the expected start command from this repo will be:

```bash
python demo/inventory_server.py
```

Do not change the live Railway service or DNS until explicitly planned.

---

## Stack summary

| Surface | Stack |
|---------|-------|
| Scanner spike | Vite, React, TypeScript, plain CSS, `@zxing/browser` |
| Concept demo | Python 3 stdlib `http.server`, single HTML file + Quagga2 CDN |

No backend database, authentication, or API routes exist in this repo yet beyond the demo's client-side simulation.
