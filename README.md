# Hogwarts Mail Management System

An offline-first operations system for **personalised magical correspondence**: one application that takes a
child's record all the way to a printed, sealed, posted and tracked envelope — and keeps the complete history.

```
Recipient → Order → Project → Letter + Documents + Envelope → Print batch → Assembly → Shipment → History
```

…and back again: every recipient profile shows all of their orders, letters, documents, envelopes, projects,
shipments, notes, files and audit-log entries.

> The product name is configurable (Settings → Company). All demo content — the school, houses, staff
> characters, stamps, seals and artwork — is original. If you use the system commercially, choose your own
> brand name and do not use names, characters or artwork from protected works.

## Quick start

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/ (static files, installable PWA, works offline)
npm run preview    # serve the production build
npm test           # unit + service tests (Vitest, fake IndexedDB)
npm run typecheck
```

On first launch the setup screen creates the administrator account and (optionally) a **Demo Workspace**
with 26 fictional recipients in 12 countries, a year of orders, projects, shipments, print batches, inventory,
suppliers and activity — so every screen shows real data immediately. Demo staff accounts `editor`,
`production` and `viewer` use the password `owlpost2026`; change or delete them in Settings → Users.

The production build is a set of static files (`dist/`) and can be hosted anywhere (or opened from a local
web server). After the first visit the service worker caches the application, so it keeps working without an
internet connection. All data lives in the browser's IndexedDB on that device.

## What's inside

| Area | Highlights |
|---|---|
| **Dashboard** | KPIs, orders per month, letters created vs shipped, recipients by country, popular templates, house distribution, production status, pending tasks, birthdays, notifications, backup reminder |
| **Recipients (CRM)** | Full child records (personal, contact, mailing, personalisation, internal); profile with Overview · Letters · Orders · Mail history · Documents · Envelopes · Projects · Addresses · Notes · Activity · Files; search across names, IDs, cities, emails, phones, addresses, order & tracking numbers, tags; filters; bulk actions; tags; scheduled contacts |
| **Address book** | Multiple addresses per child (home, school, parent, alternative, temporary…) with a default mailing address and per-country validation & formatting |
| **Import / export** | CSV, XLSX (built-in reader/writer), JSON and PDF; import wizard with column auto-mapping (EN/RU/HY headers), validation, preview, duplicate detection and merge/skip decisions |
| **Duplicate detection** | Blocking + Jaro-Winkler scoring across Latin/Cyrillic/Armenian spellings, guardian contacts, DOB and address; Merge (re-links all records) · Keep both · Ignore |
| **Customers & orders** | Order numbers `HM-2026-001842`, products, discounts, shipping fees, payments, production & shipping status derived from projects and shipments, status history |
| **Complete mail package** | One wizard: recipient → template → letter → envelope → stamp/postmark/seal → documents → order → validation → project |
| **Bulk generation** | Select or import recipients, choose a template, “Generate 50 letters”, optionally create orders and a print batch in one go |
| **Studios** | Canvas editor (drag, resize, rotate, snap, layers, undo/redo, variables, drop caps, auto-fit text) for letters, documents and both envelope faces; Envelope, Stamp, Postmark (ink-wear), Seal (wax/embossed/ink/official), House crest and Character studios |
| **Template engine** | Letter & document templates with variables `{{first_name}}`, `{{house}}`, `{{pet_name|your companion}}` (fallbacks), sample-data or real-recipient preview, package defaults |
| **Production** | Kanban production queue (Created → Approved → Generated → Printed → Cut → Folded → Packed → Ready) with drag & drop and bulk moves; Mailroom overview; automatic inventory consumption on packing |
| **Print studio** | Print batches, imposition on A4/A5/A3/Letter/custom, margins, bleed, crop marks, cut/fold lines, safe area, scale, DPI, label sheets (Avery presets), die-cut envelope templates, packing slips; READY FOR PRINT / N ITEMS NEED ATTENTION; print (vector) or export PDF, PNG, JPG, SVG |
| **Assembly mode** | Step-by-step physical assembly checklist per package or for a whole batch |
| **Realistic preview** | Closed envelope, back with wax seal, opened envelope with letter, letter, complete package on a desk |
| **Shipping** | Carrier-agnostic shipments with tracking links, status timeline, labels; order status kept in sync |
| **Inventory & suppliers** | Stock, minimums, LOW STOCK alerts, movements, value, reorder e-mails, supplier database |
| **Analytics** | Today / 7 days / 30 days / 3 & 6 months / year / custom; recipients, orders, letters produced & shipped, delivered, returned, revenue, AOV, delivery & production performance, breakdowns |
| **Security & privacy** | Local accounts with PBKDF2-hashed passwords, roles (Admin, Editor, Production, Viewer) with an editable permission matrix, auto-lock, audit log (who/what/when — field names only, never values), data minimisation options (no gender by default, birthday without year), anonymisation and full deletion of a child's data, retention review, encrypted backups |
| **Offline & data** | Autosave, backup/restore (optionally AES-GCM encrypted), merge or replace restores, demo reset |
| **Languages** | English, Russian, Armenian — UI, dates, numbers and country names; letter templates in all three |

## Architecture

```
src/
  core/      pure domain logic – types, validation, template engine, duplicates, CSV/XLSX, orders, permissions
  db/        IndexedDB schema (Dexie), service layer (all writes + audit log), auth, backup, demo seed
  render/    SVG rendering engine – text layout, paper, borders, stamps, postmarks, seals, crests, barcodes,
             envelopes & die-cut templates, imposition, PDF/PNG/JPG/SVG export, print
  ui/        design-system components, charts, canvas editor
  app/       shell, routing, session, notifications, global wizards
  pages/     one module per section
  i18n/      EN / RU / HY dictionaries
tests/       Vitest unit and service tests
```

* **Local-first by design.** The UI only talks to the service layer (`src/db/services.ts`), which is the single
  place that writes data and records the audit trail. Swapping IndexedDB for a server API later means
  replacing that layer, not the screens.
* **Everything is linked by ids**, while human-readable codes (`#000184`, `HM-2026-001842`, `P-2026-0042`,
  `B-2026-0042`, `SH-2026-00031`) are generated from per-year counters.
* **Projects snapshot their designs** (letter, envelope, documents) from templates, so editing a template never
  changes letters that were already produced; generated letters also store the frozen, personalised text.
* **Vector rendering.** All artwork is SVG measured in millimetres. Browser printing stays vector; exports embed
  the exact font subsets used so files render identically elsewhere.
* **Scales to thousands of recipients**: indexed queries, blocking-based duplicate search, paginated tables,
  batch imports and batch generation.

## Security notes

Data never leaves the device unless you export it. Because the application runs entirely in the browser,
role permissions protect against mistakes and casual misuse on a shared workstation; anyone with full access
to the computer's browser profile can read its storage. For multi-user use across devices, put the service
layer behind a server with its own authentication. Use encrypted backups and keep them somewhere safe — they
contain children's personal data.
