# Zeli Inventory

Zeli Inventory is intended to become Zeli's inventory-counting product — a field tool for scanning and reconciling physical stock in retail and warehouse environments.

**This repository currently contains only a barcode scanner technical spike.** No inventory counting, exceptions, master-data upload, AI matching, quantity controls, or dashboards exist yet. The goal is to validate the riskiest assumption first: whether scanning real retail barcodes from a normal phone browser is fast and reliable enough.

## Current scope

The app opens a camera-on-demand barcode scanner and records successful reads in a local session list. Nothing is sent to a server or persisted beyond the browser session.

Supported formats: EAN-13, EAN-8, UPC-A, UPC-E, Code 128, Code 39, and ITF.

## Local development

Requirements: Node.js 18+ and npm.

```bash
npm install
npm run dev
```

Open the URL shown by Vite (typically `http://localhost:5173`).

### Camera access

Browsers require a [secure context](https://developer.mozilla.org/en-US/docs/Web/Security/Secure_Contexts) for camera access:

- `localhost` during development
- HTTPS in production

Opening the page over plain HTTP on a phone will not grant camera access.

To test on a physical phone while developing, use a tunnel (for example Cloudflare Tunnel or ngrok) or deploy to an HTTPS host.

## Build

```bash
npm run build
npm run preview
```

Production output is written to `dist/`.

## Why `@zxing/browser`

[`@zxing/browser`](https://github.com/zxing-js/browser) wraps the ZXing decoder for continuous scanning from a live camera stream in the browser. It works across mobile browsers without relying on the native `BarcodeDetector` API, which has inconsistent support. The library handles multiple 1D retail barcode formats commonly found on inventory labels.

## Planned deployment

Production hostname (not yet deployed): **inventory.lab.zeli.lat**

## Stack

- Vite
- React
- TypeScript
- Plain CSS
- `@zxing/browser`

No backend, database, authentication, or component library is included in this spike.
