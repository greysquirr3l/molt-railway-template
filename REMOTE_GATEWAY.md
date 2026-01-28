# Remote Gateway Setup Guide

This guide explains how to configure the Molt.bot template as a remote gateway, allowing other devices/nodes to connect directly to your Railway deployment.

## ⚠️ Security Warning

**By default, the gateway binds to loopback only** for security. Enabling remote access exposes your gateway to the network. Only enable this if you:

1. Understand the security implications
2. Have a strong `MOLTBOT_GATEWAY_TOKEN` set
3. Trust your network environment
4. Need direct gateway access (not via web UI)

## Use Cases for Remote Gateway

### When to Enable Remote Access

✅ **Good reasons:**
- Connecting iOS/Android nodes to your gateway
- Using Tailscale for secure private network access
- Multi-device agent workflows
- Development/testing with multiple clients

❌ **Bad reasons:**
- "Just to try it out" (use default loopback mode instead)
- Exposing to internet without understanding security
- When you only need the web UI (that works by default)

## Configuration Options

### Option 1: Loopback (Default - Recommended)

**Configuration:**
```bash
# In Railway environment variables
GATEWAY_BIND=loopback
```

**Behavior:**
- Gateway only accessible at `127.0.0.1:18789`
- Web UI works via wrapper proxy at `https://your-app.railway.app`
- Most secure option
- **This is the default - no configuration needed**

**Use this if:** You only need the web UI and don't have external nodes.

---

### Option 2: Tailscale Network (Secure Remote)

**Configuration:**
```bash
# In Railway environment variables
GATEWAY_BIND=tailnet
```

**Setup Required:**
1. Set up Tailscale in your Railway container
2. Install Tailscale in the Dockerfile
3. Configure Tailscale auth key
4. Connect your devices to the same Tailnet

**Behavior:**
- Gateway accessible via Tailscale IP
- Encrypted private network
- Other devices on your Tailnet can connect
- Goes through Tailscale's encrypted tunnel

**Use this if:** You want secure remote access via Tailscale.

**Additional Setup:**

Add to `molt/Dockerfile`:
```dockerfile
# Install Tailscale
RUN curl -fsSL https://tailscale.com/install.sh | sh
```

Set environment variable:
```bash
TAILSCALE_AUTH_KEY=your-tailscale-auth-key
```

Update `molt/setup-system.sh` to start Tailscale before the wrapper.

---

### Option 3: Open to All Interfaces (⚠️ Use with Caution)

**Configuration:**
```bash
# In Railway environment variables
GATEWAY_BIND=0.0.0.0
```

**Behavior:**
- Gateway accessible on all network interfaces
- **Potentially exposed to internet depending on Railway firewall**
- Requires strong token authentication
- Higher security risk

**Security Requirements:**
1. ✅ Strong `MOLTBOT_GATEWAY_TOKEN` (32+ random characters)
2. ✅ Firewall rules configured
3. ✅ Monitor access logs regularly
4. ✅ Understand Railway's network security model

**Use this only if:**
- You need direct network access
- You understand network security
- You have proper firewall rules
- You're using this temporarily for testing

---

## Railway Port Configuration

### For Remote Gateway Access

If using `tailnet` or `0.0.0.0` binding, you may want to expose the gateway port directly:

1. **Railway Dashboard** → **Settings** → **Networking**
2. **TCP Proxy** → Add port `18789`
3. Railway will assign a domain:port for direct gateway access

**Example:**
```
Gateway: gateway.proxy.rlwy.net:42123
```

**Connect from remote node:**
```bash
# If using TCP proxy
moltbot config set gateway.remote.host gateway.proxy.rlwy.net
moltbot config set gateway.remote.port 42123
moltbot config set gateway.remote.token YOUR_GATEWAY_TOKEN
```

---

## Security Best Practices

### Token Security

1. **Generate a strong token:**
   ```bash
   openssl rand -hex 32
   ```

2. **Set in Railway:**
   ```bash
   MOLTBOT_GATEWAY_TOKEN=your-64-character-hex-string
   ```

3. **Never commit tokens to git**
4. **Rotate tokens periodically**

### Monitoring

Monitor logs for suspicious access:

```bash
# SSH into container
ssh user@domain -p port

# Check gateway logs
moltbot logs | grep -i "unauthorized\|failed\|error"

# Monitor connections
netstat -an | grep 18789
```

### Firewall Rules

If using `0.0.0.0` binding, consider:

1. Railway's built-in network isolation
2. Only allow connections from known IPs
3. Use VPN/Tailscale instead of direct exposure
4. Monitor failed authentication attempts

---

## Example: Tailscale Setup (Recommended)

### 1. Update Dockerfile

