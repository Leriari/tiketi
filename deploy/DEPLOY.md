# Deploying ChainTix for free

This sets up a free public deployment, good until January and beyond:

| Part | Where | Cost |
|---|---|---|
| Website | Firebase Hosting, `https://tiketi-6e9fd.web.app` | free (Spark plan) |
| API, worker, database, Redis | One Oracle Cloud "Always Free" server, run with Docker | free, permanently |
| HTTPS for the API | Caddy and Let's Encrypt, on a free `sslip.io` hostname | free |
| Payments | M-Pesa **Daraja sandbox** (no real money) | free |
| Tickets on-chain | Base **Sepolia** testnet | free (test ETH) |
| Login | Google, through Firebase; phone codes only for 3 demo numbers | free |

It takes about an hour the first time. Most of that is Oracle signup.

---

## 1. Create the Oracle Cloud server (once)

1. Sign up at **https://signup.cloud.oracle.com**.
   - Choose a home region near Kenya with free Ampere capacity, such as
     *Johannesburg* or *UK South*. **You can't change the home region later.**
   - Oracle asks for a card to verify you. Always Free resources are never
     charged; stay on the Free Tier and don't upgrade.
2. Go to **Compute → Instances → Create instance**:
   - **Image:** Canonical **Ubuntu 22.04** or 24.04.
   - **Shape:** *Ampere* → **VM.Standard.A1.Flex**, with 2 OCPUs and 12 GB
     memory. Up to 4 OCPUs and 24 GB is free. If you get "Out of capacity",
     try again later or use another availability domain.
   - **Networking:** keep "Assign a public IPv4 address" on.
   - **SSH keys:** "Generate a key pair" and **download the private key**.
3. When the instance is *Running*, copy its **Public IP address**.
4. Open the web ports. Go to the instance's **Subnet**, then **Security
   List**, then **Add Ingress Rules**. Add source `0.0.0.0/0`, TCP,
   **Destination** Port Range **80**. Leave **Source** Port Range empty.
   Add the same rule again for **443**.

## 2. Make the production settings (on your PC)

From the project folder, in a terminal:

```bash
venv\Scripts\python deploy\make_env.py --ip <PUBLIC_IP>
```

This writes `deploy/.env.production`, which is git-ignored:

- It generates new production secrets.
- It copies your M-Pesa sandbox, Firebase and Base Sepolia settings from
  your local `.env`.
- It prints **three demo phone numbers and their fixed codes**. Keep them;
  they're the only phone logins on the public site.

> **Minting wallet:** the server mints with the same `MINTER_PRIVATE_KEY`
> as your PC. Don't run your local Celery worker while the server is live,
> or the two will compete for the same wallet's transaction numbers. Better
> still, give the server its own funded Sepolia wallet. The deployment
> scripts don't need any changes for that.

## 3. Set up the server

Connect to the server. On Windows, PowerShell has `ssh` built in:

```bash
ssh -i path\to\ssh-key.key ubuntu@<PUBLIC_IP>
```

The repository is private, so give the server its own **read-only deploy
key**. It can read this one repository and nothing else, and you can revoke
it anytime. On the server:

```bash
ssh-keygen -t ed25519 -N "" -f ~/.ssh/id_ed25519 -C "tiketi-server"
cat ~/.ssh/id_ed25519.pub
```

Copy the line it prints. On GitHub, go to the **Leriari/tiketi** repository,
then **Settings → Deploy keys → Add deploy key**. Paste the line, name it
"oracle-server", and leave "Allow write access" **off**.

Then, on the server:

```bash
ssh-keyscan github.com >> ~/.ssh/known_hosts
git clone git@github.com:Leriari/tiketi.git ~/tiketi
bash ~/tiketi/deploy/setup-server.sh
exit        # log out and back in so Docker works without sudo
```

From your PC, copy the settings file up:

```bash
scp -i path\to\ssh-key.key deploy\.env.production ubuntu@<PUBLIC_IP>:~/tiketi/deploy/
```

Back on the server, start everything:

```bash
cd ~/tiketi/deploy && ./up.sh
```

The first start builds the image, which takes about 5–10 minutes on ARM.
Then check it:

```bash
curl https://<PUBLIC-IP-WITH-DASHES>.sslip.io/
```

You should get `{"status":"ok", ... "env":"production" ...}`.

## 4. Publish the website (on your PC)

```bash
npx firebase-tools login          # once; opens a browser
bash deploy/deploy-frontend.sh    # in Git Bash
```

The site is now live at **https://tiketi-6e9fd.web.app**.

## 5. Make yourself platform admin

On the server, after signing in once on the site:

```bash
cd ~/tiketi/deploy
docker compose --env-file .env.production -f docker-compose.prod.yml exec api \
  python scripts/promote_platform_admin.py 07XXXXXXXX
```

---

## Day to day

| Task | Command (on the server, in `~/tiketi/deploy`) |
|---|---|
| Deploy new backend code | `./up.sh` (pulls from GitHub, rebuilds, migrates) |
| Deploy new frontend | `bash deploy/deploy-frontend.sh` (on your PC) |
| See logs | `docker compose --env-file .env.production -f docker-compose.prod.yml logs -f api worker` |
| Restart | `docker compose --env-file .env.production -f docker-compose.prod.yml restart` |
| Backups | Daily, in `~/tiketi/deploy/backups/`, kept 14 days |
| Restore a backup | `gunzip -c backups/tiketi-DATE.sql.gz \| docker compose --env-file .env.production -f docker-compose.prod.yml exec -T db psql -U tiketi tiketi` |

**Keep it alive until January:** Oracle may reclaim Always Free instances
it considers idle (CPU, network and memory all very low for 7 days). A demo
with a worker and database running normally stays above that. If the
instance is ever stopped, start it again from the console; the data is on
its disk.

## What's different from local development

These are set in `.env.production`:

- `APP_ENV=production`: the developer login shortcut and the code-on-screen
  panel are off.
- **No SMS** (`OTP_DELIVERY_CHANNEL=disabled`). People sign in with Google.
  The first time, they type their M-Pesa number, which is stored as
  **unverified** and used only to request payments
  (`GOOGLE_PHONE_CONFIRMATION=unverified`). Phone-code login works only for
  the three `DEMO_PHONE_CODES` numbers.
- `ALLOW_SIMULATED_PAYMENTS=true`: checkout shows "Simulate M-Pesa success"
  for testers who can't receive sandbox prompts. Sandbox only.
- Only the Firebase site may call the API (`CORS_ORIGINS`).

Known gap before any real-money use: the M-Pesa callback isn't yet checked
against Daraja, so a forged callback can mark a payment paid. That's
harmless on the sandbox, but it must be fixed before switching
`MPESA_ENV=production`.
