# JASS Web Intelligence Studio

**Version:** 0.1.0  
**Platform:** Windows desktop (Electron + React + Vite)  
**Storage:** SQLite in the current user's Electron application-data directory

A local-first workbench for collecting permitted public HTML, extracting structured records with CSS selectors, saving reproducible snapshots, comparing results and exporting CSV/JSON.

## Features in v0.1

- Projects with descriptions and independent settings
- Project-scoped target URL list
- Bounded same-allowlist crawl with configurable page and depth caps
- Public HTTP/HTTPS HTML fetch with timeout, response-size cap and redirect validation
- HTML/text/link preview; fetched scripts are not executed
- CSS selector extraction for text, href, src and inner HTML
- Preview and validation before saving
- SQLite storage of runs, hashes, source URL, selector configuration and records
- CSV and JSON export using a native Save dialog
- Snapshot comparison (added/removed extracted rows and content-hash change)
- Per-project domain allowlist, minimum request delay, maximum page count/depth settings
- Protection against localhost/private/link-local/reserved IP targets and redirect escape from the allowlist

## Requirements

- Windows 10/11 64-bit
- Node.js 20 LTS or newer (Node.js 20 LTS recommended)
- npm
- Internet connection for initial dependency installation and fetching public pages

## Run in development

Open PowerShell in the project directory:

```powershell
npm install
npm run dev
```

The first install compiles `better-sqlite3` for Electron via `electron-rebuild`. If the native build fails, install the current Visual Studio Build Tools with **Desktop development with C++**, then rerun `npm install`.

## Build a Windows installer

```powershell
npm run dist:win
```

The NSIS installer will be created under `release/`.

## Data location

The database is created automatically in Electron's `app.getPath('userData')` directory, under `jass-web-intelligence.sqlite`. On Windows this is normally under `%APPDATA%\jass-web-intelligence-studio\` (the exact folder name may depend on Electron packaging metadata).

## First-run workflow

1. Create a project.
2. Open **Settings** and add an approved hostname such as `example.com` to the allowlist. Save settings.
3. Return to **Project**, add a target URL on that hostname.
4. Open **Extract**, fetch the page, configure CSS selectors, and preview rows.
5. Save the snapshot and records; export from **Records** or compare runs in **Snapshots**.

Example selectors for a typical article page:

- `title` → `h1` → Text content
- `date` → `time` → Text content
- `article_text` → `article` → Text content
- `source_link` → `a.canonical-link` → Link URL

Selectors are evaluated against fetched HTML source, not a browser-rendered DOM. Crawl mode follows same-allowlist links only and stops at the configured page/depth limits. Pages that require JavaScript to render are not supported in v0.1.

## Safety and responsible use

- Only HTTP and HTTPS on standard ports are supported.
- A project must explicitly allowlist a hostname before fetching or saving it as a target.
- Redirect destinations are revalidated and must remain allowlisted.
- Localhost, private, link-local and reserved IP addresses are blocked; DNS results are checked before requests.
- Request timeout is 15 seconds. The HTML body has a configurable maximum (100 KB–5 MB).
- Fetch delay is at least 1 second; the configured value is applied between fetches in the project.
- This release does **not** execute page scripts, bypass access controls, solve CAPTCHAs, or crawl login-protected content.
- Check site terms, robots.txt guidance, copyright, privacy rules and applicable law. Prefer official APIs when available. An allowlist is a technical boundary, not permission from a website owner.

## Known v0.1 limitations

- Crawl follows only links on explicitly allowlisted domains, with page/depth caps. Pages that fail to fetch still count toward the page-attempt cap.
- Snapshot comparison reports added/removed extracted rows and whether the raw HTML hash changed. It does not yet compute field-by-field diffs for matched entities.
- The first release uses static HTML and does not render JavaScript-heavy sites.
- The page preview is a sanitized text/link preview rather than executing remote page content inside a webview.
- CSS selector matches are aligned by document order. If selectors return different counts, preview warns and fills missing values with blank cells.

## Project layout

```text
JASS-Web-Intelligence-Studio/
├── electron/
│   ├── main.cjs       # Electron window and lifecycle
│   ├── preload.cjs    # Explicit, context-isolated IPC bridge
│   ├── services.cjs   # Fetch, extraction, safety and SQLite workflows
│   └── store.cjs      # Database schema and initialization
├── src/ui/
│   ├── App.jsx        # Workspace screens and workflows
│   └── styles.css     # Responsive application styling
├── src/main.jsx
├── index.html
├── package.json
└── README.md
```

## License

MIT. See `LICENSE`.
