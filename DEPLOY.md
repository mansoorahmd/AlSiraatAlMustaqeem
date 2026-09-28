# Deploying the research server

The research server (`server/`) is the one piece that runs in the cloud: it serves the Qur'an
corpus to every reader's app and MCP, and holds **every reader's research** (private to each account,
by row-level security), accounts, roles, plans and the community. The same address also serves
the **web app**: opening `https://<your domain>/` in a browser is the whole thing, nothing to
install. The desktop app (or `npm start`) runs on the reader's machine instead and talks to the
same server over HTTPS.

This guide puts it on **one Linux VPS with Docker**: Postgres, the server, and Caddy in front for
automatic HTTPS, with the web app built into the Caddy image
([`deploy/web.Dockerfile`](deploy/web.Dockerfile)). Everything is in [`deploy/`](deploy/).

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

## 0. On Oracle Cloud (Always Free)

Oracle's Always Free tier covers this whole setup: one ARM (Ampere A1) VM with up to 2 OCPUs and
12 GB RAM, plus up to 200 GB of block storage. The server needs no changes for ARM. It reads SQLite
through Node's built-in `node:sqlite` (no native modules), and `node`, `postgres` and `caddy` all
publish arm64 images. Do these steps before step 1.

1. **Sign up** at cloud.oracle.com. Your **home region can't be changed later**, and free A1
   instances are only created there. Busy regions (Ashburn, Frankfurt, Singapore…) are often "out
   of capacity", so pick a quieter one near your readers.
2. **Upgrade to Pay As You Go** (Billing → Upgrade). Always Free resources stay free. Without the
   upgrade, Oracle can *reclaim* free instances it sees as idle (low CPU, network and memory use
   over 7 days), and a research server is idle most of the time. Then add a **budget alert**
   (Billing → Budgets, e.g. $1) so any charge you didn't plan for emails you.
3. **Create the instance** (Compute → Instances → Create):
   - Image: **Canonical Ubuntu 24.04** (the aarch64 build is picked automatically for A1).
   - Shape: **VM.Standard.A1.Flex**, **2 OCPUs / 12 GB**, the whole free allowance.
   - Networking: a public subnet with **Assign a public IPv4 address** checked.
   - SSH keys: upload your public key, or download the generated private key and keep it.
   - Boot volume: the default 47 GB is enough. You can go up to 200 GB free.

   If you get "Out of host capacity", try another availability domain, or retry later. Capacity
   often frees up within hours.
4. **Reserve the IP** (Networking → IP management → Reserved public IPs), so the address, and
   your DNS record, survive recreating the instance.
5. **Open ports 80 and 443 in Oracle's firewall.** Go to Networking → Virtual cloud networks →
   your VCN → Security Lists → Default → Add Ingress Rules. Source `0.0.0.0/0`: TCP `80`,
   TCP `443`, UDP `443`.
6. **Open them on the VM too.** Oracle's Ubuntu images ship their own iptables rules that reject
   everything except SSH. On Oracle, **skip the `ufw` line in step 1** (it clashes with those
   rules) and run this instead:

   ```bash
   ssh ubuntu@<public-ip>
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
   sudo iptables -I INPUT 6 -m state --state NEW -p udp --dport 443 -j ACCEPT
   sudo netfilter-persistent save
   ```

7. **A domain.** Point an A record at the reserved IP. If you have no domain yet, a free DuckDNS
   subdomain (`yourname.duckdns.org`) works with Caddy's automatic HTTPS.

Then continue with step 1. Log in as `ubuntu`, and leave out the `ufw` line. Oracle Object
Storage (20 GB free) is a good place to copy the nightly backups (see *Backups*).

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
docker compose logs -f server      # "MQRG research server on port 8100", "email: SMTP ready"
curl https://research.example.org/health     # {"status":"ok","service":"research-server"}
```

The server applies any pending database migrations every time it starts.

## 4. Load the corpus

Copy `quran.db` from your machine to the server, then load it:

```bash
# from your machine
scp quran.db you@your-vps:/opt/mqrg/deploy/corpus/quran.db

# on the VPS
cd /opt/mqrg/deploy
docker compose run --rm server corpus-migrate        # ~20 s; verifies every row
docker compose restart server                        # builds the search indexes (~1 min)
```

Optionally prove it answers exactly like the local copy (takes ~2 minutes):
`docker compose run --rm server corpus-parity --quick`.

## 5. The first maintainer

```bash
docker compose run --rm server bootstrap you@example.org "Your Name"
docker compose run --rm server set-password you@example.org 'a long password'
docker compose run --rm server set-plan you@example.org pro     # so you can read the corpus
```

(`set-password` puts the password in your shell history — clear it with `history -d`, or change the
password from the app afterwards.) Everything else — tiers, who can read what, people, invites — is
done in the app: sign in and open the **Admin** tab.

**Existing data:** if you're moving an existing database, the access migration sets the corpus and
the community to the `pro` tier — free accounts (including staff) lose access until you grant plans
in Admin → People or relax the rules in Admin → Who can read.

## 6. Point the app at it

**The web app needs nothing.** `docker compose up -d --build` builds it with the right address and
Caddy serves it at `https://<your domain>/`. Share that link. Paths that are the app's files (`/`,
`/assets/…`) are the app, and everything else goes to the server. The server always trusts its own
address for sign-in, so `TRUSTED_ORIGINS` can stay empty. After changing `DOMAIN`, rebuild so the
app picks up the new address.

The **desktop app** learns the server's address at **build time**:

```bash
# desktop installer
VITE_REMOTE_URL=https://research.example.org npm run desktop:dist
# or the web build served locally by `npm start`
VITE_REMOTE_URL=https://research.example.org npm start
```

(Windows PowerShell: `$env:VITE_REMOTE_URL="https://research.example.org"; npm run desktop:dist`.)

For the **MCP**, readers create a token in the app (Account → *Connect an AI assistant*); the
config it shows already carries the right `REMOTE_URL`.

The hosted web app is on the server's own address, so its sign-in is an ordinary first-party
cookie. For a local app, sign-in works across the two sites (the app on `localhost`, the server on your domain) because
the session cookie is issued `SameSite=None; Secure` over HTTPS. The desktop app is unaffected by
browser privacy settings; a web browser set to **block all third-party cookies** won't keep the
sign-in — use the desktop app, or allow cookies for the server's domain.

## Running it

| Task | Command (in `/opt/mqrg/deploy`) |
|---|---|
| Logs | `docker compose logs -f server` |
| Update to the latest code | `git pull && docker compose up -d --build` |
| Restart | `docker compose restart server` |
| Status | `docker compose ps` |
| An access change from the shell | `docker compose run --rm server access show` |
| Grant a plan | `docker compose run --rm server set-plan them@example.org pro 30` |

### Backups

The one thing to protect is the Postgres volume: **every reader's research**, accounts, plans and
the community's readings (the corpus can be reloaded from `quran.db`). It is the only copy of the
readers' research. A nightly compressed dump, kept 14 days:

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

`docker compose logs server | grep email` shows whether SMTP connected at startup. A reset email
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