```dockerfile
# Add after the runtime dependencies section
RUN curl -fsSL https://tailscale.com/install.sh | sh
```

### 2. Update setup-system.sh

```bash
#!/bin/bash
set -e

# Start Tailscale if auth key is provided
if [ -n "$TAILSCALE_AUTH_KEY" ]; then
    echo "Starting Tailscale..."
    tailscaled --state=/data/tailscale.state &
    sleep 2
    tailscale up --authkey="$TAILSCALE_AUTH_KEY" --hostname=molt-railway
    echo "Tailscale started: $(tailscale ip -4)"
fi

# Continue with existing setup...
```

### 3. Set Railway Environment Variables

```bash
GATEWAY_BIND=tailnet
TAILSCALE_AUTH_KEY=tskey-auth-xxxxxxxxxxxxx
MOLTBOT_GATEWAY_TOKEN=your-secure-token-here
```

### 4. Connect from Another Device

On your other device (also on Tailnet):

```bash
# Get the Railway container's Tailscale IP
# (shown in deployment logs)
GATEWAY_IP=100.x.x.x

# Configure molt.bot to connect
moltbot config set gateway.remote.host $GATEWAY_IP
moltbot config set gateway.remote.port 18789
moltbot config set gateway.remote.token YOUR_GATEWAY_TOKEN
```

---

## Architecture Diagrams

### Default (Loopback)

```
Internet → Railway HTTPS → Wrapper :8080 → Gateway :18789 (loopback)
                                ↑
                           Direct access
                           from wrapper only
```

### Tailscale Remote

```
Internet → Railway HTTPS → Wrapper :8080 → Gateway :18789 (tailnet)
                                                    ↑
Tailnet Device ←─────────────────────────────────────┘
(Encrypted tunnel)
```

### Open (0.0.0.0)

```
Internet → Railway HTTPS → Wrapper :8080 → Gateway :18789 (0.0.0.0)
                                                    ↑
Internet → Railway TCP Proxy :42123 ────────────────┘
(Direct access - token required)
```

---

## Troubleshooting

### "Connection refused" from remote node

1. ✅ Check `GATEWAY_BIND` is not `loopback`
2. ✅ Verify TCP Proxy is configured (if using Railway)
3. ✅ Ensure token matches on both sides
4. ✅ Check firewall allows the connection
5. ✅ Verify container is running

### "Unauthorized" errors

1. ✅ Verify `MOLTBOT_GATEWAY_TOKEN` matches on gateway and client
2. ✅ Check both `gateway.auth.token` and `gateway.remote.token` are set
3. ✅ Ensure token is being passed correctly by client

### Tailscale not connecting

1. ✅ Verify `TAILSCALE_AUTH_KEY` is valid
2. ✅ Check Tailscale daemon is running: `ps aux | grep tailscaled`
3. ✅ Check Tailscale status: `tailscale status`
4. ✅ Verify auth key hasn't expired

---

## Testing Remote Access

### 1. Test from container itself

```bash
# SSH into Railway container
ssh user@domain -p port

# Test gateway locally
curl http://127.0.0.1:18789/

# If using 0.0.0.0, test on all interfaces
curl http://0.0.0.0:18789/
```

### 2. Test from another device

```bash
# If using Railway TCP Proxy
curl http://gateway-domain:port/

# If using Tailscale
curl http://100.x.x.x:18789/

# With authentication
curl -H "Authorization: Bearer YOUR_TOKEN" http://gateway:18789/
```

---

## FAQ

### Q: Should I enable remote gateway?

**A:** Only if you need it. The default loopback mode + web UI is sufficient for most use cases.

### Q: Is Tailscale required for remote access?

**A:** No, but it's the most secure option for remote access.

### Q: Can I use both web UI and remote gateway?

**A:** Yes! The wrapper always works regardless of gateway bind mode.

### Q: Will this cost more?

**A:** TCP Proxy and data transfer may incur additional Railway costs. Check Railway pricing.

### Q: How do I revert to loopback?

**A:** Set `GATEWAY_BIND=loopback` and redeploy.

---

## Related Documentation

- [PORTS.md](../PORTS.md) - Port configuration reference
- [SECURITY.md](../base/SECURITY.md) - General security practices
- [Molt.bot Remote Access Docs](https://docs.molt.bot/gateway/remote)
- [Molt.bot Tailscale Setup](https://docs.molt.bot/gateway/tailscale)
- [Railway Networking](https://docs.railway.com/guides/networking)

---

**Last Updated:** January 27, 2026  
**Template Version:** v2026.1.24

**Remember:** Default loopback mode is secure and works for most use cases. Only enable remote access if you have a specific need and understand the security implications.
