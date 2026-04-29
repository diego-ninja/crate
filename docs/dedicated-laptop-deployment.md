# Dedicated Laptop Deployment Guide

This guide is for the practical case discussed in this repo: you have an old
but perfectly capable laptop, you want to dedicate it to Crate, and you want
to finish with a working self-hosted instance exposed on the public internet.

It intentionally uses:

- a normal bare-metal Linux install on the laptop
- Docker Compose for the Crate stack itself
- the home-oriented compose file at `docker-compose.home.yaml`
- Traefik for reverse proxy + TLS
- Cloudflare for DNS and certificate DNS challenge
- a Cloudflare DDNS updater for home connections with dynamic public IPs

That is the shortest path from "dusty laptop" to "Crate is serving traffic"
with the codebase as it exists today.

It is not a full "no-Docker" guide. Crate can be run fully outside Docker, but
the repository is currently most production-ready in its Compose topology, so
this document optimizes for success first.

If you are coming from Ubuntu Server, the practical differences here are
small. The important changes are mostly the installer base, Docker's Debian
repository setup, and the fact that Debian does not lean on Netplan in the
same way Ubuntu often does.

## Outcome

When you finish, you will have:

- Debian stable installed from the official netinst image on the laptop
- Docker Engine + Compose v2 installed
- Crate running on the laptop
- Traefik terminating HTTPS
- Cloudflare DNS records pointing at your house
- automatic Cloudflare DNS updates when your ISP changes your IP
- the music library mounted from an external USB3 SSD

Public URLs will look like:

- `https://admin.example.com`
- `https://listen.example.com`
- `https://api.example.com`
- `https://traefik.example.com`

## Recommended Topology

Use the laptop like this:

- internal laptop disk: OS + Docker + repo checkout + mutable app data
- external USB3 SSD: music library and download staging
- router: port forward `80/tcp` and `443/tcp` to the laptop
- Cloudflare: DNS + proxy + ACME DNS challenge + dynamic DNS updates

Recommended host paths:

- repo checkout: `/opt/crate`
- internal app data: `/srv/crate-data`
- external media SSD mountpoint: `/srv/crate-media`
- music library: `/srv/crate-media/music`
- downloads/import staging: `/srv/crate-media/downloads`

## Before You Start

You need:

- a domain already managed by Cloudflare
- admin access to your router
- a public IPv4 on your home connection, or at least a forwardable public IP
- Debian stable netinst installer USB
- the external SSD connected over USB3

### Important: dynamic IP is fine, CGNAT is not

Dynamic IP by itself is not a problem. This guide solves it with Cloudflare
DNS updates.

CGNAT is different. If your ISP puts you behind CGNAT, normal port forwarding
will not work.

Check that first:

1. look at the WAN IP shown in your router
2. compare it to `curl https://api.ipify.org`
3. if the router shows a private or CGNAT address but `ipify` shows a
   different public one, you are behind an upstream NAT

If your router WAN IP is in ranges like these, direct inbound hosting will not
work:

- `100.64.0.0/10`
- `10.0.0.0/8`
- `172.16.0.0/12`
- `192.168.0.0/16`

If you are behind CGNAT, stop here and either:

- ask your ISP for a public IPv4
- use a tunnel/VPN-based publishing approach instead

## 1. Install Debian Netinst

Install a minimal Debian stable system on the laptop using the official
netinst image.

Recommended choices:

- hostname: `crate`
- install `OpenSSH server`
- no desktop environment
- use the internal laptop disk only for the OS

After first boot:

```bash
sudo apt update
sudo apt full-upgrade -y
sudo apt install -y sudo curl git jq ca-certificates gnupg lsb-release \
  smartmontools htop tmux
sudo reboot
```

If you want to manage it headlessly, from now on do the rest over SSH.

## 2. Give the Laptop a Stable LAN Address

Do this before exposing anything publicly.

Recommended:

- reserve a DHCP lease in the router, for example `192.168.1.50`

You can use a static IP on Debian too, but a router DHCP reservation is
usually simpler.

You want the laptop to keep the same LAN address because your router will
forward ports `80` and `443` to it.

## 3. Prepare the External SSD

For Crate, a USB3 SSD is a good option for the music library.

Recommended rules:

- use `ext4`
- mount by `UUID`
- do not use `NTFS` or `exFAT` for the main library
- keep the OS and Docker runtime on the internal disk
- keep the music and downloads on the external SSD

### 3.1 Identify the disk

```bash
lsblk -f
```

