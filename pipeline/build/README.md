# build

Daily build automation. The real work happens in `.github/workflows/daily-build.yml`, which:

1. Runs `node build/build-daily.js --pick` to find the oldest approved game
2. Hands the spec to the Claude Code GitHub Action
3. Claude Code creates `site/src/games/<id>/`, registers the route, adds an arcade machine, and flips status to `testing`
4. Opens a PR titled "Build: <id>"
5. Cloudflare Pages auto-creates a preview URL on the PR
6. You play the preview, then merge to deploy

`build-prompt.md` is the prompt template the action passes to Claude Code.

Local commands:
```bash
node build/build-daily.js --list   # show approved games waiting to build
node build/build-daily.js --pick   # print the next game id (used by CI)
```
