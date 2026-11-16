#!/bin/sh
# Turns a fresh Debian 12 (or 13) install into the arcade cabinet's kiosk:
# it boots straight into the arcade, full screen, with nothing else running.
#
#   sudo sh setup.sh https://arcade.example.com
#
# What it does, all of it undoable (see the README):
#   - installs cage (a one-app Wayland compositor), Chromium, PipeWire for
#     sound and triggerhappy for the volume knob
#   - adds a user "arcade" that the kiosk runs as (in dialout, for the controller)
#   - writes Chromium policies: the controller's serial port is allowed for
#     the arcade without asking, sound plays without a click, no first-run,
#     translate or password prompts
#   - adds arcade-kiosk.service, which starts the kiosk on the first screen at boot
#
# Ctrl+Alt+F2 gets you a login prompt on the second screen; Ctrl+Alt+F1 goes back.

set -eu

url="${1:-}"
if [ -z "$url" ]; then
	echo "usage: sudo sh setup.sh https://arcade.example.com" >&2
	exit 64
fi
case "$url" in
http://* | https://*) ;;
*)
	echo "The arcade's address starts with https:// (or http://)." >&2
	exit 64
	;;
esac
url="${url%/}"
origin=$(printf '%s' "$url" | sed -E 's#^(https?://[^/]+).*#\1#')
if [ "$(id -u)" -ne 0 ]; then
	echo "Run it as root (sudo)." >&2
	exit 1
fi

echo "→ packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q --no-install-recommends \
	cage chromium fonts-noto-color-emoji \
	pipewire pipewire-pulse pipewire-alsa wireplumber dbus-user-session \
	triggerhappy ca-certificates

echo "→ the arcade user"
if ! id arcade >/dev/null 2>&1; then
	useradd --create-home --shell /bin/bash --comment "au12 Arcade kiosk" arcade
fi
usermod -aG dialout,video,audio,input,render arcade 2>/dev/null || usermod -aG dialout,video,audio,input arcade
uid=$(id -u arcade)

echo "→ Chromium policies"
mkdir -p /etc/chromium/policies/managed
cat >/etc/chromium/policies/managed/au12-arcade.json <<EOF
{
  "SerialAllowUsbDevicesForUrls": [
    { "devices": [{ "vendor_id": 11914 }], "urls": ["$origin"] }
  ],
  "AutoplayAllowed": true,
  "DefaultNotificationsSetting": 2,
  "DefaultGeolocationSetting": 2,
  "PasswordManagerEnabled": false,
  "TranslateEnabled": false,
  "BrowserSignin": 0,
  "SyncDisabled": true,
  "PromotionsEnabled": false,
  "MetricsReportingEnabled": false,
  "BackgroundModeEnabled": false,
  "HardwareAccelerationModeEnabled": true
}
EOF

echo "→ the browser"
cat >/usr/local/bin/arcade-browser <<EOF
#!/bin/sh
# The arcade, full screen. Started by cage (arcade-kiosk.service).
exec chromium \\
	--kiosk "$url/?kiosk=1" \\
	--ozone-platform=wayland \\
	--noerrdialogs --disable-infobars --no-first-run \\
	--disable-session-crashed-bubble --hide-crash-restore-bubble \\
	--disable-features=Translate,TranslateUI,InfiniteSessionRestore \\
	--overscroll-history-navigation=0 --disable-pinch \\
	--autoplay-policy=no-user-gesture-required \\
	--check-for-update-interval=31536000 \\
	--password-store=basic
EOF
chmod 755 /usr/local/bin/arcade-browser

echo "→ the volume knob"
cat >/usr/local/bin/arcade-volume <<EOF
#!/bin/sh
# The controller's knob sends the volume keys; this turns them into PipeWire's volume.
export XDG_RUNTIME_DIR=/run/user/$uid
case "\$1" in
up) exec runuser -u arcade -- wpctl set-volume -l 1.0 @DEFAULT_AUDIO_SINK@ 4%+ ;;
down) exec runuser -u arcade -- wpctl set-volume @DEFAULT_AUDIO_SINK@ 4%- ;;
mute) exec runuser -u arcade -- wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle ;;
esac
EOF
chmod 755 /usr/local/bin/arcade-volume
mkdir -p /etc/triggerhappy/triggers.d
cat >/etc/triggerhappy/triggers.d/au12-arcade.conf <<'EOF'
KEY_VOLUMEUP 1 /usr/local/bin/arcade-volume up
KEY_VOLUMEUP 2 /usr/local/bin/arcade-volume up
KEY_VOLUMEDOWN 1 /usr/local/bin/arcade-volume down
KEY_VOLUMEDOWN 2 /usr/local/bin/arcade-volume down
KEY_MUTE 1 /usr/local/bin/arcade-volume mute
EOF
# triggerhappy runs as nobody by default; the volume needs root to switch to the arcade user.
mkdir -p /etc/systemd/system/triggerhappy.service.d
cat >/etc/systemd/system/triggerhappy.service.d/au12-arcade.conf <<'EOF'
[Service]
ExecStart=
ExecStart=/usr/sbin/thd --triggers /etc/triggerhappy/triggers.d/ --socket /run/thd.socket --user root --deviceglob /dev/input/event*
EOF

echo "→ the kiosk service"
cat >/etc/pam.d/arcade-kiosk <<'EOF'
auth     required pam_unix.so nullok
account  required pam_unix.so
session  required pam_unix.so
session  required pam_systemd.so
EOF
cat >/etc/systemd/system/arcade-kiosk.service <<'EOF'
[Unit]
Description=au12 Arcade kiosk
After=systemd-user-sessions.service plymouth-quit-wait.service network-online.target
Wants=network-online.target dbus.socket systemd-logind.service
After=dbus.socket systemd-logind.service
Conflicts=getty@tty1.service
After=getty@tty1.service

[Service]
Type=simple
User=arcade
PAMName=arcade-kiosk
TTYPath=/dev/tty1
TTYReset=yes
TTYVHangup=yes
TTYVTDisallocate=yes
StandardInput=tty-fail
StandardOutput=journal
StandardError=journal
UtmpIdentifier=tty1
UtmpMode=user
ExecStart=/usr/bin/cage -d -s -- /usr/local/bin/arcade-browser
Restart=always
RestartSec=3

[Install]
WantedBy=graphical.target
EOF

# Sound for the arcade user's session, without anyone logging in.
loginctl enable-linger arcade
runuser -u arcade -- env XDG_RUNTIME_DIR="/run/user/$uid" systemctl --user enable pipewire pipewire-pulse wireplumber >/dev/null 2>&1 || true

systemctl daemon-reload
systemctl disable getty@tty1.service >/dev/null 2>&1 || true
systemctl enable triggerhappy.service arcade-kiosk.service
systemctl set-default graphical.target >/dev/null

echo
echo "Done. Reboot, and the arcade comes up on its own: $url/?kiosk=1"
echo "The controller's serial port is allowed for $origin without asking."