Assume the SSD partition is `/dev/sdb1`.

### 3.2 Format it as ext4 if needed

Warning: this destroys existing data on that partition.

```bash
sudo mkfs.ext4 -L crate-media /dev/sdb1
```

### 3.3 Create the mountpoint and mount it

```bash
sudo mkdir -p /srv/crate-media
sudo blkid /dev/sdb1
```

Add the UUID to `/etc/fstab`:

```fstab
UUID=YOUR-SSD-UUID  /srv/crate-media  ext4  defaults,nofail,x-systemd.device-timeout=30  0  2
```

Then mount it:

```bash
sudo mount -a
df -h /srv/crate-media
```

### 3.4 Create the expected directory layout

```bash
sudo mkdir -p /srv/crate-media/music
sudo mkdir -p /srv/crate-media/downloads/tidal/incomplete
sudo mkdir -p /srv/crate-media/downloads/tidal/albums
sudo mkdir -p /srv/crate-media/downloads/tidal/tracks
sudo mkdir -p /srv/crate-media/downloads/tidal/playlists
sudo mkdir -p /srv/crate-media/downloads/tidal/videos
sudo mkdir -p /srv/crate-media/downloads/soulseek/incomplete
sudo chown -R "$USER":"$USER" /srv/crate-media
```

Put your actual music library under:

```text
/srv/crate-media/music
```

## 4. Install Docker Engine and Compose

This section follows Docker's official `apt` repository flow for Debian.

Remove conflicting distro packages if present:

```bash
sudo apt remove -y docker.io docker-compose docker-compose-v2 docker-doc \
  podman-docker containerd runc
```

Add Docker's repository:

```bash
sudo apt update
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources > /dev/null <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
```

Install Docker Engine and Compose v2:

```bash
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

If you later add `ufw` or another host firewall, remember that published
Docker ports bypass normal firewall rules. For this setup that is fine because
you intentionally publish only `80` and `443`, but it is worth knowing up
front.

Enable Docker at boot and allow your user to run it:

```bash
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
newgrp docker
docker version
docker compose version
```

## 5. Clone the Repo

```bash
sudo mkdir -p /opt
sudo chown "$USER":"$USER" /opt
cd /opt
git clone https://github.com/diego-ninja/crate.git
cd /opt/crate
cp .env.example .env
```

This guide assumes the checkout lives at:

```text
/opt/crate
```

## 6. Edit `.env`

Open `/opt/crate/.env` and make it look like this:

```dotenv
TZ=Europe/Madrid
PUID=1000
PGID=1000
DOMAIN=example.com
LANGUAGE=es

DATA_DIR=/srv/crate-data
MEDIA_DIR=/srv/crate-media

TRAEFIK_HTTP_PORT=80
TRAEFIK_HTTPS_PORT=443
CRATE_API_PORT=8585
CRATE_UI_PORT=8580

CF_DNS_API_TOKEN=replace-with-your-traefik-cloudflare-token

POSTGRES_SUPERUSER_USER=crate
POSTGRES_SUPERUSER_PASSWORD=replace-with-a-strong-password
POSTGRES_SUPERUSER_DB=crate

CRATE_POSTGRES_USER=crate
CRATE_POSTGRES_PASSWORD=replace-with-a-strong-password
CRATE_POSTGRES_DB=crate

JWT_SECRET=replace-with-a-long-random-secret
DEFAULT_ADMIN_PASSWORD=replace-with-a-strong-password

