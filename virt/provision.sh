#!/usr/bin/env bash
#
# provision.sh — runs INSIDE the guest image (offline via `virt-customize --run`,
# or on first boot). Turns a base Ubuntu cloud image into a computer-use worker:
# XFCE desktop, XRDP, SSH, and a Python venv with the deps Agent S needs to drive
# the GUI (pyautogui + screenshot/keyboard tooling).
#
# Configurable via env (all optional):
#   AGENT_USER      desktop + xrdp + ssh login user           (default: agent)
#   AGENT_PASSWORD  password for that user                    (default: changeme — OVERRIDE)
#   AGENT_HOME      home dir for AGENT_USER                   (default: /home/$AGENT_USER)
#   VENV_DIR        python venv for the agent runner          (default: /opt/agent/venv)
#
# NOTE: AGENT_PASSWORD is a real credential (used for XRDP + SSH login). Pass it in;
# the default is intentionally weak so an unconfigured image is never mistaken for safe.

set -euo pipefail

AGENT_USER="${AGENT_USER:-agent}"
AGENT_PASSWORD="${AGENT_PASSWORD:-changeme}"
AGENT_HOME="${AGENT_HOME:-/home/${AGENT_USER}}"
VENV_DIR="${VENV_DIR:-/opt/agent/venv}"

export DEBIAN_FRONTEND=noninteractive

log() { echo "[provision] $*"; }

# ---------------------------------------------------------------------------
# 1. Base packages: lightweight desktop, remote access, GUI-automation tooling.
# ---------------------------------------------------------------------------
log "apt update + install desktop/remote/automation stack"
apt-get update -y
apt-get install -y --no-install-recommends \
  xfce4 xfce4-goodies dbus-x11 x11-xserver-utils \
  xrdp \
  openssh-server \
  python3 python3-venv python3-pip python3-dev python3-tk \
  scrot gnome-screenshot xdotool wmctrl x11-utils \
  fonts-liberation ca-certificates curl wget git unzip \
  firefox-esr || apt-get install -y --no-install-recommends firefox

# ---------------------------------------------------------------------------
# 2. Agent user with a desktop + remote login.
# ---------------------------------------------------------------------------
if ! id "${AGENT_USER}" >/dev/null 2>&1; then
  log "create user ${AGENT_USER}"
  useradd --create-home --shell /bin/bash "${AGENT_USER}"
fi
echo "${AGENT_USER}:${AGENT_PASSWORD}" | chpasswd
# XRDP needs the user in ssl-cert to read the TLS key.
usermod -aG ssl-cert "${AGENT_USER}" || true

# ---------------------------------------------------------------------------
# 3. XRDP -> XFCE session for this user.
# ---------------------------------------------------------------------------
log "configure xrdp -> xfce session"
echo "xfce4-session" > "${AGENT_HOME}/.xsession"
chown "${AGENT_USER}:${AGENT_USER}" "${AGENT_HOME}/.xsession"
# Global fallback so any xrdp login lands in xfce.
cat > /etc/xrdp/startwm.sh <<'EOF'
#!/bin/sh
if test -r /etc/profile; then . /etc/profile; fi
export DESKTOP_SESSION=xfce
exec startxfce4
EOF
chmod +x /etc/xrdp/startwm.sh
adduser xrdp ssl-cert || true

# ---------------------------------------------------------------------------
# 4. Auto-login on the local console so a display exists WITHOUT an XRDP client.
#    Agent S drives the local X display via pyautogui; XRDP is for human takeover.
#    lightdm autologin keeps a real session (and :0 display) alive after boot.
# ---------------------------------------------------------------------------
log "enable lightdm autologin"
apt-get install -y --no-install-recommends lightdm
mkdir -p /etc/lightdm/lightdm.conf.d
cat > /etc/lightdm/lightdm.conf.d/50-autologin.conf <<EOF
[Seat:*]
autologin-user=${AGENT_USER}
autologin-user-timeout=0
user-session=xfce
EOF
# Autologin needs the user in the nopasswdlogin/autologin groups on some builds.
groupadd -f autologin
usermod -aG autologin "${AGENT_USER}" || true

# ---------------------------------------------------------------------------
# 5. Python venv for the Agent S runner + GUI automation libs.
#    The vendored/forked Agent S source and its full requirements are pushed
#    separately by the controller; here we lay down the stable base deps.
# ---------------------------------------------------------------------------
log "create python venv at ${VENV_DIR}"
mkdir -p "$(dirname "${VENV_DIR}")"
python3 -m venv "${VENV_DIR}"
"${VENV_DIR}/bin/pip" install --upgrade pip wheel
"${VENV_DIR}/bin/pip" install \
  pyautogui pillow mss pynput \
  "openai>=1.0"          `# OpenRouter is OpenAI-API-compatible: planner client` \
  requests httpx pyyaml \
  "gui-agents==${GUI_AGENTS_VERSION:-0.3.2}"   `# Agent S / AgentS3 (pinned; fork overlay applied separately)`
chown -R "${AGENT_USER}:${AGENT_USER}" "$(dirname "${VENV_DIR}")"

# ---------------------------------------------------------------------------
# 6. Enable services.
# ---------------------------------------------------------------------------
log "enable xrdp + ssh"
systemctl enable xrdp ssh || true
# XRDP listens on 3389; SSH on 22. Host port-forwards are set by build-golden.sh.

# ---------------------------------------------------------------------------
# 7. Provenance marker (build-golden.sh polls for this to know provisioning done).
# ---------------------------------------------------------------------------
mkdir -p /opt/agent
date -u +"%Y-%m-%dT%H:%M:%SZ" > /opt/agent/PROVISIONED
echo "user=${AGENT_USER} venv=${VENV_DIR}" >> /opt/agent/PROVISIONED

log "provision complete"
