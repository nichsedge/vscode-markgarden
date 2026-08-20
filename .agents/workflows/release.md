---
name: release
description: Step-by-step workflow to test, bump version, package, tag, and publish a new MarkGarden extension release.
---

# MarkGarden Release Workflow

Follow these steps to produce a clean release of the MarkGarden extension:

## 1. Quality & Test Verification
Ensure all quality gates pass before bumping versions:

```bash
# 1. Check workspace status
git status

# 2. Run linter
npm run lint

# 3. Run all unit tests
npm test
```

## 2. Version Bump
Decide on semantic version increment (`patch`, `minor`, `major`):

1. Update `"version"` in [`package.json`](file:///home/al/Projects/markgarden/package.json).
2. Update [`README.md`](file:///home/al/Projects/markgarden/README.md) or CHANGELOG if documenting release notes.

## 3. Package Verification
Verify that `@vscode/vsce` can bundle the extension package without errors:

```bash
npx @vscode/vsce package
```
Ensure the resulting `.vsix` file is generated properly.

## 4. Git Commit & Tagging
Commit the version changes and create a git tag:

```bash
# Stage changed files
git add package.json package-lock.json README.md

# Commit version update
git commit -m "chore(release): v<VERSION>"

# Create annotated tag
git tag -a v<VERSION> -m "Release v<VERSION>"

# Push commit and tags to origin
git push origin main
git push origin v<VERSION>
```

## 5. GitHub Release
Once the tag is pushed, the GitHub Actions release workflow (`.github/workflows/release.yml`) automatically builds and publishes the GitHub Release with the `.vsix` asset.

Alternatively, to release directly via GitHub CLI (`gh`):

```bash
gh release create v<VERSION> *.vsix --title "v<VERSION>" --generate-notes
```
