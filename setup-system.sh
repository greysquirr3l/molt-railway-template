#!/bin/bash
set -e

echo "========================================="
echo " Molt.bot + SSH Server Setup"
echo "========================================="
echo ""

# Run SSH configuration first
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

# Start the wrapper server (which manages the moltbot gateway)
echo ""
echo "Starting Molt.bot wrapper server..."
exec node /app/src/server.js
