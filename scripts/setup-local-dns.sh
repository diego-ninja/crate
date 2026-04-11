#!/usr/bin/env bash
set -e

# Wildcard DNS for *.crate.local → 127.0.0.1
# Allows admin.crate.local, listen.crate.local, api.crate.local, etc.
LOCAL_TLD="crate.local"

OS="$(uname -s)"

if [ "$OS" = "Darwin" ]; then
    # Install dnsmasq if not present
    if ! command -v dnsmasq &>/dev/null; then
        echo "Installing dnsmasq..."
        brew install dnsmasq
    else
        echo "dnsmasq already installed"
    fi

    DNSMASQ_CONF="$(brew --prefix)/etc/dnsmasq.conf"

    # Add wildcard rule (idempotent)
    if ! grep -q "address=/\.${LOCAL_TLD}/" "$DNSMASQ_CONF" 2>/dev/null; then
        echo "address=/.${LOCAL_TLD}/127.0.0.1" >> "$DNSMASQ_CONF"
        echo "✓ Added *.${LOCAL_TLD} → 127.0.0.1 to dnsmasq.conf"
    else
        echo "✓ *.${LOCAL_TLD} already in dnsmasq.conf"
    fi

    # Configure macOS resolver
    sudo mkdir -p /etc/resolver/
    # Extract the TLD part after the dot for the resolver file
    # e.g., "crate.local" needs a resolver for "local" wouldn't work (conflicts with mDNS)
    # Instead, use the full domain as resolver name
    cat <<EOF | sudo tee /etc/resolver/${LOCAL_TLD}
nameserver 127.0.0.1
EOF
    echo "✓ Created /etc/resolver/${LOCAL_TLD}"

    # Restart services
    sudo brew services restart dnsmasq
    sudo killall -HUP mDNSResponder 2>/dev/null || true
    echo "✓ Restarted dnsmasq + mDNSResponder"

    # Verify
    sleep 1
    echo ""
    echo "Verifying..."
    if ping -c 1 -t 2 test.${LOCAL_TLD} &>/dev/null; then
        echo "✓ test.${LOCAL_TLD} resolves to 127.0.0.1"
    else
        echo "⚠ Verification failed — try: dig test.${LOCAL_TLD} @127.0.0.1"
    fi

    echo ""
    echo "Available domains (HTTPS via Caddy):"
    echo "  https://admin.${LOCAL_TLD}   → Admin UI"
    echo "  https://listen.${LOCAL_TLD}  → Listen UI"
    echo "  https://api.${LOCAL_TLD}     → API"
    echo ""
    echo "To trust Caddy's local CA (run after first 'make dev'):"
    echo "  docker cp crate-dev-caddy:/data/caddy/pki/authorities/local/root.crt /tmp/caddy-root.crt"
    echo "  sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain /tmp/caddy-root.crt"

elif [ "$OS" = "Linux" ]; then
    sudo apt-get install -y dnsmasq

    CONF_FILE="/etc/dnsmasq.d/${LOCAL_TLD}.conf"

    {
        echo "address=/.${LOCAL_TLD}/127.0.0.1"
        echo "resolv-file=/etc/resolv.conf.backup"
    } | sudo tee "$CONF_FILE"
    echo "✓ Created $CONF_FILE"

    # Disable systemd-resolved stub listener
    sudo mkdir -p /etc/systemd/resolved.conf.d/
    cat <<EOF | sudo tee /etc/systemd/resolved.conf.d/dnsmasq.conf
[Resolve]
DNSStubListener=no
EOF
    sudo systemctl restart systemd-resolved

    # Preserve upstream resolvers
    sudo cp /etc/resolv.conf /etc/resolv.conf.backup 2>/dev/null || true
    {
        echo "nameserver 127.0.0.1"
        grep -v '^nameserver 127.0.0.1' /etc/resolv.conf.backup || true
    } | sudo tee /etc/resolv.conf > /dev/null

    sudo systemctl enable dnsmasq
    sudo systemctl restart dnsmasq
    sleep 2

    echo "✓ Verifying..."
    nslookup test.${LOCAL_TLD} 127.0.0.1 || echo "⚠ nslookup not found: sudo apt-get install dnsutils"

    echo ""
    echo "Available domains:"
    echo "  http://admin.${LOCAL_TLD}:5173   → Admin UI"
    echo "  http://listen.${LOCAL_TLD}:5174  → Listen UI"
    echo "  http://api.${LOCAL_TLD}:8585     → API"

else
    echo "❌ Unsupported OS: $OS"
    exit 1
fi
