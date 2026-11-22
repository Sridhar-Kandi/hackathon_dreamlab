# Console frontend

React + TypeScript + Vite, Tailwind CSS and shadcn/ui (Radix). The Python server serves the build from
`../web/app`, so the console runs without Node once built.

## Pages

- `/experiments` — every experiment (console runs, ladder collections, sample save files): create, view results
  in a modal, delete, save to file, fine-tune selected runs.
- `/analyze` — compare up to three save files, diagnose failures, build the two-dataset fine-tune.
- Overview, Ladder and How it works still open in the classic console at `/classic`.

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
