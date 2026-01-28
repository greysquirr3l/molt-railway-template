#!/bin/bash
set -e

echo "========================================="
echo " Molt.bot + SSH Server Setup"
echo "========================================="
echo ""

# Ensure /data directories exist and have proper ownership
mkdir -p /data/.moltbot /data/workspace
chown -R moltbot:moltbot /data/.moltbot /data/workspace

# Run SSH configuration first (must run as root)
if [ -f "/app/ssh-config.sh" ]; then
    echo "Configuring SSH server..."
    /app/ssh-config.sh &
    SSH_PID=$!
    echo "SSH server started (PID: $SSH_PID)"
else
    echo "Warning: ssh-config.sh not found"
fi

# Give SSH a moment to start
sleep 2

# Start the wrapper server as moltbot user (non-root)
echo ""
echo "Starting Molt.bot wrapper server as moltbot user..."
exec su -s /bin/bash moltbot -c 'exec node /app/src/server.js'
