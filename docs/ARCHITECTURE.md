# Folder Architecture

Documents the responsibility of every top-level (and key `src/`) folder in this
repo. Written to close the "documented responsibility" gap found in the
2026-07-31 foundation audit — see `PROGRESS.md` for that history.

| Folder | Purpose | Belongs here | Never here | Status |
|---|---|---|---|---|
| `src/` | Entire shipped product | `index.html`, `css/`, `js/`, `data/`, `assets/` | docs, tests, harness config | EXISTING |
| `src/css/` | Presentation only | Stylesheets | JS logic, markup, data | EXISTING |
| `src/js/` | Application behavior | `app.js` and any future behavior modules | Hardcoded config/data, styling | EXISTING |
| `src/data/` | Static seed/config data, decoupled from behavior | `config.js`, static fixtures | DOM manipulation, event handlers | EXISTING — see `src/data/README.md` |
| `src/assets/` | Static media | Images, icons, fonts | Code, data, logic | EXISTING — see `src/assets/README.md` |
| `docs/` | In-repo documentation shipped with the codebase | Architecture notes, this file | Live governance rules, application code | EXISTING |
| `tests/` | Automated verification layer | Test files for `app.js` logic once a runner is adopted | Production code, docs | EXISTING (empty) — see `tests/README.md` |
| `.claude/` | Claude Code harness configuration | Agent/skill/hook config | Site code, data, product docs | EXISTING — DO-NOT-TOUCH casually |

## Known legacy / do-not-touch

- `docs/CLAUDE.colaberry-template.md.bak` — archived source of a CLAUDE.md
  mismatch (see PROGRESS.md 2026-07-31). Leave in place pending owner decision.
- `Colabbery Project/` (repo-root sibling folder) — orphaned duplicate of the
  same mismatched CLAUDE.md. Unresolved; no action without an explicit
  decision to delete or repurpose it.

## No new top-level folders

`/backend`, `/frontend`, `/scripts`, `/directives`, `/system` etc. from the
root `CLAUDE.md` are not proposed here — that file is a mismatched template
(see PROGRESS.md 2026-07-31) and those folders have no basis in this
project's actual README, stack, or existing tree.

## Next implementation step

Week 3 candidate: extract the `CONFIG` object (chairs, services, shop hours)
from `src/js/app.js:7-19` into `src/data/config.js`, loaded via a `<script>`
tag before `app.js` in `index.html`. Not yet implemented.
