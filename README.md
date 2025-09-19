# HR Whatsapp Creator

Single-page web app (React + Vite) to generate personalized WhatsApp links from CSV/Excel data.

## Develop

```bash
cd web
npm install
npm run dev
```

## Build

```bash
cd web
npm run build
```

## Deploy (GitHub Pages)

This repository is configured with a GitHub Actions workflow that builds `web` and deploys `web/dist` to GitHub Pages on every push to `main`.

If creating the repo locally:
- Ensure your default branch is `main`.
- Push to GitHub. The workflow runs and publishes the site.

The Vite config uses `base: './'` for compatibility with Pages.


