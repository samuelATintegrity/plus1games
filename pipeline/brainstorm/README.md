# brainstorm

Asks Claude for new game ideas and appends them to `../games.json` with `status: "brainstormed"`.

```bash
cd pipeline
npm install              # one-time
node brainstorm/brainstorm.js               # 5 ideas
node brainstorm/brainstorm.js --count 10    # 10 ideas
```

Requires `ANTHROPIC_API_KEY` in `.env` at the repo root (see `.env.example`).