LASTFM_APIKEY=
LASTFM_API_SECRET=
FANART_API_KEY=
SPOTIFY_ID=
SPOTIFY_SECRET=
SETLISTFM_API_KEY=
DISCOGS_CONSUMER_KEY=
DISCOGS_CONSUMER_SECRET=
TICKETMASTER_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
SLSKD_API_KEY=
```

Get your actual UID/GID before finalizing `PUID` and `PGID`:

```bash
id -u
id -g
```

On many single-user Debian installs both values will be `1000`, but do not
assume it blindly.

Generate a proper JWT secret if you need one:

```bash
openssl rand -hex 32
```

Notes:

- `DATA_DIR` stays on the internal disk for PostgreSQL, Redis, Traefik, and
  Crate state.
- `MEDIA_DIR` points at the external SSD.
- this guide starts from `docker-compose.home.yaml`, not the larger production
  compose
- if you are not configuring OAuth, Tidal, Soulseek, Discogs, Spotify, or
  Ticketmaster on day one, leave them empty

Create the internal data directories before you continue:

```bash
sudo mkdir -p /srv/crate-data/traefik/conf
sudo mkdir -p /srv/crate-data/traefik/logs
sudo mkdir -p /srv/crate-data/librarian
sudo mkdir -p /srv/crate-data/postgres
sudo mkdir -p /srv/crate-data/redis
sudo chown -R "$USER":"$USER" /srv/crate-data
```

## 7. Use the Home Compose File

This repo now includes a dedicated home deployment compose file:

```text
/opt/crate/docker-compose.home.yaml
```

It deliberately keeps only the core stack:

- `traefik`
- `crate-postgres`
- `crate-redis`
- `crate-api`
- `crate-worker`
- `crate-ui`
- `crate-listen`

What it changes compared to the main production compose:

- no `proton-vpn` dependency for the worker
- no `tidarr`, `slskd`, or extra public services on day one
- PostgreSQL and Redis persist into bind mounts under `DATA_DIR`
- the Docker network is created automatically by Compose

That makes the first install much less fragile on a home machine.

## 8. Replace the Traefik Static Config

The repo currently contains a Traefik config with hardcoded values from the
project's existing environment. Replace it with a clean instance-local config.

Overwrite `/srv/crate-data/traefik/traefik.yml` with:

```yaml
global:
  checkNewVersion: true
  sendAnonymousUsage: false

log:
  level: INFO
  filePath: "/var/log/traefik/traefik.log"

accessLog:
  filePath: "/var/log/traefik/access.log"
  bufferingSize: 100

api:
  dashboard: true

entryPoints:
  web:
    address: ":80"
    http:
      redirections:
        entryPoint:
          to: websecure
          scheme: https
          permanent: true

  websecure:
    address: ":443"

providers:
  docker:
    endpoint: "unix:///var/run/docker.sock"
    network: crate
    exposedByDefault: false

  file:
    directory: /conf
    watch: true

certificatesResolvers:
  letsencrypt:
    acme:
      email: you@example.com
      storage: /acme.json
      keyType: EC384
      dnsChallenge:
        provider: cloudflare
        resolvers:
          - "1.1.1.1:53"
          - "1.0.0.1:53"

tls:
  options:
    default:
      minVersion: VersionTLS12
```

Also make sure the ACME storage file exists with the right permissions:

```bash
mkdir -p /srv/crate-data/traefik/logs
mkdir -p /srv/crate-data/traefik/conf
touch /srv/crate-data/traefik/acme.json
chmod 600 /srv/crate-data/traefik/acme.json
```

You can keep `data/traefik/conf/dynamic.yml` as a minimal placeholder:

```yaml
http:
  middlewares: {}
```

## 9. Prepare Cloudflare

### 9.1 Create a token for Traefik DNS challenge

Traefik's ACME DNS challenge for Cloudflare is implemented through `lego`.
For the token-based Cloudflare flow, the relevant documented permissions are:

- `Zone / Zone / Read`
- `Zone / DNS / Edit`

In practice:

1. go to Cloudflare API Tokens
2. create a token scoped to your zone only
3. grant:
   - `Zone / Zone / Read`
   - `Zone / DNS / Edit`
4. put that token in `.env` as `CF_DNS_API_TOKEN`

You can reuse this same token for DDNS if you want, though separate tokens are
cleaner.

### 9.2 Create the public DNS records

Create these records in Cloudflare for your actual domain:

- `admin.example.com`
- `listen.example.com`
- `api.example.com`
- `traefik.example.com`

For a first pass, make them:

- type: `A`
- content: your current public IPv4
- proxied: `on`

If you want other surfaces later, add them separately.

### 9.3 Set Cloudflare SSL mode

In the Cloudflare dashboard, set SSL/TLS mode to:

- `Full (strict)`

That way Cloudflare talks HTTPS to Traefik using the Let's Encrypt certs issued
at the origin.

## 10. Configure Router Port Forwarding

Forward these ports from the router to the laptop's stable LAN IP:

- `80/tcp`
- `443/tcp`

Optional later, if you want better Soulseek connectivity:

- the `SLSKD_LISTEN_PORT` you choose for Soulseek

Do not expose the admin/API ports directly. Only forward `80` and `443` to
Traefik.

## 11. Add Cloudflare DDNS for Dynamic Home IP

This step keeps your Cloudflare DNS records synced when your ISP changes your
public IPv4.

### 11.1 Create a Cloudflare token for DDNS

Simplest option:

- create a second token scoped to the same zone
- grant:
  - `Zone / Zone / Read`
  - `Zone / DNS / Edit`

You may reuse the Traefik token if you prefer operational simplicity over
strict separation.

### 11.2 Create the DDNS environment file

Create `/etc/default/cloudflare-ddns`:

```bash
sudo tee /etc/default/cloudflare-ddns > /dev/null <<'EOF'
CF_API_TOKEN=replace-with-your-ddns-token
CF_ZONE_NAME=example.com
CF_RECORDS="admin.example.com listen.example.com api.example.com traefik.example.com"
EOF
sudo chmod 600 /etc/default/cloudflare-ddns
```

### 11.3 Install the DDNS updater script

Create `/usr/local/bin/cloudflare-ddns.sh`:

```bash
sudo tee /usr/local/bin/cloudflare-ddns.sh > /dev/null <<'EOF'
#!/usr/bin/env bash
set -euo pipefail

