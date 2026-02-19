# Setup Guide

This guide covers everything you need to get obsidian-curator running against your Obsidian LiveSync vault.

---

## Prerequisites

| Requirement | Version | Notes |
|------------|---------|-------|
| Node.js | 18+ | `node --version` to check |
| CouchDB | 3.x | Self-hosted (local or remote) |
| Obsidian LiveSync plugin | Latest | Installed and syncing |

**E2EE must be disabled** in the LiveSync plugin. obsidian-curator reads note content directly from CouchDB — it cannot decrypt E2EE content.

---

## Step 1: Install CouchDB

### macOS (Homebrew)

```bash
brew install couchdb
brew services start couchdb
```

### Ubuntu/Debian

```bash
# Add Apache CouchDB repository
curl -L https://couchdb.apache.org/repo/keys.asc | sudo apt-key add -
echo "deb https://apache.jfrog.io/artifactory/couchdb-deb/ focal main" \
  | sudo tee /etc/apt/sources.list.d/couchdb.list
sudo apt update
sudo apt install couchdb
```

Select **standalone** mode during install. Set an admin username and password when prompted.

### Docker (quickest)

```bash
docker run -d \
  --name couchdb \
  -p 5984:5984 \
  -e COUCHDB_USER=admin \
  -e COUCHDB_PASSWORD=yourpassword \
  apache/couchdb:3
```

---

## Step 2: CouchDB Initial Setup

Open CouchDB Fauxton at http://localhost:5984/_utils

If this is a fresh install, Fauxton will prompt you to complete setup:

1. **Setup Wizard** → Choose **Single Node**
2. Set your admin credentials
3. Click **Configure Node**

Verify it's working:

```bash
curl http://localhost:5984/
# Should return: {"couchdb":"Welcome","version":"3.x.x",...}
```

---

## Step 3: Configure Obsidian LiveSync

In Obsidian, open Settings → Community Plugins → Self-hosted LiveSync:

### Connection tab
- **URI**: `http://localhost:5984` (or your CouchDB URL)
- **Username**: your CouchDB admin username
- **Password**: your CouchDB admin password
- **Database name**: `obsidian` (or any name you choose — remember it)

Click **Test** — you should see a green ✓.

### Sync Settings tab
- **End-to-End Encryption**: **OFF** ← required for obsidian-curator
- **Batch size**: 50 (default is fine)

Click **Apply** and let LiveSync perform the initial sync. Your vault notes will appear as CouchDB documents.

---

## Step 4: Install obsidian-curator

```bash
npm install -g obsidian-curator
```

Verify:

```bash
obsidian-curator --version
```

---

## Step 5: Run the Setup Wizard

```bash
obsidian-curator init
```

### Wizard walkthrough

**Step 1: CouchDB connection**
```
CouchDB host [localhost]: localhost
CouchDB port [5984]: 5984
Database name [obsidian]: obsidian
Username (blank if no auth): admin
Password: ****
Protocol [http]: http

Testing connection... ✓ Connected. Found 142 notes.
```

**Step 2: Vault structure**
```
Pick a vault structure preset:
  1. PARA (Projects, Areas, Resources, Archives)
  2. Zettelkasten (Slipbox, References, Projects)
  3. Johnny Decimal (you define the categories)
  4. Flat (inbox only, no enforced structure)
  5. Custom (define your own folders)

Your choice [1]: 1
```

**Step 3: AI provider**
```
AI provider (for process/file features):
  1. None — rule-based only, no API key needed
  2. Ollama — local, free, requires Ollama installed
  3. OpenAI — cloud, pay-per-use
  4. Anthropic — cloud, pay-per-use
  5. Custom — any OpenAI-compatible endpoint

Your choice [1]: 2
Ollama base URL [http://localhost:11434]:
Model [llama3.2]:
Testing... ✓ Connected.
```

