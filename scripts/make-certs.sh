#!/usr/bin/env bash
set -euo pipefail
mkcert -install
LAN_IP=$(ipconfig getifaddr en0 2>/dev/null || hostname -I | awk '{print $1}')
echo "Generating certs for: localhost 127.0.0.1 $LAN_IP"
mkcert -cert-file certs/lan-cert.pem -key-file certs/lan-key.pem \
  localhost 127.0.0.1 "$LAN_IP"
echo "Done. Certs in ./certs"
echo "Add the LAN IP to your phone's connection: https://$LAN_IP:5173"
