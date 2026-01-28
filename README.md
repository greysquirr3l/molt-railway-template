# 🦞 Hardened Arch Linux + Molt.bot for Railway

A combined template that provides **SSH access** to a hardened Arch Linux container PLUS **Molt.bot** (AI agent messaging gateway for WhatsApp, Telegram, Discord, iMessage).

## What You Get

- **Molt.bot Gateway**: AI agent that works with WhatsApp, Telegram, Discord, etc.
- **SSH Server**: Secure remote access to your container
- **Web UI**: Browser-based control panel for Molt.bot
- **Setup Wizard**: Easy configuration via `/setup` endpoint
- **Hardened Security**: fail2ban, strong SSH ciphers, Railway isolation, minimal attack surface

## Quick Deploy to Railway

1. **Deploy This Template** to Railway
2. **Add a Volume**: Mount at `/data` for persistent storage
3. **Set Environment Variables**:
   - `SETUP_PASSWORD` - Password to access `/setup` wizard (required)
   - `SSH_USERNAME` - Your SSH username
   - `SSH_PASSWORD` - Your SSH password (or use SSH keys)
   - `MOLTBOT_STATE_DIR=/data/.moltbot`
   - `MOLTBOT_WORKSPACE_DIR=/data/workspace`

4. **Configure TCP Proxy** for SSH:
   - Settings → Networking → TCP Proxy
   - Port: `22`
   - **See [Port Reference Guide](../PORTS.md) for complete port details**

5. **Deploy** and wait for build to complete

## Setup Molt.bot

### Via Web UI (Recommended)

1. Visit `https://your-app.railway.app/setup`
2. Enter your `SETUP_PASSWORD`
3. Click **Run Setup Wizard**
4. Follow the prompts to configure your AI provider
5. Access the dashboard at `https://your-app.railway.app/`

### Via SSH

```bash
# Connect to your container
ssh your_username@domain.railway.app -p PORT

# Run molt.bot onboarding
moltbot onboard

# Configure channels (optional)
moltbot channels add telegram --token YOUR_BOT_TOKEN
moltbot channels add discord --token YOUR_BOT_TOKEN

# Start gateway (wrapper handles this automatically)
moltbot gateway
```

## Environment Variables

### Required

| Variable | Description |
| ---------- | ------------- |
| `SETUP_PASSWORD` | Password for `/setup` web wizard |
| `SSH_USERNAME` | SSH login username |
| `SSH_PASSWORD` | SSH login password |

### Recommended

| Variable | Description | Default |
| ---------- | ------------- | --------- |
| `MOLTBOT_STATE_DIR` | Config/state directory | `/data/.moltbot` |
| `MOLTBOT_WORKSPACE_DIR` | Workspace directory | `/data/workspace` |
| `MOLTBOT_GATEWAY_TOKEN` | Gateway auth token | Auto-generated |

### Optional SSH

| Variable | Description |
| ---------- | ------------- |
| `AUTHORIZED_KEYS` | SSH public keys (separate with `;` or newlines) |
| `DISABLE_PASSWORD_AUTH` | Set to `true` to use SSH keys only |

### Optional Molt.bot

| Variable | Description |
| ---------- | ------------- |
| `ANTHROPIC_API_KEY` | Claude API key |
| `OPENAI_API_KEY` | OpenAI/ChatGPT API key |
| `GOOGLE_API_KEY` | Google Gemini API key |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token |
| `DISCORD_BOT_TOKEN` | Discord bot token |

## The Gateway Token Fix

This template **fixes the common authentication error**:
```
disconnected (1008): unauthorized: gateway token missing
(set gateway.remote.token to match gateway.auth.token)
```

**Solution**: The wrapper automatically sets both `gateway.auth.token` AND `gateway.remote.token` to the same value during setup. This allows the browser Control UI to authenticate properly with the gateway.

## Remote Gateway Mode (Optional)

By default, the gateway binds to **loopback only** (`127.0.0.1`) for security. This is perfect for web UI access via Railway's public URL.

**However**, you can configure the gateway for **remote access** to enable direct connections from other devices (iOS, Android, other computers):

### Configuration

Set the `GATEWAY_BIND` environment variable:

| Mode | Description | Security | Use Case |
| ------ | ------------- | ---------- | ---------- |
| `loopback` | Default, localhost only | ✅ Most Secure | Web UI access only |
| `tailnet` | Tailscale network | ✅ Secure (encrypted) | Private VPN access |
| `0.0.0.0` | All interfaces | ⚠️ Use with caution | Direct network access |

### Example: Enable Tailscale Access

```bash
# In Railway environment variables
GATEWAY_BIND=tailnet
MOLTBOT_GATEWAY_TOKEN=your-strong-token-here
```

Then configure your remote device:

```bash
moltbot config set gateway.remote.host 100.x.x.x  # Tailscale IP
moltbot config set gateway.remote.port 18789
moltbot config set gateway.remote.token your-strong-token-here
```

### ⚠️ Security Warning

Only enable remote gateway mode if:
- ✅ You have a **strong** `MOLTBOT_GATEWAY_TOKEN` set
- ✅ You understand network security implications
- ✅ You need direct gateway access (not just web UI)

