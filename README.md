# Browser Tools

A collection of small, single-file developer tools that run entirely in your
browser. No install, no server, no data leaving the page. Each tool lives in
its own folder; `index.html` at the root is a landing page that links to them.

## Live site

The repository root is served as-is via **GitHub Pages**:

1. Push this repo to GitHub.
2. Settings → **Pages** → *Build and deployment* → **Deploy from a branch**.
3. Branch: your default branch, folder: **`/ (root)`**. Save.

The landing page is `index.html`; GitHub Pages serves it automatically at the
site root.

## Tools

| Tool | What it does |
|---|---|
| [Postgres Query Explainer](postgres-query-explainer/) | Runs `EXPLAIN (ANALYZE, BUFFERS)` in-browser (real Postgres via WASM) and renders the plan as an annotated, colour-coded tree. |

## Adding a tool

1. Put the tool in its own folder in the repo root (a self-contained
   `something.html`, or a folder with its own build — see the Postgres tool).
2. Add one entry to the `TOOLS` array near the bottom of `index.html`:

   ```js
   {
     title: "My Tool",
     href: "my-tool/my-tool.html",
     description: "One or two sentences on what it does.",
     tags: ["Tag", "Tag"],
   },
   ```

That's it — the card renders itself, and the shared theme (light/dark toggle,
fonts, colours) applies automatically.

## Theme

All pages share one visual theme and a single `pqe-theme` value in
`localStorage`, so a light/dark choice on any page carries across the whole
site. The theme is applied before first paint to avoid a flash.
