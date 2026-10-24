#!/usr/bin/env bash
# One-time preparation of a fresh Oracle Cloud server — Ubuntu or Oracle
# Linux (Oracle's default image). Safe to re-run. See DEPLOY.md step 3:
#
#   bash ~/tiketi/deploy/setup-server.sh
#
# Installs git and Docker, opens ports 80/443 in the server's own firewall
# (Oracle's images block them even when the cloud security list allows
# them), and adds swap on small machines.
set -euo pipefail

. /etc/os-release
case " $ID ${ID_LIKE:-} " in
  *" ubuntu "*|*" debian "*) family=debian ;;
  *" ol "*|*" rhel "*|*" fedora "*|*" centos "*) family=rhel ;;
  *) echo "Unsupported OS: $ID" >&2; exit 1 ;;
esac

echo "==> Installing git and Docker ($PRETTY_NAME)"
if [ "$family" = debian ]; then
  command -v git >/dev/null || { sudo apt-get update -qq && sudo apt-get install -y -qq git; }
  command -v docker >/dev/null || curl -fsSL https://get.docker.com | sudo sh
else
  # get.docker.com doesn't support Oracle Linux; Docker's CentOS repo does.
  sudo dnf install -y -q git dnf-plugins-core
  if ! command -v docker >/dev/null; then
    sudo dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
    sudo dnf install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin
  fi
fi
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"

echo "==> Opening ports 80 and 443 in the server firewall"
if [ "$family" = rhel ]; then
  sudo firewall-cmd --permanent --add-service=http --add-service=https >/dev/null
  sudo firewall-cmd --reload >/dev/null
else
  for port in 80 443; do
    if ! sudo iptables -C INPUT -p tcp --dport "$port" -j ACCEPT 2>/dev/null; then
      sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport "$port" -j ACCEPT
    fi
  done
  # noninteractive: the package otherwise opens a "save current rules?" dialog,
  # which would hang invisibly behind the >/dev/null.
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq iptables-persistent >/dev/null 2>&1 || true
  sudo netfilter-persistent save >/dev/null 2>&1 || true
fi

echo "==> Swap (only if the machine has under 4 GB of memory)"
mem_kb=$(awk '/MemTotal/ {print $2}' /proc/meminfo)
if [ "$mem_kb" -lt 4000000 ] && ! swapon --show | grep -q swapfile; then
  sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
  sudo mkswap /swapfile >/dev/null && sudo swapon /swapfile
  echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
fi

if [ -d "$HOME/tiketi/.git" ]; then
  chmod +x "$HOME/tiketi/deploy/up.sh"
  next="Copy deploy/.env.production from your PC to ~/tiketi/deploy/ (see DEPLOY.md)."
else
  next="Clone the repository to ~/tiketi (DEPLOY.md step 3)."
fi

cat <<EOF

Server prepared. Next:
  1. Log out and back in (so Docker works without sudo).
  2. $next
  3. cd ~/tiketi/deploy && ./up.sh
EOF
