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
# NOTE: no browser here — on Ubuntu 24.04 `firefox`/`chromium` are snaps whose
# first-boot install hangs indefinitely and blocks provisioning. Install a browser
# into the running VM later (snap works once seeded, or use a Mozilla .deb repo).
apt-get install -y --no-install-recommends \
  xfce4 xfce4-goodies dbus-x11 x11-xserver-utils \
  xrdp \
  openssh-server \
  python3 python3-venv python3-pip python3-dev python3-tk build-essential \
  xvfb scrot gnome-screenshot xdotool wmctrl x11-utils \
  fonts-liberation ca-certificates curl wget git unzip

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
# 4. Headless X display :0 via Xvfb + XFCE, as a systemd service.
#    Agent S / pyautogui drive :0. Xvfb is GPU-independent (no real display
#    hardware / display manager needed), so it always comes up in a VM. XRDP
#    (separate session) remains for human takeover.
# ---------------------------------------------------------------------------
log "install headless desktop service (Xvfb :0 + xfce)"
cat > /opt/agent/start-desktop.sh <<'EOF'
#!/bin/sh
# Empty Xauthority so Xlib clients (pyautogui) don't error on a missing file;
# access is granted via `xhost +local:` below (VM is local-only).
touch "$HOME/.Xauthority" 2>/dev/null || true
rm -f /tmp/.X0-lock 2>/dev/null || true
Xvfb :0 -screen 0 1920x1080x24 -nolisten tcp &
sleep 2
export DISPLAY=:0
xhost +local: 2>/dev/null || true
exec startxfce4
EOF
chmod +x /opt/agent/start-desktop.sh
chown "${AGENT_USER}:${AGENT_USER}" /opt/agent/start-desktop.sh
cat > /etc/systemd/system/cuf-desktop.service <<EOF
[Unit]
Description=CUF headless desktop (Xvfb :0 + xfce)
After=network.target
[Service]
User=${AGENT_USER}
Environment=HOME=${AGENT_HOME}
ExecStart=/opt/agent/start-desktop.sh
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable cuf-desktop.service 2>/dev/null || true

# ---------------------------------------------------------------------------
# 5. Python venv for the Agent S runner + GUI automation libs.
#    The vendored/forked Agent S source and its full requirements are pushed
#    separately by the controller; here we lay down the stable base deps.
# ---------------------------------------------------------------------------
log "create python venv at ${VENV_DIR}"
mkdir -p "$(dirname "${VENV_DIR}")"
python3 -m venv "${VENV_DIR}"
"${VENV_DIR}/bin/pip" install --upgrade pip wheel
# Base runner deps are required. (No pynput — it pulls evdev which needs a C build
# and we drive the GUI via pyautogui, not pynput.)
"${VENV_DIR}/bin/pip" install \
  pyautogui pillow mss \
  "openai>=1.0"          `# OpenRouter is OpenAI-API-compatible: planner client` \
  requests httpx pyyaml
# Agent S is heavier (may pull large ML deps); keep it non-fatal so the golden
# image still provisions if it fails — it can be retried into the venv later.
# --ignore-requires-python: gui-agents pins <=3.12 which excludes 3.12.3 (the noble
# python), but it runs fine there.
"${VENV_DIR}/bin/pip" install --ignore-requires-python "gui-agents==${GUI_AGENTS_VERSION:-0.3.2}" \
  || log "WARN: gui-agents install failed — install it into ${VENV_DIR} later"
# Playwright for browser_task nodes (heavy chromium download; non-fatal).
"${VENV_DIR}/bin/pip" install playwright \
  && "${VENV_DIR}/bin/playwright" install --with-deps chromium \
  || log "WARN: playwright/chromium install failed — browser_task unavailable until installed"
chown -R "${AGENT_USER}:${AGENT_USER}" "$(dirname "${VENV_DIR}")"

# ---------------------------------------------------------------------------
# 6. Enable services.
# ---------------------------------------------------------------------------
log "enable xrdp + ssh (with password auth for controller SSH)"
# Controller drives the guest over SSH with a password; cloud images ship with
# PasswordAuthentication disabled, so turn it on explicitly.
mkdir -p /etc/ssh/sshd_config.d
printf 'PasswordAuthentication yes\nKbdInteractiveAuthentication yes\n' > /etc/ssh/sshd_config.d/10-cuf.conf
# We disable cloud-init (which normally generates SSH host keys on first boot), so
# generate them here or sshd refuses to start and every connection is reset.
ssh-keygen -A 2>/dev/null || true
# Ubuntu 24.04 socket-activates ssh; force a plain always-listening service so the
# controller can connect reliably (socket activation caused kex resets).
systemctl disable --now ssh.socket 2>/dev/null || true
systemctl enable ssh 2>/dev/null || true
systemctl enable xrdp 2>/dev/null || true
systemctl restart ssh 2>/dev/null || true
# XRDP listens on 3389; SSH on 22. Host port-forwards are set by build-golden.sh.

# ---------------------------------------------------------------------------
# 6b. Bring up the desktop so a live X display ':0' exists in the snapshot.
#     Agent S / pyautogui drive :0; without a running X server there is nothing
#     to screenshot. An autostart entry runs `xhost +local:` so the controller's
#     SSH-launched agent (same 'agent' user) can connect to :0 without xauth —
#     safe because the VM is reachable only from the local controller.
# ---------------------------------------------------------------------------
log "start headless desktop service + wait for :0"
systemctl restart cuf-desktop.service 2>/dev/null || systemctl start cuf-desktop.service 2>/dev/null || true
for _ in $(seq 1 45); do [ -e /tmp/.X11-unix/X0 ] && break; sleep 1; done
[ -e /tmp/.X11-unix/X0 ] && log "X display :0 is up" || log "WARN: :0 not up yet"

# ---------------------------------------------------------------------------
# 7. Provenance marker (build-golden.sh polls for this to know provisioning done).
# ---------------------------------------------------------------------------
mkdir -p /opt/agent
date -u +"%Y-%m-%dT%H:%M:%SZ" > /opt/agent/PROVISIONED
echo "user=${AGENT_USER} venv=${VENV_DIR}" >> /opt/agent/PROVISIONED

log "provision complete"
