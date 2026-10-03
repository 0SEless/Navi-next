# Release Checklist — v1.0.0

## Pre-Release
- [x] All tests passing (585/585)
- [x] Release validation checks passing (28/28)
- [x] Benchmark suite completes without errors
- [x] Stress tests pass (500/1000/5000 rooms)
- [x] End-to-end demo completes (load → compile → publish → runtime → search → route → GPS)
- [x] Regression pipeline passes (6 stages)

## Release
- [x] RELEASE-NOTES.md written
- [x] Git tag v1.0.0 created
- [x] Version bump to 1.0.0 in package.json files

## Post-Release
- [ ] Publish to npm (@navi/core, @navi/compiler, @navi/runtime)
- [ ] Build and deploy demo site
- [ ] Create GitHub release with release notes
