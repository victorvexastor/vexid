# VexID Architecture

## Overview

VexID is a layered identity system combining self-certifying identifiers with capability-based authorisation and content-addressed storage.

```
┌─────────────────────────────────────────┐
│              SvelteKit UI               │
│         (wallet, profiles, proofs)      │
├─────────────────────────────────────────┤
│              UCAN Auth Layer            │
│     (capability tokens, delegation)     │
├─────────────────────────────────────────┤
│           Autonym Protocol              │
│   (DIDs, key rotation, attestations)    │
├─────────────────────────────────────────┤
│         libp2p / IPFS Transport         │
│    (peer discovery, content routing)    │
├─────────────────────────────────────────┤
│            Rust Core Runtime            │
│   (crypto, storage, protocol logic)     │
└─────────────────────────────────────────┘
```

## Components

### 1. Autonym — Identity Foundation
- Self-certifying key pairs (Ed25519 / secp256k1)
- DID-compatible identifiers (`did:autonym:...`)
- Key rotation without identity loss
- Revocation via capability chain, not central registry

### 2. IPFS / libp2p — Storage & Transport
- Identity documents stored as content-addressed DAGs
- libp2p for peer discovery and DHT-based resolution
- No single point of failure for identity lookup
- Pinning services for availability (optional)

### 3. UCAN — Authorisation
- Bearer tokens encoding capability chains
- Delegation without contacting the delegator
- Time-bounded, scope-limited permissions
- No OAuth dance, no central auth server

### 4. Rust Core
- `vexid-core` crate: crypto primitives, DID operations
- `vexid-node` crate: libp2p networking, IPFS integration
- `vexid-cli`: command-line identity management
- WASM compilation target for browser use

### 5. SvelteKit Frontend
- Identity wallet (create, backup, recover)
- Credential presentation UI
- QR-based identity exchange
- Progressive Web App for mobile

## Security Model

- Private keys never leave the device
- All network operations use authenticated encryption
- Zero-knowledge proofs for selective disclosure (future)
- No metadata leakage by design

## Integration Points

- OMXUS platform authentication
- Agent identity for ContinuuAI/Neuais
- Cross-chain identity bridging (future)