**For detailed setup instructions, see [REMOTE_GATEWAY.md](REMOTE_GATEWAY.md)**

## SSH Access

### Connect via SSH

After configuring TCP Proxy in Railway:

```bash
ssh username@your-domain.railway.app -p PORT
```

### Using SSH Keys

1. Generate a key (if needed):
   ```bash
   ssh-keygen -t ed25519 -C "your@email.com"
   ```

2. Add your public key to `AUTHORIZED_KEYS` environment variable in Railway

3. Set `DISABLE_PASSWORD_AUTH=true` for key-only auth

4. Connect:
   ```bash
   ssh -i ~/.ssh/id_ed25519 username@domain -p PORT
   ```

## Molt.bot Features

- 📱 **WhatsApp** - Via WhatsApp Web protocol (Baileys)
- ✈️ **Telegram** - Bot API with group support
- 🎮 **Discord** - Bot with DM and server support
- 💬 **iMessage** - macOS local integration
- 🤖 **AI Agents** - Supports Claude, GPT, Gemini, and more
- 🔐 **Secure** - Token-based authentication
- 📎 **Media Support** - Images, audio, documents
- 👥 **Group Chats** - Mention-based activation

## Persistent Storage

**Critical**: Railway containers are ephemeral. Use Volumes!

1. Railway Dashboard → Service → Volumes
2. Create Volume → Mount at `/data`
3. All config, sessions, and data persist across redeploys

## Common Tasks

### Version Pinning

This template pins to a specific molt.bot version for reproducible builds:

```dockerfile
ARG MOLTBOT_GIT_REF=v2026.1.24
```

**To update molt.bot:**

1. Check latest releases: https://github.com/moltbot/moltbot/releases
2. Update `MOLTBOT_GIT_REF` in [Dockerfile](Dockerfile)
3. Rebuild and redeploy in Railway

This prevents lockfile drift and ensures consistent builds across deployments.

**Note:** The build still uses `pnpm install --no-frozen-lockfile` because molt.bot's published tags occasionally have lockfile inconsistencies with their package.json. The version pinning provides stability while allowing dependency resolution to succeed.

### Update Molt.bot

```bash
# SSH into container
ssh user@domain -p PORT

# Pull latest (if using git install)
cd /moltbot
git pull
pnpm install
pnpm build
pnpm ui:build

# Restart (or redeploy in Railway)
```

### View Logs

```bash
# In Railway dashboard
Deployments → Active deployment → Logs

# Via SSH
moltbot logs
```

### Pair WhatsApp

```bash
moltbot channels login
# Scan QR code with WhatsApp
```

### Configure Telegram

```bash
moltbot channels add telegram --token YOUR_BOT_TOKEN
```

## Security Best Practices

1. **Change Default Credentials**: Never use `archuser`/`changemelater`
2. **Use SSH Keys**: More secure than passwords
3. **Strong Setup Password**: Protects your `/setup` wizard
4. **Enable Volumes**: Don't lose your data!
5. **Monitor Logs**: Check for suspicious activity
6. **Update Regularly**: Keep Molt.bot and system packages current
7. **Railway Security**: Rely on Railway's platform isolation
   - Only exposed ports (22 via TCP Proxy, 8080 HTTP) are accessible
   - Railway handles network segmentation and DDoS protection
   - Each service runs in isolated containers

## Troubleshooting

### Cannot Access Web UI

- Check service is running in Railway dashboard
- Verify SETUP_PASSWORD is set
- Try accessing `/healthz` endpoint

### Gateway Token Error

This template automatically fixes this! If you still see it:
1. Check `MOLTBOT_GATEWAY_TOKEN` is set properly
2. Delete `/data/.moltbot/moltbot.json` and re-run setup
3. Verify both `gateway.auth.token` and `gateway.remote.token` are identical

### Cannot Connect via SSH

1. Check TCP Proxy is configured (port 22)
2. Verify credentials in environment variables
3. Check service health in Railway
4. Try different network (firewall issue)

### Data Lost After Redeploy

Expected! Use Railway Volumes mounted at `/data`.

## Architecture

```
Client Browser
    ↓
Railway HTTPS (Port 8080)
    ↓
Wrapper Server (Express)
    ↓
Molt.bot Gateway (Loopback :18789)
    ↓
WhatsApp/Telegram/Discord APIs


SSH Client
    ↓
Railway TCP Proxy (Port 22)
    ↓
SSH Server
    ↓
Arch Linux Container
```

## Resources

- [Port Reference Guide](../PORTS.md) - Complete port configuration
- [Remote Gateway Setup](REMOTE_GATEWAY.md) - Enable remote device access
- [Molt.bot Documentation](https://docs.molt.bot/)
- [Railway Documentation](https://docs.railway.com/)
- [Arch Linux Wiki](https://wiki.archlinux.org/)
- [Original Template Issue Fix](https://github.com/greysquirr3l/clawdbot-railway-template)
- [Version Pinning Strategy](VERSION.md)
- [Gateway Token Fix Details](GATEWAY_TOKEN_FIX.md)

## License

MIT License - See LICENSE file

---

**Built with ❤️  for the Railway + Molt.bot community**

*Remember: Use Railway Volumes for persistent data!*
