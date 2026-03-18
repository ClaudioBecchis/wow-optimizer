#!/bin/bash
# Xvfb
cat > /etc/systemd/system/xvfb.service << 'EOF'
[Unit]
Description=Virtual Display
After=network.target
[Service]
ExecStart=/usr/bin/Xvfb :1 -screen 0 1920x1080x24
Restart=always
[Install]
WantedBy=multi-user.target
EOF

# x11vnc
cat > /etc/systemd/system/x11vnc.service << 'EOF'
[Unit]
Description=VNC Server
After=xvfb.service
[Service]
ExecStart=/usr/bin/x11vnc -display :1 -forever -nopw -shared -rfbport 5900
Restart=always
[Install]
WantedBy=multi-user.target
EOF

# noVNC web
cat > /etc/systemd/system/novnc.service << 'EOF'
[Unit]
Description=noVNC Web
After=x11vnc.service
[Service]
ExecStart=/usr/bin/websockify --web /usr/share/novnc 6080 localhost:5900
Restart=always
[Install]
WantedBy=multi-user.target
EOF

# SimC GUI
cat > /etc/systemd/system/simc-gui.service << 'EOF'
[Unit]
Description=SimulationCraft GUI
After=xvfb.service
[Service]
Environment=DISPLAY=:1
Environment=HOME=/root
WorkingDirectory=/opt/simc/build
ExecStart=/opt/simc/build/SimulationCraft
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
EOF

# Cleanup reports older than 30 days
cat > /etc/cron.daily/cleanup-simc-reports << 'EOF'
#!/bin/bash
find /reports -name "*.html" -mtime +30 -delete
find /reports -name "*.json" -mtime +30 -delete
EOF
chmod +x /etc/cron.daily/cleanup-simc-reports

systemctl daemon-reload
systemctl enable xvfb x11vnc novnc simc-gui
systemctl start xvfb
systemctl start x11vnc
systemctl start novnc
systemctl start simc-gui
echo "ALL SERVICES STARTED"
