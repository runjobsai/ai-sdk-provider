# Project rules

## Git: read-only

Use git for reading only. Never change repository state.

**Allowed** — anything that only observes:
`git status`, `git log`, `git diff`, `git show`, `git branch --list`,
`git remote -v`, `git stash list`, `git blame`, `git ls-files`.

**Not allowed** — anything that writes, including:

- staging or unstaging: `git add`, `git rm --cached`, `git restore --staged`,
  `git reset`
- `git commit`, `git push`, `git pull`, `git fetch`, `git merge`, `git rebase`
- `git checkout` / `git switch` when it changes branches or files,
  `git branch` when it creates or deletes, `git stash push`, `git tag`
- `git mv` — move files with plain `mv` instead

This holds even when the work is finished and a commit looks like the obvious
next step: leave every change in the working tree and say what was changed.
Staging and committing are the author's decisions, and staged state carries
intent — a partially staged tree is often deliberate, and `git add -A` destroys
that intent silently. Do not ask for permission to commit either; just report
what changed and stop.
