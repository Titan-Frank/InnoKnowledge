## Summary

Describe the problem and the outcome of this change.

## Scope

- Affected packages, scripts, schemas, or tables:
- Contract or migration impact:
- Data/provenance impact:

## Verification

List the exact commands you ran and their results.

```text
npm run check
npm test -w packages/pipeline
npm test -w packages/server
npm run build
```

## Viewer evidence

For interface changes, attach before/after screenshots or a short recording. Remove credentials, personal information, and unauthorized learning material.

## Checklist

- [ ] I preserved the lesson-worker and reducer write boundaries.
- [ ] I updated shared contracts and schemas together where required.
- [ ] I used only safe, documented fixtures.
- [ ] I updated public documentation for user-visible behavior.
- [ ] I recorded remaining risks or follow-up work.
