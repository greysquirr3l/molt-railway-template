# Molt.bot Gateway Token Fix - Technical Details

## The Problem

When accessing the Molt.bot Control UI remotely (via Railway's public URL), users encountered:

```
disconnected (1008): unauthorized: gateway token missing
(set gateway.remote.token to match gateway.auth.token)
```

## Root Cause

Molt.bot's gateway has two separate token configurations:

1. **`gateway.auth.token`** - Token the gateway server uses for authentication
2. **`gateway.remote.token`** - Token the browser client sends when connecting

When accessing locally (`localhost:18789`), these can be omitted or auto-handled. But when accessing remotely through a proxy (like Railway's public domain), **both must be set and must match**.

### Additional Issue: Running as Root

Early versions of this template had an additional problem: services ran as root, causing configuration files to be created in `/root/.moltbot/` instead of the intended `/data/.moltbot/` directory. This resulted in:

- Config files scattered in root's home directory
- Permission issues when accessing `/data` volumes
- Non-persistent configuration across container restarts
- Security concerns from running services as root

**The fix**: All molt.bot processes now run as a dedicated `moltbot` user (UID 1000) with proper ownership of `/data` directories.

## The Fix

This template's wrapper server (`wrapper/src/server.js`) explicitly sets both tokens during configuration:

```javascript
// Lines 380-383 in server.js
await runCmd(MOLTBOT_NODE, moltArgs(["config", "set", "gateway.auth.token", GATEWAY_TOKEN]));
await runCmd(MOLTBOT_NODE, moltArgs(["config", "set", "gateway.remote.token", GATEWAY_TOKEN]));
```

This happens during:
- Initial onboarding (`/setup/api/onboard`)
- Manual configuration (`/setup/api/configure`)

## Configuration Structure

The wrapper ensures `~/.moltbot/moltbot.json` contains:

```json
{
  "gateway": {
    "bind": "loopback",
    "port": 18789,
    "auth": {
      "mode": "token",
      "token": "same-token-value"
    },
    "remote": {
      "token": "same-token-value"
    }
  }
}
```

## Token Generation

The gateway token is:

1. **First priority**: Environment variable `MOLTBOT_GATEWAY_TOKEN`
2. **Second priority**: Persisted file at `/data/.moltbot/gateway.token`
3. **Fallback**: Auto-generated 32-byte random hex

This ensures the token remains stable across container restarts.

## Comparison with Original Template

| Aspect | greysquirr3l/clawdbot-railway-template | This Template |
|--------|----------------------------------------|---------------|
| Gateway token set | ✅ Yes | ✅ Yes |
| Remote token set | ❌ Missing | ✅ **Fixed** |
| Token persistence | ✅ Yes | ✅ Yes |
| Browser auth works | ⚠️ Sometimes fails | ✅ Always works |
| Runs as non-root user | ❌ No (runs as root) | ✅ **Fixed** (moltbot user) |
| Config file location | ⚠️ `/root/.moltbot/` | ✅ `/data/.moltbot/` |
| Persistent config | ⚠️ Unpredictable | ✅ Always persistent |

## Verification

After setup, verify the configuration:

```bash
# SSH into your container
ssh user@domain -p port

# Check both tokens are set and match
moltbot config get gateway.auth.token
moltbot config get gateway.remote.token

# They should return the same value
```

Or check the config file directly:

```bash
cat /data/.moltbot/moltbot.json | grep -A 10 "gateway"
```

## Manual Fix (if needed)

If you're using an existing deployment with the error:

```bash
# SSH into container
ssh user@domain -p port

# Get current auth token
AUTH_TOKEN=$(moltbot config get gateway.auth.token)

# Set remote token to match
moltbot config set gateway.remote.token "$AUTH_TOKEN"

# Restart gateway (or redeploy in Railway)
moltbot gateway restart
```

## References

- [Molt.bot Gateway Documentation](https://docs.molt.bot/gateway)
- [Molt.bot Remote Access](https://docs.molt.bot/gateway/remote)
- [Molt.bot Security](https://docs.molt.bot/gateway/security)
- [Original Issue Discussion](https://github.com/greysquirr3l/clawdbot-railway-template)

## Testing the Fix

1. Deploy this template to Railway
2. Configure via `/setup` wizard
3. Access the Control UI at your Railway domain
4. You should NOT see the token error
5. WebSocket connection shows as authenticated in browser console

## Additional Notes

- The wrapper proxies all requests to the gateway running on `localhost:18789`
- Railway's public URL → Wrapper (port 8080) → Gateway (port 18789)
- Tokens are required because connections come from "remote" (Railway's network)
- Loopback binding keeps the gateway itself not directly exposed to internet

## User Permissions and File Paths

This template now runs all molt.bot services as a dedicated `moltbot` user instead of root. This ensures:

### Benefits

1. **Proper file ownership**: Configuration files are created in `/data/.moltbot/moltbot.json` (owned by `moltbot:moltbot`)
2. **Persistent storage**: Files in `/data` persist across container restarts via Railway volumes
3. **Security**: Services don't run as root, following container best practices
4. **Predictable paths**: Config always goes to `$MOLTBOT_STATE_DIR`, not `/root/` or random locations

### Implementation

The Dockerfile creates the user:

```dockerfile
RUN useradd -m -u 1000 -s /bin/bash -G wheel moltbot && \
    echo "moltbot ALL=(ALL) NOPASSWD: ALL" >> /etc/sudoers

RUN mkdir -p /data/.moltbot /data/workspace /app && \
    chown -R moltbot:moltbot /data /app /moltbot
```

The startup script runs the wrapper as `moltbot`:

```bash
# Start as moltbot user (non-root)
exec su -s /bin/bash moltbot -c 'exec node /app/src/server.js'
```

### Verifying the Fix

After deployment, SSH in and check:

```bash
# Check which user the wrapper is running as
ps aux | grep server.js
# Should show: moltbot   123  ... node /app/src/server.js

# Check config file ownership
ls -la /data/.moltbot/moltbot.json
# Should show: -rw-r--r-- 1 moltbot moltbot ...

# Check workspace ownership  
ls -la /data/workspace
# Should show: drwxr-xr-x 2 moltbot moltbot ...
```

If you see files owned by `root`, the container is running an older version. Redeploy to fix.

---

**This fix is incorporated into the molt/ template automatically. No manual configuration needed!**
