# Molt.bot Version Pinning Strategy

## Why Pin Versions?

This template pins molt.bot to a specific version (`v2026.1.22`) to ensure:

1. **Reproducible Builds** - Same Dockerfile always builds the same code
2. **Dependency Stability** - Avoid npm/pnpm dependency resolution changes
3. **Predictable Behavior** - Known-good version that has been tested
4. **Controlled Updates** - Explicit decision to upgrade, not automatic

## Current Version

```dockerfile
ARG MOLTBOT_GIT_REF=v2026.1.24
```

Source: https://github.com/moltbot/moltbot/releases/tag/v2026.1.24

## Why Still Use `--no-frozen-lockfile`?

Even with version pinning, we use `pnpm install --no-frozen-lockfile` because:

- Molt.bot's git tags sometimes have lockfile → package.json mismatches
- Extension packages may reference unpublished versions
- We patch package.json files during build to handle this
- Version pinning + flexible install = best of both worlds

## Updating to a New Version

1. **Check releases**: https://github.com/moltbot/moltbot/releases

2. **Test locally first**:
   ```bash
   cd molt/
   docker build --build-arg MOLTBOT_GIT_REF=v2026.X.XX -t molt-test .
   docker run -p 8080:8080 -e SETUP_PASSWORD=test molt-test
   ```

3. **Update Dockerfile**:
   ```dockerfile
   ARG MOLTBOT_GIT_REF=v2026.X.XX
   ```

4. **Update README.md** to mention new version

5. **Commit and deploy**:
   ```bash
   git add molt/Dockerfile molt/README.md
   git commit -m "Update molt.bot to vX.X.XX"
   git push
   ```

6. **Redeploy in Railway**

## Version History

| Date | Version | Notes |
|------|---------|-------|
| 2026-01-27 | v2026.1.24 | Latest stable version |
| 2026-01-27 | v2026.1.22 | Initial version, tested working |

## Rollback Procedure

If a new version causes issues:

1. Revert the Dockerfile change:
   ```bash
   git revert HEAD
   ```

2. Or manually edit back to last known-good version

3. Redeploy in Railway

## Automatic Updates (Not Recommended)

To use the latest main branch (not recommended for production):

```dockerfile
ARG MOLTBOT_GIT_REF=main
```

**Why avoid this:**
- Breaks can happen at any time
- Dependency drift
- No control over when updates occur
- Harder to debug issues

## Best Practices

✅ **Do:**
- Pin to specific tags
- Test new versions before deploying
- Keep a version history
- Read release notes before upgrading

❌ **Don't:**
- Use `main` branch in production
- Skip testing new versions
- Auto-update without review
- Ignore breaking changes in release notes

## Related Files

- [Dockerfile](Dockerfile) - Contains version definition
- [README.md](README.md) - User-facing documentation
- [GATEWAY_TOKEN_FIX.md](GATEWAY_TOKEN_FIX.md) - Gateway auth fix details

---

**Maintained as part of the arch_railway template project**
