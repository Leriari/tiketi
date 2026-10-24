#!/usr/bin/env bash
# One-time preparation of a fresh Oracle Cloud Ubuntu server. Run it after
# cloning the (private) repository with a deploy key — see DEPLOY.md step 3:
#
#   bash ~/tiketi/deploy/setup-server.sh
#
# Installs Docker, opens ports 80/443 in the server's own firewall (Oracle's
# Ubuntu images block them even when the cloud security list allows them),
# and adds swap on small machines.
set -euo pipefail

echo "==> Installing Docker"
if ! command -v docker >/dev/null; then
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
fi

echo "==> Opening ports 80 and 443 in the server firewall"
for port in 80 443; do
  if ! sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
    sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport "$port" -j ACCEPT
  fi
done
sudo apt-get install -y -qq iptables-persistent >/dev/null 2>&1 || true
sudo netfilter-persistent save >/dev/null 2>&1 || true

echo "==> Swap (only if the machine has under 4 GB of memory)"
mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
if [ "$mem_kb" -lt 4000000 ] && ! swapon --show | grep -q swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

if [ ! -d "$HOME/tiketi/.git" ]; then
  echo "Clone the repository to ~/tiketi first (DEPLOY.md step 3)." >&2
  exit 1
fi
chmod +x "$HOME/tiketi/deploy/up.sh"

cat <<EOF

Server prepared. Next:
  1. Log out and back in (so Docker works without sudo).
  2. Copy deploy/.env.production from your PC to ~/tiketi/deploy/ (see DEPLOY.md).
  3. cd ~/tiketi/deploy && ./up.sh
EOF
