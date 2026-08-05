# Contributing to MoeReview

## Before changing code

1. Confirm the repository directory and run `git status --short --branch`.
2. Read `docs/DEVELOPMENT_WORKFLOW.md` and the task-relevant documents under `docs/`.
3. Reuse the existing Hub, paper cache, translation, and learning paths before adding a parallel service.
4. Keep secrets, runtime data, PDFs, generated media, `node_modules`, and build output out of Git.

## Local checks

```powershell
npm.cmd --prefix mcp-server run build
npm.cmd --prefix web run build
npm.cmd --prefix web run lint
npm.cmd run release:check
git diff --check
```

For provider-facing changes, also exercise missing-key, network-failure, rate-limit, and empty-result paths. For UI changes, check desktop and mobile layouts and deep-link refresh behavior.

## Pull requests

Describe the user workflow, changed ownership boundary, migration impact, and verification performed. Do not include API Keys, local paths that reveal private data, runtime logs, screenshots containing paper or account data, or generated installers in source commits.
