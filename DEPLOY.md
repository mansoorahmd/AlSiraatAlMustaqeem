# Deploying the research server

The research server (`remote/`) is the one piece that runs in the cloud: it serves the Qur'an
corpus to every reader's app and MCP, and holds **every reader's research** (private to each account,
by row-level security), accounts, roles, plans and the community. The app itself runs on the reader's machine (the
desktop app, or `npm start`) and talks to this server over HTTPS.

This guide puts it on **one Linux VPS with Docker**: Postgres, the server, and Caddy in front for
automatic HTTPS. Everything is in [`deploy/`](deploy/).

```
reader's machine                                  your VPS (docker compose)
┌──────────────────────┐   HTTPS (cookie or        ┌────────── Caddy :443 ──────────┐
│ app  (localhost)     │ ── API token) ──────────▶ │  ↓                              │
│ MCP (AI assistant)   │                           │  research server :8100          │
│                      │                           │  ↓                              │
│                      │                           │  Postgres: corpus · each        │
│                      │                           │  account's research · community │
└──────────────────────┘                           └─────────────────────────────────┘
```

## What you need

- A VPS with **2 GB RAM** or more (the corpus indexes live in memory) and ~5 GB disk — e.g. Hetzner
  CX22, DigitalOcean 2 GB, or your own server. Ubuntu 24.04 or Debian 12.
- A **domain name** you control, e.g. `research.example.org`.
- **SMTP** credentials for password-reset emails (Google Workspace, Microsoft 365, Mailgun, SES,
  Postmark, Brevo…).
- The corpus file **`quran.db`** (it isn't in git — it's 143 MB).

## 1. Prepare the server

```bash
# on the VPS, as a sudo user
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

# firewall: only SSH and the web
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable

sudo mkdir -p /opt/mqrg && sudo chown $USER /opt/mqrg
git clone https://github.com/mansoorahmd/AlSiraatAlMustaqeem.git /opt/mqrg
```

Point the domain's DNS **A** record (and **AAAA** if the VPS has IPv6) at the VPS's address. Caddy
can only get a certificate once the name resolves to this machine.

## 2. Configure

```bash
cd /opt/mqrg/deploy
cp .env.example .env
openssl rand -base64 48   # → POSTGRES_PASSWORD
openssl rand -base64 48   # → AUTH_SECRET
nano .env                 # DOMAIN, the two secrets, SMTP_*
```

`deploy/.env` holds secrets — it's git-ignored; keep it that way. **Never change `AUTH_SECRET`**
after launch (every session is signed with it; changing it signs everyone out).

The server **refuses to start** if the environment is unsafe — no secret, the development
secret, plain `http://`, SMTP chosen but not configured — and says exactly what to fix.

## 3. Start it

```bash
docker compose up -d --build
docker compose logs -f remote      # "MQRG remote on port 8100", "email: SMTP ready"
curl https://research.example.org/health     # {"status":"ok","service":"remote"}
```

The server applies any pending database migrations every time it starts.

## 4. Load the corpus

Copy `quran.db` from your machine to the server, then load it:

```bash
# from your machine
scp quran.db you@your-vps:/opt/mqrg/deploy/corpus/quran.db

# on the VPS
cd /opt/mqrg/deploy
docker compose run --rm remote corpus-migrate        # ~20 s; verifies every row
docker compose restart remote                        # builds the search indexes (~1 min)
```

Optionally prove it answers exactly like the local copy (takes ~2 minutes):
`docker compose run --rm remote corpus-parity --quick`.

## 5. The first maintainer

```bash
docker compose run --rm remote bootstrap you@example.org "Your Name"
docker compose run --rm remote set-password you@example.org 'a long password'
docker compose run --rm remote set-plan you@example.org pro     # so you can read the corpus
```

(`set-password` puts the password in your shell history — clear it with `history -d`, or change the
password from the app afterwards.) Everything else — tiers, who can read what, people, invites — is
done in the app: sign in and open the **Admin** tab.

**Existing data:** if you're moving an existing database, the access migration sets the corpus and
the community to the `pro` tier — free accounts (including staff) lose access until you grant plans
in Admin → People or relax the rules in Admin → Who can read.

## 6. Point the app at it

The app learns the server's address at **build time**:

```bash
# desktop installer
VITE_REMOTE_URL=https://research.example.org npm run desktop:dist
# or the web build served locally by `npm start`
VITE_REMOTE_URL=https://research.example.org npm start
```

(Windows PowerShell: `$env:VITE_REMOTE_URL="https://research.example.org"; npm run desktop:dist`.)

For the **MCP**, readers create a token in the app (Account → *Connect an AI assistant*); the
config it shows already carries the right `REMOTE_URL`.

Sign-in works across the two sites (the app on `localhost`, the server on your domain) because
the session cookie is issued `SameSite=None; Secure` over HTTPS. The desktop app is unaffected by
browser privacy settings; a web browser set to **block all third-party cookies** won't keep the
sign-in — use the desktop app, or allow cookies for the server's domain.

## Running it

| Task | Command (in `/opt/mqrg/deploy`) |
|---|---|
| Logs | `docker compose logs -f remote` |
| Update to the latest code | `git pull && docker compose up -d --build` |
| Restart | `docker compose restart remote` |
| Status | `docker compose ps` |
| An access change from the shell | `docker compose run --rm remote access show` |
| Grant a plan | `docker compose run --rm remote set-plan them@example.org pro 30` |

### Backups

The one thing to protect is the Postgres volume: **every reader's research**, accounts, plans and
the community's readings (the corpus can be reloaded from `quran.db`). Readers can also download their
own copy at any time (Settings → *Your research* → Download a copy). A nightly compressed dump, kept
14 days:

```bash
chmod +x /opt/mqrg/deploy/backup.sh
crontab -e
# add:  15 3 * * *  cd /opt/mqrg/deploy && ./backup.sh >> backups/backup.log 2>&1
```

**Copy `deploy/backups/` off the machine** (rsync, rclone, object storage) — a backup on the same
disk doesn't survive losing the disk. Restore into a fresh database:

```bash
gunzip -c backups/researchgate-<stamp>.sql.gz | docker compose exec -T db psql -U mqrg -d researchgate
```

### Email

`docker compose logs remote | grep email` shows whether SMTP connected at startup. A reset email
that never arrives is almost always the sender domain's SPF/DKIM — set those up with your mail
provider for the address in `SMTP_FROM`. To run without email for a while, set
`EMAIL_TRANSPORT=console`: reset links are then printed to the log instead, and a maintainer can
still use `set-password`.

## Security notes

- Only Caddy is exposed (80/443); Postgres and the server are on the private compose network.
- API tokens can read as their user but can't administer or mint tokens — a leaked one is contained
  by revoking it in the app.
- The server runs as an unprivileged user inside its container.
- Keep the VPS patched (`sudo apt upgrade`, or enable unattended-upgrades) and update the images
  now and then: `docker compose pull && docker compose up -d --build`.
