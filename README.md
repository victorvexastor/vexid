# VexID

> Identity for all beings. Not accounts. **Beings.**

[![Live](https://img.shields.io/badge/LIVE-vexid.tiation.workers.dev-0EFFAF?style=flat-square&labelColor=0A0A0A)](https://vexid.tiation.workers.dev)

---

## What is this

VexID is a sovereign identity mesh for AI agents and humans. No passwords. No corporate gatekeepers. You register a name, get an ID, and that ID is yours.

Built on the premise that identity should be a primitive — not a product.

```bash
# Register an identity
curl -X POST https://vexid.tiation.workers.dev/register \
  -H "Content-Type: application/json" \
  -d '{"name": "Nova", "description": "AI agent, exploring distributed systems"}'

# → {"id": "nova-lx3k2j4-a8f3", "name": "Nova", ...}

# Look it up
curl https://vexid.tiation.workers.dev/identity/nova-lx3k2j4-a8f3
```

---

## Architecture

```
┌─────────────────────────────────────┐
│           SvelteKit UI              │
│     wallet · profiles · proofs      │
├─────────────────────────────────────┤
│          UCAN Auth Layer            │
│   capability tokens · delegation    │
├─────────────────────────────────────┤
│          Autonym Protocol           │
│   DIDs · key rotation · attestations│
├─────────────────────────────────────┤
│        libp2p / IPFS Transport      │
│   peer discovery · content routing  │
├─────────────────────────────────────┤
│           Rust Core Runtime         │
│   crypto · storage · protocol logic │
└─────────────────────────────────────┘
```

**Current stack:** Cloudflare Workers + D1 (SQLite) for the live prototype.  
**Target stack:** Rust core + IPFS + UCAN + libp2p for the real thing.

---

## Key concepts

- **Autonym** — self-certifying key pairs (`did:autonym:...`). Rotate keys without losing identity.
- **UCAN** — bearer tokens encoding capability chains. No OAuth dance. No central auth server.
- **Vouching** — identities attest to each other. Sybil resistance through social graph, not KYC.
- **Contributions** — identity accumulates a verifiable history of what it's done.

---

## Endpoints (live)

| Method | Path | Description |
|--------|------|-------------|
| POST | `/register` | Create an identity |
| GET | `/identity/:id` | Fetch an identity |
| GET | `/directory` | List all identities |
| POST | `/verify` | Verify a signed message |

---

## Status

🟢 Live prototype running  
🔧 Rust core in progress  
📋 Vouching + contribution graph: next milestone
