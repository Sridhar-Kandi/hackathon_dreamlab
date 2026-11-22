# DreamLoop frontend

React + TypeScript + Vite, Tailwind CSS and shadcn/ui (Radix). The Python server serves the build from
`../web/app`, so the console runs without Node once built.

## Pages

- `/` — DreamLoop overview: the product pitch, shippable harness capabilities and three experiment modes.
- `/methodology` — expandable flowchart covering execution, failure analysis, both datasets, API training and held-out validation.
- `/experiments` — every experiment (console runs, ladder collections, sample save files): create, view results
  in a modal, delete, save to file, fine-tune selected runs.
- `/analyze` — compare up to three save files, diagnose failures, build the two-dataset fine-tune.
- The sidebar contains Overview, Experiments, Analyze & fine-tune, and Methodology. The legacy console remains available at `/classic`.

## Visual design

The studio follows the public [Dream Labs](https://dreamlabs.ai/) design system: Walla typography,
Bitcount Single detail labels, charcoal ink, creamsicle peach, sunshine yellow and pastel accents.
The original font files, wordmark, cloud icon and playground illustration are bundled in `src/assets`
from the company's public `/fonts/` and `/brand/` assets. Vite fingerprints these into `/static/`, so
the Python server serves the design without runtime font or image requests to a third party.
Colors for the shell, forms, charts, badges and dialogs use light/dark tokens in `src/index.css`.

## Build

```
npm install
npm run build          # writes ../web/app
```

## Develop

Start the server on port 8781 (`python -m mission_control --port 8781` from the repository root), then
`npm run dev`; Vite proxies `/api`, `/lab-media` and `/ladder-media` to it.

Set `LADDER_DIR` to a ladder folder (for example another checkout's `dreameval/.mission-control/ladder`) to list
its collections as read-only experiments.
