#!/bin/bash
apt install -y -qq nginx 2>/dev/null

cat > /etc/nginx/sites-available/reports << 'EOF'
server {
    listen 8080;
    root /reports;
    autoindex on;
    location / {
        try_files $uri $uri/ =404;
    }
}
EOF

ln -sf /etc/nginx/sites-available/reports /etc/nginx/sites-enabled/reports
rm -f /etc/nginx/sites-enabled/default
systemctl restart nginx
echo "NGINX REPORTS ON PORT 8080"