**Step 4: Task projects** (optional)
```
Define task projects? (y/N): y
Project name: Work
Keywords (comma-separated): work,office,meeting,invoice,client
Add another? (y/N): n
```

Config is saved to `~/.obsidian-curator/config.json`.

---

## Step 6: Verify the Connection

```bash
# List all vault notes
obsidian-curator audit

# Capture a test note
obsidian-curator capture "test note from obsidian-curator"

# Open Obsidian — the note should appear in your inbox folder
```

### View available commands

```bash
obsidian-curator --help
```

All commands are documented in the [CLI command reference](../README.md#cli-command-reference).

---

## Using a Remote CouchDB

If CouchDB is on another machine on your network:

```bash
obsidian-curator init
# CouchDB host: 192.168.1.100
# CouchDB port: 5984
```

Or edit `~/.obsidian-curator/config.json`:

```json
{
  "vault": {
    "host": "192.168.1.100",
    "port": 5984,
    "database": "obsidian",
    "username": "admin",
    "password": "yourpassword"
  }
}
```

### HTTPS / TLS

```json
{
  "vault": {
    "host": "couchdb.example.com",
    "port": 6984,
    "protocol": "https",
    "username": "admin",
    "password": "yourpassword"
  }
}
```

---

## Project-Local Config

For per-vault/per-project settings, create `.obsidian-curator.json` in your working directory. This overrides the global config:

```json
{
  "vault": {
    "database": "work-vault"
  },
  "ai": {
    "provider": "openai",
    "model": "gpt-4o"
  }
}
```

Run `obsidian-curator` from that directory and it will use the local config.

---

## Troubleshooting

### ECONNREFUSED — CouchDB not reachable

```
Error: CouchDB is not reachable — is the server running? (ECONNREFUSED)
```

**Checks:**
1. Is CouchDB running? `curl http://localhost:5984/` — should return `{"couchdb":"Welcome",...}`
2. On Linux: `sudo systemctl status couchdb`
3. On macOS: `brew services list | grep couchdb`
4. Wrong port? Default is **5984**. Check `config.vault.port`.
5. Firewall blocking the port? On Linux: `sudo ufw allow 5984`

### Authentication errors

```
Error: CouchDB authentication failed — check credentials in config
```

**Checks:**
1. Double-check username/password in `~/.obsidian-curator/config.json`
2. Test directly: `curl -u admin:yourpassword http://localhost:5984/obsidian`
3. Admin party mode? (No auth set up) — leave `username` and `password` blank in config
4. Reset CouchDB admin: edit `/opt/couchdb/etc/local.ini` and restart

### Database not found

```
Error: CouchDB database not found — check "database" in config
```

**Checks:**
1. Check the database name in Fauxton: http://localhost:5984/_utils
2. Has LiveSync created the database yet? Run a sync in Obsidian first.
3. Case-sensitive: `obsidian` ≠ `Obsidian`
4. Update config: `obsidian-curator config set vault.database your-db-name`

### Notes not appearing in Obsidian after capture

obsidian-curator writes directly to CouchDB. LiveSync should pick up changes within seconds.

**Checks:**
1. Is LiveSync running in Obsidian? Check the LiveSync icon in the status bar.
2. Is LiveSync set to continuous sync mode? Settings → Self-hosted LiveSync → Sync Settings → LiveSync mode: **Enabled**
3. Wait 10–30 seconds and pull down to refresh in Obsidian.

### E2EE encrypted content

```
Error: Note is encrypted — E2EE must be disabled for obsidian-curator to read it
```

obsidian-curator cannot read E2EE-encrypted notes. Disable E2EE in LiveSync settings and re-sync your vault.

---

## Config File Reference

Config search order (later wins):

1. Built-in defaults
2. `~/.obsidian-curator/config.json` (global)
3. `./.obsidian-curator.json` (local, current directory)
4. Explicit path passed to `loadConfig(path)` in code

See the [Configuration Reference](../README.md#configuration-reference) in the main README for the full config shape.