: "${CF_API_TOKEN:?CF_API_TOKEN is required}"
: "${CF_ZONE_NAME:?CF_ZONE_NAME is required}"
: "${CF_RECORDS:?CF_RECORDS is required}"

cf_api() {
  curl -fsS \
    -H "Authorization: Bearer ${CF_API_TOKEN}" \
    -H "Content-Type: application/json" \
    "$@"
}

PUBLIC_IP="$(curl -fsS https://api.ipify.org)"
if [[ -z "${PUBLIC_IP}" ]]; then
  echo "Could not detect public IP" >&2
  exit 1
fi

ZONE_JSON="$(cf_api "https://api.cloudflare.com/client/v4/zones?name=${CF_ZONE_NAME}&status=active")"
ZONE_ID="$(jq -r '.result[0].id // empty' <<<"${ZONE_JSON}")"
if [[ -z "${ZONE_ID}" ]]; then
  echo "Could not resolve Cloudflare zone id for ${CF_ZONE_NAME}" >&2
  exit 1
fi

for RECORD_NAME in ${CF_RECORDS}; do
  RECORD_JSON="$(cf_api "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records?type=A&name=${RECORD_NAME}")"
  RECORD_ID="$(jq -r '.result[0].id // empty' <<<"${RECORD_JSON}")"
  CURRENT_IP="$(jq -r '.result[0].content // empty' <<<"${RECORD_JSON}")"
  PROXIED="$(jq -r '.result[0].proxied // false' <<<"${RECORD_JSON}")"

  if [[ -z "${RECORD_ID}" ]]; then
    echo "Missing DNS record: ${RECORD_NAME}" >&2
    exit 1
  fi

  if [[ "${CURRENT_IP}" == "${PUBLIC_IP}" ]]; then
    echo "${RECORD_NAME} already points to ${PUBLIC_IP}"
    continue
  fi

  PAYLOAD="$(jq -cn \
    --arg type "A" \
    --arg name "${RECORD_NAME}" \
    --arg content "${PUBLIC_IP}" \
    --argjson proxied "${PROXIED}" \
    '{type:$type,name:$name,content:$content,ttl:1,proxied:$proxied}')"

  cf_api -X PATCH \
    --data "${PAYLOAD}" \
    "https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/dns_records/${RECORD_ID}" \
    >/dev/null

  echo "Updated ${RECORD_NAME} -> ${PUBLIC_IP}"
done
EOF

sudo chmod +x /usr/local/bin/cloudflare-ddns.sh
```

### 11.4 Test the updater manually

```bash
set -a
source /etc/default/cloudflare-ddns
set +a
/usr/local/bin/cloudflare-ddns.sh
```

### 11.5 Install a systemd service and timer

Create `/etc/systemd/system/cloudflare-ddns.service`:

```ini
[Unit]
Description=Update Cloudflare DNS records with current public IP
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
EnvironmentFile=/etc/default/cloudflare-ddns
ExecStart=/usr/local/bin/cloudflare-ddns.sh
```

Create `/etc/systemd/system/cloudflare-ddns.timer`:

```ini
[Unit]
Description=Run Cloudflare DDNS updater every 5 minutes

[Timer]
OnBootSec=1min
OnUnitActiveSec=5min
Unit=cloudflare-ddns.service

[Install]
WantedBy=timers.target
```

Enable it:

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now cloudflare-ddns.timer
systemctl list-timers cloudflare-ddns.timer
```

## 12. Start Crate

From the repo root:

```bash
cd /opt/crate
docker compose -f docker-compose.home.yaml up -d --build
```

Watch startup:

```bash
docker compose -f docker-compose.home.yaml ps
docker compose -f docker-compose.home.yaml logs -f traefik crate-api crate-worker
```

