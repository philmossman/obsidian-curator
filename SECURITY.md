# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability in obsidian-curator, please report it responsibly.

**Do not open a public issue.** Instead, email **phil@mossman-equestrian.co.uk** with:

- A description of the vulnerability
- Steps to reproduce
- Any potential impact

I'll acknowledge receipt within 48 hours and aim to release a fix within 7 days for critical issues.

## Scope

obsidian-curator connects to CouchDB databases that may contain sensitive personal notes. Security issues of particular concern:

- Credential exposure (API keys, CouchDB passwords)
- Unintended data deletion or corruption
- Path traversal or injection via note paths
- AI prompt injection that could cause unintended vault modifications

## Supported versions

| Version | Supported |
|---------|-----------|
| 0.1.x   | ✅ Current |
