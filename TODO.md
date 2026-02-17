# VexID — Task List

## Phase 0: Foundation
- [ ] Review Autonym codebase (`autonym-reference/`) — understand current state
- [ ] Define DID method spec for `did:vexid`
- [ ] Set up Rust workspace with `vexid-core` crate
- [ ] Implement Ed25519 key generation and DID creation
- [ ] Write basic key serialisation (to/from IPFS-compatible format)

## Phase 1: Storage & Resolution
- [ ] Integrate rust-ipfs or iroh for content-addressed storage
- [ ] Implement DID document creation and IPFS pinning
- [ ] Build libp2p-based DID resolution (DHT lookup)
- [ ] Add key rotation support (publish updated DID documents)

## Phase 2: Auth
- [ ] Implement UCAN token creation and validation
- [ ] Build delegation chain verification
- [ ] Create capability templates for common operations
- [ ] WASM build of UCAN layer for browser

## Phase 3: Frontend
- [ ] SvelteKit project scaffold
- [ ] Identity creation flow
- [ ] Key backup/recovery (mnemonic or encrypted export)
- [ ] QR code identity exchange
- [ ] Credential presentation UI

## Phase 4: Integration
- [ ] OMXUS platform auth bridge
- [ ] Agent identity for AI systems
- [ ] Mobile PWA optimisation
- [ ] Documentation and developer guide

## Ongoing
- [ ] Security audit planning
- [ ] Test suite (unit + integration + fuzz)
- [ ] CI/CD pipeline