The first startup can take a while because images are built and Python
dependencies are installed.

## 13. First Validation

### 13.1 Check local health first

```bash
curl -I http://127.0.0.1:8585/api/status
```

You should get a healthy response from the API.

### 13.2 Check Traefik

Open:

- `https://traefik.example.com`

### 13.3 Check Crate apps

Open:

- `https://admin.example.com`
- `https://listen.example.com`

### 13.4 Log in

Use the admin password you set in `.env`:

- email: `admin@cratemusic.app`
- password: your `DEFAULT_ADMIN_PASSWORD`

If the default bootstrap user flow changes later, the admin setup wizard will
guide you through it.

## 14. Add Your Music and Scan

Your library should live under:

```text
/srv/crate-media/music
```

Once Crate is up:

1. log into the admin app
2. trigger a library scan
3. let the worker build metadata, enrichment, analysis, and read models

Because the worker mounts `/music` read-write, it can handle tags, imports,
artwork writes, and normalization tasks as intended.

## 15. Make Reboots Boring

The compose services already use restart policies. After a normal reboot:

- Debian comes up
- Docker starts
- the Crate containers come back
- the Cloudflare DDNS timer refreshes your records
- Traefik serves HTTPS again

Still, you should test it once:

```bash
sudo reboot
```

After reconnecting:

```bash
docker compose -f docker-compose.home.yaml ps
systemctl status cloudflare-ddns.timer
```

## 16. Backups and Maintenance

Minimum sensible backup plan:

- back up `/opt/crate/.env`
- back up `/srv/crate-data/traefik/acme.json`
- back up `/srv/crate-data/postgres`
- back up `/srv/crate-data/redis`
- back up `/srv/crate-data/librarian`
- back up the external SSD separately

Useful recurring checks:

```bash
docker compose -f docker-compose.home.yaml ps
docker compose -f docker-compose.home.yaml logs --tail=200 crate-api crate-worker
df -h
sudo smartctl -a /dev/sdb
```

Also keep an eye on:

- free space on the external SSD
- USB cable stability
- SSD SMART health
- whether the router kept the same DHCP reservation

## 17. Known Caveats

### Docker is still in the loop

This is a bare-metal host running the current Docker-native Crate stack. That
is deliberate.

### The admin Stack page assumes Docker

That is fine in this setup because Docker remains the service manager for the
Crate app stack.

If you use `docker-compose.home.yaml`, the Stack page may also show optional
services such as `slskd`, `tidarr`, or `nginx` as absent. That is expected.

### Hairpin NAT may affect testing from inside your LAN

If your router does not support NAT loopback/hairpin NAT, public URLs may fail
from inside your own Wi-Fi while still working perfectly from the internet.

Always test once from:

- mobile data
- another internet connection

### Dynamic IP updates do not solve CGNAT

If your ISP does not give you a real public IPv4, DDNS alone cannot make port
forwarding work.

## 18. Optional Next Steps

Once the core stack is stable, add optional pieces one by one:

- Last.fm / Spotify / Fanart.tv / Ticketmaster keys
- Soulseek (`slskd`)
- ProtonVPN helper if you actually want worker-side proxying
- Tidal download workflow
- additional reverse-proxied services under the same Traefik

Do not add everything on day one. First make sure:

- `admin`
- `listen`
- `api`
- Traefik
- PostgreSQL
- Redis
- worker

are all boring and reliable.

## References

Official docs used to shape the Cloudflare and Traefik parts of this guide:

- Debian netinst download: <https://www.debian.org/CD/netinst/>
- Debian stable download page: <https://www.debian.org/download>
- Docker Engine install on Debian: <https://docs.docker.com/engine/install/debian/>
- Traefik ACME DNS challenge: <https://doc.traefik.io/traefik/v3.4/user-guides/docker-compose/acme-dns/>
- Traefik ACME `dnsChallenge` reference: <https://doc.traefik.io/traefik/v2.0/https/acme/>
- lego Cloudflare token guidance: <https://go-acme.github.io/lego/dns/cloudflare/index.html>
- Cloudflare token permissions reference: <https://developers.cloudflare.com/fundamentals/api/reference/permissions/>
- Cloudflare List Zones API: <https://developers.cloudflare.com/api/resources/zones/methods/list/>
- Cloudflare List DNS Records API: <https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/list/>
- Cloudflare Update DNS Record API: <https://developers.cloudflare.com/api/resources/dns/subresources/records/methods/edit/>
