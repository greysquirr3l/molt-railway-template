# Hardened Arch Linux + Molt.bot (moltbot/clawdbot) for Railway
# Combines SSH access with AI agent messaging gateway

# Build moltbot from source
FROM archlinux:latest AS moltbot-build

# Install build dependencies
RUN pacman -Syu --noconfirm && \
    pacman -S --noconfirm \
    base-devel \
    git \
    nodejs \
    npm \
    python \
    ca-certificates && \
    pacman -Scc --noconfirm

# Install pnpm
RUN npm install -g pnpm@latest

WORKDIR /moltbot

# Clone moltbot (formerly clawdbot)
# Pin to a known-good version to ensure reproducible builds
# Update this version tag when you want to upgrade molt.bot
# Check releases at: https://github.com/moltbot/moltbot/releases
ARG MOLTBOT_GIT_REF=v2026.1.24
RUN git clone --depth 1 --branch "${MOLTBOT_GIT_REF}" https://github.com/moltbot/moltbot.git . || \
    git clone --depth 1 https://github.com/moltbot/moltbot.git .

# Patch: relax version requirements for packages that may reference unpublished versions
# This allows building even if internal package.json deps reference newer versions
RUN set -eux; \
  for f in \
    ./extensions/memory-core/package.json \
    ./extensions/googlechat/package.json \
  ; do \
    if [ -f "$f" ]; then \
      sed -i -E 's/"moltbot"[[:space:]]*:[[:space:]]*">=[^"]+"/"moltbot": "*"/g' "$f"; \
    fi; \
  done

# Build moltbot
# Use --no-frozen-lockfile since molt.bot's published tags may have lockfile drift
RUN pnpm install --no-frozen-lockfile && \
    pnpm build && \
    pnpm ui:install && \
    pnpm ui:build

# Runtime image
FROM archlinux:latest

# Set environment to non-interactive
ENV NODE_ENV=production

# Install runtime dependencies
RUN pacman -Syu --noconfirm && \
    pacman -S --noconfirm \
    openssh \
    sudo \
    fail2ban \
    nodejs \
    npm \
    iproute2 \
    iputils \
    net-tools \
    bind-tools \
    curl \
    wget \
    vim \
    htop \
    tmux \
    git \
    base-devel \
    ca-certificates && \
    pacman -Scc --noconfirm

# Install pnpm globally
RUN npm install -g pnpm@latest

# Create SSHD directory and set permissions
RUN mkdir -p /run/sshd && \
    chmod 755 /run/sshd

# Configure hardened SSH settings
RUN echo "# Hardened SSH Configuration for Railway" > /etc/ssh/sshd_config && \
    echo "Port 22" >> /etc/ssh/sshd_config && \
    echo "Protocol 2" >> /etc/ssh/sshd_config && \
    echo "HostKey /etc/ssh/ssh_host_rsa_key" >> /etc/ssh/sshd_config && \
    echo "HostKey /etc/ssh/ssh_host_ecdsa_key" >> /etc/ssh/sshd_config && \
    echo "HostKey /etc/ssh/ssh_host_ed25519_key" >> /etc/ssh/sshd_config && \
    echo "" >> /etc/ssh/sshd_config && \
    echo "# Logging" >> /etc/ssh/sshd_config && \
    echo "SyslogFacility AUTH" >> /etc/ssh/sshd_config && \
    echo "LogLevel INFO" >> /etc/ssh/sshd_config && \
    echo "" >> /etc/ssh/sshd_config && \
    echo "# Authentication" >> /etc/ssh/sshd_config && \
    echo "PermitRootLogin no" >> /etc/ssh/sshd_config && \
    echo "MaxAuthTries 3" >> /etc/ssh/sshd_config && \
    echo "MaxSessions 10" >> /etc/ssh/sshd_config && \
    echo "PubkeyAuthentication yes" >> /etc/ssh/sshd_config && \
    echo "PasswordAuthentication yes" >> /etc/ssh/sshd_config && \
    echo "PermitEmptyPasswords no" >> /etc/ssh/sshd_config && \
    echo "ChallengeResponseAuthentication no" >> /etc/ssh/sshd_config && \
    echo "" >> /etc/ssh/sshd_config && \
    echo "# Connection settings" >> /etc/ssh/sshd_config && \
    echo "ClientAliveInterval 300" >> /etc/ssh/sshd_config && \
    echo "ClientAliveCountMax 2" >> /etc/ssh/sshd_config && \
    echo "TCPKeepAlive yes" >> /etc/ssh/sshd_config && \
    echo "UseDNS no" >> /etc/ssh/sshd_config && \
    echo "" >> /etc/ssh/sshd_config && \
    echo "# Security hardening" >> /etc/ssh/sshd_config && \
    echo "StrictModes yes" >> /etc/ssh/sshd_config && \
    echo "Ciphers chacha20-poly1305@openssh.com,aes256-gcm@openssh.com,aes128-gcm@openssh.com,aes256-ctr,aes192-ctr,aes128-ctr" >> /etc/ssh/sshd_config && \
    echo "MACs hmac-sha2-512-etm@openssh.com,hmac-sha2-256-etm@openssh.com,hmac-sha2-512,hmac-sha2-256" >> /etc/ssh/sshd_config && \
    echo "KexAlgorithms curve25519-sha256,curve25519-sha256@libssh.org,diffie-hellman-group16-sha512,diffie-hellman-group18-sha512" >> /etc/ssh/sshd_config

# Generate SSH host keys
RUN ssh-keygen -A

# Configure sudoers for wheel group
RUN echo "%wheel ALL=(ALL:ALL) ALL" >> /etc/sudoers

# Copy built moltbot
WORKDIR /app
COPY --from=moltbot-build /moltbot /moltbot

# Create moltbot executable wrapper
RUN printf '%s\n' '#!/usr/bin/env bash' 'exec node /moltbot/dist/entry.js "$@"' > /usr/local/bin/moltbot && \
    chmod +x /usr/local/bin/moltbot

# Install wrapper server dependencies
COPY wrapper/package.json ./
RUN npm install --omit=dev && npm cache clean --force

# Copy wrapper server and scripts
COPY wrapper/src ./src
COPY setup-system.sh ssh-config.sh ./
RUN chmod +x setup-system.sh ssh-config.sh

# Set up directories
RUN mkdir -p /data/.moltbot /data/workspace

# Environment variables for moltbot
ENV MOLTBOT_STATE_DIR=/data/.moltbot
ENV MOLTBOT_WORKSPACE_DIR=/data/workspace
ENV PORT=8080

# Expose ports
# Expose SSH and HTTP ports
EXPOSE 22 8080

# Start services
CMD ["/app/setup-system.sh"]
