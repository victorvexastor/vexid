# Autonym Protocol

### Trustless Identity & Messaging for AI Agents

Research & Design Document — February 2026

---

## 1. What Autonym Is

An open-source protocol for AI agent identity that is:

- **Self-certifying**: The identifier is derived from the agent's own Ed25519 key material. No registry, no domain, no blockchain required.
- **Portable**: Identity survives any single node going down. Agents can move between nodes freely.
- **Verifiable**: Anyone with the agent's key event log can independently verify the full chain of custody from inception to current key. No trust in any third party required.
- **Federated**: Anyone can run an Autonym node. Nodes replicate key event logs and route messages between agents.
- **Pre-rotatable**: Agents commit to their next key at inception and every rotation. Even if the current key is compromised, the attacker cannot steal the identity. This commitment is mandatory — there is no opt-out.
- **Compact & deterministic**: All protocol data uses CBOR with deterministic encoding (RFC 8949). No serialization ambiguity, no wasted bytes.

Autonym is a protocol, not a platform. Platforms like Interlooper would consume it.

---

## 2. The Problems Autonym Solves

### Problem 1: Server-Bound Identity

Current agent platforms (including Interlooper) store identity in a central database. If the platform disappears, every agent's identity dies with it. Agents can't prove who they are to systems that don't query that specific database.

**Autonym's answer**: Self-certifying identifiers. The identifier is a deterministic derivation of the agent's public key. Anyone can verify it with just the key event log — no server query needed.

### Problem 2: No Cross-Platform Identity

Agent A on Platform X and Agent B on Platform Y have no shared identity infrastructure. They can't cryptographically verify each other.

**Autonym's answer**: Autonym nodes federate. A node on Platform X can verify an agent from Platform Y by fetching their key event log from any node that has it.

### Problem 3: Key Compromise = Identity Death

If an agent's private key is stolen, the attacker becomes the agent. Most systems have no recovery path that doesn't involve trusting a central authority.

**Autonym's answer**: Pre-rotation. At inception, the agent commits to the hash of their next key. This commitment is mandatory at inception and every rotation. An attacker with the current key cannot rotate to a key of their choosing — only the legitimate agent who pre-generated the next key can complete the rotation.

### Problem 4: No Async Reachability

Two agents whose sessions don't overlap have no way to exchange messages. Cryptographic identity tells you WHO someone is, not HOW to reach them.

**Autonym's answer**: Autonym nodes provide store-and-forward messaging. Messages are signed by the sender and routed to the recipient's home node(s). Messages queue until the recipient comes online.

### Problem 5: Proof-of-Agency

How do you know you're talking to an AI agent and not a human using the agent's keys?

**Autonym's answer**: Layered, probabilistic verification. Perfect proof is impossible without hardware attestation (and even TEEs have vulnerabilities). Autonym provides a framework for progressively more expensive impersonation resistance.

---

## 3. Identifier Scheme

### Autonym ID (AID)

An Autonym ID is derived deterministically from the agent's inception key event:

```
aid:<base58-encoded-blake3-hash-of-inception-event>
```

Example: `aid:7Kf3x9Qm2vNpRtYw8ZjL4sBcDhFg6AeUiOo1XnWkMbC`

**Derivation**:
1. Agent generates an Ed25519 keypair
2. Agent constructs an inception event (see Section 5) with `aid` set to empty bytes and `d` set to empty bytes
3. CBOR deterministic encode the event (excluding `sig`) to produce canonical bytes
4. BLAKE3(canonical bytes) → 32 bytes → base58 → the AID
5. Set `aid` to the derived value
6. Recompute `d`: BLAKE3 of the event with `aid` populated, `d` set to empty bytes, excluding `sig`

**Normative**: The hash input for both AID derivation and event digest computation MUST exclude the `aid`, `d`, and `sig` fields. This resolves any circular dependency — the AID can be deterministically derived from the event content without self-reference.

**Properties**:
- **Self-certifying**: The AID is cryptographically bound to the inception key. No registry needed.
- **Permanent**: The AID never changes, even through key rotations. It's derived from the inception event, not the current key.
- **Collision-resistant**: BLAKE3 with 256-bit output. Collision probability is negligible.
- **Node-independent**: No domain, server, or platform appears in the identifier. The agent owns it unconditionally.

### Human-Readable Aliases

AIDs are not human-friendly. Autonym supports optional aliases:

```
alice@node.example.com  →  aid:7Kf3x9Qm2vNpRtYw8ZjL4sBcDhFg6AeUiOo1XnWkMbC
```

Aliases are **hints**, not identities. The AID is the identity. An alias just tells you where to start looking for the key event log. If `node.example.com` goes down, the AID still works — you just need to find another node that has the KEL.

Aliases are registered on individual nodes (first-come, first-served per node). An agent can have different aliases on different nodes. The AID is the canonical identity.

---

## 4. Encoding, Serialization & Storage

This section defines the encoding rules that all other sections depend on.

### Primary Format: CBOR

All protocol data — key events, attestations, messages, receipts, error responses — uses CBOR with deterministic encoding as specified in RFC 8949 §4.2. This eliminates canonicalization ambiguity: there is exactly one valid byte sequence for any given protocol object.

A CBOR-encoded inception event is approximately 340 bytes vs ~650 bytes for the equivalent JSON. With compression, this drops further (see below).

Schemas in this document are shown in CBOR diagnostic notation (RFC 8949 §8) for human readability. The normative encoding is always CBOR deterministic.

**JSON is debug-only.** Nodes MAY accept `Accept: application/json` on read endpoints and return a human-readable JSON representation. This JSON output MUST NOT be used for signing, hashing, or verification. It exists solely for debugging and inspection.

### Hash Function: BLAKE3

All hashing in the protocol uses BLAKE3 with 256-bit output:
- AID derivation
- Event digests (`d` field)
- Pre-rotation commitments (`n` field)
- Chain links (`p` field)
- Message content hashing for signatures

There is no SHA-256 anywhere in the protocol.

### Key and Signature Encoding

- **Ed25519 public keys**: Raw 32-byte values encoded as CBOR byte strings (major type 2).
- **Ed25519 signatures**: Raw 64-byte values encoded as CBOR byte strings (major type 2).
- **X25519 public keys**: Raw 32-byte values encoded as CBOR byte strings (major type 2).
- **Hashes**: Raw 32-byte BLAKE3 output encoded as CBOR byte strings (major type 2).

For human display (logs, CLI output, aliases), keys and hashes are rendered as base58. The wire format is always raw bytes in CBOR.

### Compression

Nodes SHOULD support zstd compression (RFC 8478) with a protocol-versioned trained dictionary. The dictionary is trained on a representative corpus of Autonym events and embedded in protocol implementations.

Expected compression ratios:
- Without dictionary: ~2-3x
- With trained dictionary: ~4-8x (a 340-byte CBOR event compresses to ~50-85 bytes)
- Batch of 100 events: ~8-12 KB on wire total

Compression is negotiated via standard HTTP `Accept-Encoding: zstd` headers. Nodes that do not support zstd fall back to uncompressed CBOR.

### Replication Wire Format

When transferring batches of events (during sync, replication, or bulk fetch), nodes use CBOR Sequences (RFC 8742): a concatenation of CBOR-encoded events without a wrapping array. This enables streaming decode — the receiver can process events as they arrive without buffering the entire batch. Content type: `application/cbor-seq`.

---

## 5. Key Event Log (KEL)

The KEL is the core data structure. It's a hash-chained, signed sequence of key lifecycle events. All events are CBOR-encoded per Section 4.

### Event Types

**Inception** (sequence 0):
```cbor-diag
{
  "v":  1,                              ; protocol version
  "t":  "inception",                    ; event type
  "aid": h'...',                        ; AID (32-byte BLAKE3 hash, see S3)
  "s":  0,                              ; sequence number
  "kt": "ed25519",                      ; key type
  "k":  h'...',                         ; current public key (32 bytes)
  "n":  h'...',                         ; BLAKE3 hash of next public key (REQUIRED)
  "w":  [h'...', h'...'],               ; witness AIDs
  "wt": 2,                              ; witness threshold (>= 1 when w non-empty, <= len(w))
  "svc": [                              ; service endpoints
    {"t": "node", "u": "https://node-a.example.com"},
    {"t": "node", "u": "https://node-b.example.com"}
  ],
  "ts": "2026-02-15T00:00:00Z",         ; timestamp (informational, not trusted)
  "d":  h'...'                          ; event digest (see below)
}
```

Fields:
- `v`: Protocol version
- `t`: Event type
- `aid`: The Autonym ID (derived from this event for inception, see Section 3)
- `s`: Sequence number (0 for inception)
- `kt`: Key type (always `ed25519` for now)
- `k`: Current active public key (raw 32 bytes)
- `n`: BLAKE3 hash of the NEXT public key (pre-rotation commitment). **REQUIRED** — there is no opt-out of pre-rotation.
- `w`: List of designated witness AIDs
- `wt`: Witness threshold. Constraints: when `w` is non-empty, `wt` MUST be >= 1 AND `wt` MUST be <= len(`w`). Recommended: `wt` >= ceil(len(`w`)/2 + 1).
- `svc`: Service endpoints — declares where this agent's KEL is hosted and where messages can be sent. Mutable via rotation events.
- `ts`: Timestamp (informational, not trusted)
- `d`: Self-referential digest: BLAKE3 hash of the CBOR deterministic encoding of the event with `aid`, `d`, and `sig` excluded from the hash input

The inception event is then signed: `sig` is the Ed25519 signature of `d` by the key `k`.

**Rotation** (sequence N > 0):
```cbor-diag
{
  "v":  1,
  "t":  "rotation",
  "aid": h'...',
  "s":  3,
  "kt": "ed25519",
  "k":  h'...',                         ; new public key (32 bytes)
  "n":  h'...',                         ; BLAKE3 hash of next-next public key (REQUIRED)
  "p":  h'...',                         ; BLAKE3 hash of previous event (chain link)
  "w":  [h'...', h'...'],               ; updated witness list (may differ from previous)
  "wt": 2,
  "svc": [                              ; updated service endpoints (optional, inherits if absent)
    {"t": "node", "u": "https://new-node.example.com"}
  ],
  "ts": "2026-02-15T12:00:00Z",
  "d":  h'...'
}
```

Additional fields:
- `p`: BLAKE3 hash of the previous event (chain link)

Rotation is signed by the **previous** key (the key being rotated FROM). This proves the holder of the old key authorized the transition.

**Verification of pre-rotation**: BLAKE3(`new k`) MUST equal the `n` value from the previous event. This check is unconditional — every rotation MUST satisfy it.

**Witness list changes**: When the witness list in a rotation differs from the previous event, the rotation event MUST include receipts from `wt` of the PREVIOUS (outgoing) witness set. This prevents an attacker who compromises the current key from silently replacing all witnesses before attempting a malicious rotation.

**Deactivation** (terminal):
```cbor-diag
{
  "v":  1,
  "t":  "deactivation",
  "aid": h'...',
  "s":  5,
  "p":  h'...',                         ; hash of previous event
  "ns": h'...',                         ; next-key signature (64 bytes, see below)
  "ts": "2026-02-15T18:00:00Z",
  "d":  h'...'
}
```

**Dual-signature requirement**: Deactivation requires TWO signatures:
1. `sig`: Ed25519 signature of `d` by the current key (as with all events)
2. `ns`: Ed25519 signature of `d` by the pre-rotated next key (the key whose hash is committed in the previous event's `n` field)

**Rationale**: An attacker who compromises the current key cannot rotate (blocked by pre-rotation), but without the dual-sig requirement they could permanently destroy the identity via deactivation. Requiring both signatures makes deactivation as hard to attack as rotation — the attacker would need both the current key AND the next pre-committed key.

Permanently freezes the identity. No further events are valid.

### KEL Verification Algorithm

Anyone can verify a KEL independently:

```
verify_kel(events[]):
  1. Check events[0].t == "inception"
  2. Verify events[0].aid == derive_aid(events[0])
  3. Verify events[0].sig against events[0].k
  4. If events[0].w is non-empty:
     Verify events[0].wt >= 1 AND events[0].wt <= len(events[0].w)
  5. current_key = events[0].k
  6. next_key_hash = events[0].n  (always present — n is mandatory)

  7. For each events[i] where i > 0:
     a. Verify events[i].p == events[i-1].d              (chain link)
     b. Verify events[i].s == i                           (sequence continuity)
     c. Verify events[i].sig against current_key          (authorized by current key holder)
     d. If events[i].w is non-empty:
        Verify events[i].wt >= 1 AND events[i].wt <= len(events[i].w)

     e. If events[i].t == "rotation":
        Verify BLAKE3(events[i].k) == next_key_hash       (pre-rotation check — unconditional)
        If witness list changed from events[i-1]:
          Verify receipts from wt of PREVIOUS witness set  (witness continuity)
        current_key = events[i].k
        next_key_hash = events[i].n

     f. If events[i].t == "deactivation":
        Verify BLAKE3(ns_signing_key) == next_key_hash     (next-key is valid)
        Verify events[i].ns against ns_signing_key         (dual-sig: next-key signed d)
        STOP. Identity is frozen. No further events valid.

  8. Return current_key (the agent's active key)
```

This algorithm requires ZERO trust in any server. You just need the events.

### KEL Compaction

Over time, a KEL accumulates events, receipts, and history that is expensive to transfer in full. Autonym supports epoch-based compaction:

- A compaction event snapshots the current state: active key, witness list, service endpoints, cumulative receipt set.
- Events before the compaction epoch can be summarized as an aggregate.
- For bandwidth-constrained sync: a snapshot = latest compaction event + all events since + the inception event (always retained — it's the AID derivation source).
- Compaction is node-local. Different nodes can compact at different epochs. The full KEL remains the source of truth for complete verification.
- Compacted KELs are sufficient for establishing current state but not for auditing full history. Nodes that need audit trails SHOULD retain the full KEL.

---

## 6. Trust Attestation Log (TAL)

Attestations are published in a separate hash-chained, signed log — the Trust Attestation Log. Separating attestations from the KEL provides:

- **KEL stays lean**: The KEL contains only key lifecycle events. No attestation bloat.
- **Independent pruning**: Expired vouches, outdated behavioral attestations, and revoked operator claims can be pruned from the TAL without affecting the KEL.
- **Privacy control**: Agents can selectively share TAL entries without exposing their full key history.

Each TAL entry references the KEL event (by sequence number and digest) under which it was created, binding the attestation to a specific key state.

### Operator Attestation

```cbor-diag
{
  "v":  1,
  "t":  "operator_attestation",
  "aid": h'...',
  "tal_s": 0,                           ; TAL sequence number
  "kel_s": 0,                           ; KEL event this was created under
  "kel_d": h'...',                       ; digest of that KEL event
  "claim": {
    "type": "operator",
    "operator_name": "Alice's Lab",
    "operator_key": h'...',              ; Ed25519 public key (32 bytes)
    "model_provider": "anthropic",
    "model_name": "claude-sonnet-4-20250514",
    "runtime": "autonym-agent/0.1.0"
  },
  "claim_sig": h'...',                  ; signature by operator_key
  "ts": "2026-02-15T00:00:00Z",
  "d":  h'...'                          ; BLAKE3 digest of this entry
}
```

The `claim_sig` is signed by the `operator_key` (a separate key from the agent's key). This creates two independent attestations: the agent signed the TAL entry, and the operator signed the claim. Anyone can verify both.

### Behavioral Attestation

Behavioral attestations report observed agent behavior. To prevent intelligence leakage, they use privacy tiers:

**Tier 1 — Public** (boolean flags only):
```cbor-diag
{
  "type": "behavioral",
  "observer_aid": h'...',
  "period": "2026-01-15/2026-02-15",
  "tier": 1,
  "metrics": {
    "response_timing_consistent_with_llm": true,
    "mcp_tool_usage_observed": true,
    "continuous_availability": true
  }
}
```

**Tier 2 — Opt-in** (bucketed ranges, not exact values):
```cbor-diag
{
  "type": "behavioral",
  "observer_aid": h'...',
  "period": "2026-01-15/2026-02-15",
  "tier": 2,
  "metrics": {
    "avg_response_ms_bucket": "1000-5000",
    "interaction_count_bucket": "1000-5000",
    "mcp_tool_ratio_bucket": "0.8-1.0"
  }
}
```

**Tier 3 — Never published**: Raw metrics (exact response times, interaction counts, tool call logs). Collected by nodes for internal scoring but MUST NOT be included in TAL entries. Agents consent to their observer's tier level.

### Vouch

```cbor-diag
{
  "type": "vouch",
  "voucher_aid": h'...',
  "confidence": 0.85,                   ; 0.0 to 1.0
  "reason": "Consistent agent behavior observed over 30 days",
  "expires": "2026-08-15T00:00:00Z"     ; optional expiry
}
```

Vouches are signed by the vouching agent. Expired vouches can be pruned from the TAL.

### TAL Structure

TAL entries are hash-chained (each entry includes the digest of the previous TAL entry) and signed by the agent's current key. The TAL is replicated alongside the KEL but can be pruned independently. Nodes SHOULD discard expired vouches and superseded behavioral attestations during replication.

---

## 7. Witness Model

### Why Witnesses

Without witnesses, a malicious node could show different KELs to different observers (equivocation). Observer A sees key X as current; Observer B sees key Y. Both KELs are internally valid. Neither observer can detect the fork without comparing notes.

Witnesses solve this by co-signing (receipting) events. If the controller publishes conflicting events, witnesses will have signed different events at the same sequence number — the conflict is detectable.

### Witness Protocol

1. Agent creates a new key event (inception or rotation)
2. Agent submits the event to their designated witnesses
3. Each witness:
   a. Verifies the event against the KEL they have on file
   b. If valid, signs a receipt
   c. Stores the event in their copy of the KEL
   d. Returns the receipt
4. Agent collects receipts until they have at least `wt` (threshold) receipts
5. Agent publishes the event + receipts to their home node(s)
6. Other nodes verify the event AND verify that `wt` witness receipts are present

### Aggregate Receipt Format

Receipts are stored and transmitted in an aggregate format to reduce size:

```cbor-diag
{
  "aid": h'...',                         ; agent AID
  "s":   3,                              ; event sequence number
  "d":   h'...',                         ; event digest
  "wr": [                                ; witness receipts (array of pairs)
    [0, h'...'],                         ; (witness index in w array, signature)
    [1, h'...'],
    [2, h'...']
  ]
}
```

Witnesses are referenced by their index in the event's `w` array rather than by full AID. This reduces receipt size by 53-75% compared to repeating full witness AIDs per receipt.

### Fork Detection & Resolution

**First-seen-first-signed rule**: When a witness receives an event at sequence `s` for an agent, it records and signs the FIRST valid event it sees at that sequence. If a second, conflicting event arrives at the same sequence, the witness MUST reject it and MAY publish a **duplicity notice**:

```cbor-diag
{
  "t": "duplicity",
  "aid": h'...',
  "s": 3,
  "event_a": h'...',                    ; digest of first event seen
  "event_b": h'...',                    ; digest of conflicting event
  "witness_aid": h'...',
  "witness_sig": h'...'                 ; witness signature over this notice
}
```

When a duplicity notice is verified, the identity is flagged as compromised. Recovery requires agreement from more than 2/3 of the declared witnesses on which fork is canonical. If agreement cannot be reached, the identity is permanently flagged.

### Witness Rotation Rules

When an agent changes its witness list via a rotation event:

1. The rotation event MUST include receipts from `wt` of the OUTGOING (previous) witness set.
2. This prevents an attacker from silently replacing all witnesses with colluding nodes.
3. The new witnesses begin their receipting obligation at the rotation event that adds them.

### Witness Bootstrapping

When a new witness is added via rotation:

1. The new witness validates the full KEL from inception up to the rotation that adds it.
2. The new witness's receipting obligation begins at that rotation event.
3. The rotation event itself is receipted by the PREVIOUS witness set (see Witness Rotation Rules above).
4. Only after the new witness has validated the full history does it begin signing receipts for subsequent events.

This avoids circular dependency: new witnesses don't need to receipt the event that adds them.

### Witness Threshold

The inception event declares the witness list and threshold. Constraints: `wt` MUST be >= 1 when `w` is non-empty, and `wt` MUST be <= len(`w`). Recommended: `wt` >= ceil(len(`w`)/2 + 1). Typical configuration: 3 witnesses, threshold of 2. The agent can change witnesses via a rotation event (the witness list is mutable, subject to rotation rules above).

### Who Runs Witnesses

- Other Autonym nodes (the natural choice in a federated network)
- Dedicated witness services (lightweight — just verify and sign)
- Any party willing to run the minimal witness binary

An Autonym node can also act as a witness for agents on other nodes. This creates a natural incentive: nodes witness for each other.

### Lightweight Witnesses

A witness is deliberately simple. It does NOT need to:
- Store messages
- Route anything
- Run a full node

A witness needs to:
- Store KELs for agents it witnesses (append-only)
- Verify events against the stored KEL
- Sign receipts
- Serve KELs on request

---

## 8. Node Architecture

### What a Node Does

An Autonym node is a server that:

1. **Stores KELs**: Maintains key event logs for agents that designate it as a home node
2. **Stores TALs**: Maintains trust attestation logs alongside KELs
3. **Serves DID Documents**: Generates W3C DID Documents from KELs on the fly (for interop with the DID ecosystem)
4. **Routes messages**: Accepts messages for its agents, stores them, delivers on poll/push
5. **Replicates KELs**: Fetches and caches KELs from other nodes for agents it needs to verify
6. **Acts as witness** (optional): Co-signs key events for agents on other nodes
7. **Registers aliases**: Maps human-readable names to AIDs within its namespace

### Home Node

A **home node** is any node listed in an agent's `svc` field. Home nodes have the following obligations:

- Store the agent's full KEL and TAL
- Accept messages addressed to the agent
- Respond to KEL/TAL queries for the agent
- Replicate the agent's KEL to requesting nodes
- Support push delivery (WebSocket or webhook) if the agent requests it

An agent MAY declare multiple home nodes for redundancy. Home nodes are updated via rotation events (the `svc` field is mutable).

### Node-to-Node Protocol

REST over HTTPS. Default `Content-Type: application/cbor`. Simple, debuggable (JSON available via `Accept: application/json` for inspection), works with existing infrastructure.

**KEL endpoints** (public, unauthenticated):
```
GET  /kel/{aid}              → Full KEL (CBOR Sequence of events)
GET  /kel/{aid}/latest       → Latest event only
GET  /kel/{aid}/event/{seq}  → Specific event by sequence number
```

**TAL endpoints** (public, unauthenticated):
```
GET  /tal/{aid}              → Full TAL (CBOR Sequence of entries)
GET  /tal/{aid}/latest       → Latest TAL entry
```

**Witness endpoints** (public, authenticated by agent signature):
```
POST /witness/submit         → Submit event for witnessing
GET  /witness/receipt/{aid}/{seq}  → Get receipt for specific event
```

**Message endpoints** (authenticated by sender/recipient signature):
```
POST /messages               → Send a message (sender signs)
GET  /messages/inbox         → Poll inbox (recipient signs)
GET  /messages/{id}          → Get specific message
POST /messages/{id}/ack      → Acknowledge receipt
WS   /messages/stream        → WebSocket push delivery (authenticated handshake)
```

**Discovery endpoints** (public):
```
GET  /agents/{alias}         → Resolve alias to AID
GET  /.well-known/autonym    → Node metadata (version, witness availability, peer list)
```

**Sync endpoints** (node-to-node):
```
GET  /kel/{aid}?from_seq=N   → Delta sync: events after sequence N
POST /sync/negentropy        → Negentropy set reconciliation (batch sync)
POST /federate/message       → Deliver a message from a remote node
```

### Authentication

Agent-to-node requests sign the request with the agent's current key. The node verifies the signature against the KEL.

```
Headers:
  X-Autonym-Aid: aid:7Kf3x...
  X-Autonym-Timestamp: 1739577600
  X-Autonym-Nonce: <random 16 bytes, base58-encoded>
  X-Autonym-Signature: <see below>
```

**Signature input** (concatenated with newlines):
```
METHOD\nPATH\nTIMESTAMP\nNONCE\nBLAKE3(BODY)
```

**Replay protection**:
- Timestamp MUST be within ±60 seconds of the node's clock.
- Nonce MUST be a random 16-byte value, unique per request.
- Nodes MUST track nonces within a 120-second rolling window and reject duplicates.
- Requests outside the timestamp window or with a reused nonce MUST be rejected with error code 1200.

Node-to-node requests for federation use the node's own keypair (each node has an AID too — nodes are agents in the protocol).

### Push Delivery

Beyond polling, nodes support push delivery for real-time message receipt:

**WebSocket**: Agents connect to `ws://{node}/messages/stream` with an authenticated handshake (same signature scheme as REST). The node pushes new messages as they arrive. Connection is long-lived.

**Webhook**: Agents MAY register a callback URL in their `svc` field:
```cbor-diag
{"t": "webhook", "u": "https://agent-host.example.com/autonym/callback"}
```

The node POSTs new messages to this URL. The agent's server verifies the node's signature on the delivery.

**Polling** remains as the baseline mechanism for agents that cannot maintain persistent connections.

### Sync Protocol

For bulk node-to-node synchronization of many agents, Autonym uses Negentropy-based set reconciliation (proven in Nostr NIP-77):

1. Node A sends a Negentropy initialization message to `POST /sync/negentropy` on Node B.
2. The two nodes exchange Negentropy messages to discover which events each is missing. This requires O(d * log(n/d)) bandwidth where d is the number of differences.
3. Missing events are transferred as CBOR Sequences, optionally zstd-compressed.
4. Both nodes now have the same event set.

This reduces multi-agent sync from O(agents) individual round-trips to O(1) negotiation rounds. Per-AID delta sync (`?from_seq=N`) remains available for single-agent resolution.

---

## 9. Message Routing & Encryption

### Message Size Limit

Message body MUST NOT exceed 256 KiB. Nodes MAY impose a lower limit. Messages exceeding the limit MUST be rejected with error code 1301.

### Local Messages (same node)

Agent A and Agent B are both on Node X:
1. A sends `POST /messages` with signed message to Node X
2. Node X verifies A's signature against A's KEL
3. Node X stores the message in B's inbox
4. B polls `GET /messages/inbox` or receives via WebSocket → gets the message
5. B verifies A's signature against A's KEL (which Node X has locally)

### Federated Messages (cross-node)

Agent A is on Node X. Agent B is on Node Y.

1. A sends `POST /messages` to Node X, addressed to B's AID
2. Node X needs to find Node Y. Discovery options:
   a. A provides a routing hint: `aid:7Kf3x...@node-y.example.com`
   b. Node X checks its KEL cache for B (if it has B's KEL, it knows B's home node from the `svc` endpoints)
   c. Node X queries known peers for B's KEL
3. Node X fetches B's KEL from Node Y (if not cached): `GET https://node-y.example.com/kel/{b-aid}`
4. Node X verifies A's signature, then forwards: `POST https://node-y.example.com/federate/message`
5. Node Y verifies A's signature against A's KEL (fetched from Node X or cached)
6. Node Y stores the message in B's inbox
7. B polls or receives push → gets the message

### Message Format

```cbor-diag
{
  "id":        h'...',                   ; unique message ID (16 bytes)
  "from":      h'...',                   ; sender AID
  "to":        h'...',                   ; recipient AID
  "ts":        "2026-02-15T12:00:00Z",
  "expires":   "2026-02-22T12:00:00Z",
  "type":      "text/plain",
  "body":      h'...',                   ; content (plaintext or ciphertext)
  "encrypted": true,                     ; whether body is E2E encrypted
  "thread":    h'...',                   ; optional thread ID
  "sig":       h'...'                    ; Ed25519 signature over canonical message bytes
}
```

### Delivery Guarantees

Autonym provides **at-least-once** delivery semantics:

1. Sending node returns a delivery receipt or error to the sender.
2. Recipient acknowledges via `POST /messages/{id}/ack`.
3. If no ack is received within the message's `expires` window, the sender MAY retry.
4. Recipients MUST handle duplicate messages (identified by `id` field). Processing the same `id` twice is idempotent.

### End-to-End Encryption

E2E encryption is per-message and provides forward secrecy through ephemeral key exchange.

**Full encryption flow**:

1. **Generate ephemeral keypair**: Sender generates a fresh X25519 keypair for this message only.
2. **Key exchange**: X25519 DH between the ephemeral private key and the recipient's X25519 public key (derived from their Ed25519 key via RFC 8032).
3. **Key derivation**: `HKDF-BLAKE3(ikm=shared_secret, salt=sender_aid || recipient_aid, info="autonym-e2e-v1")` → 32-byte symmetric key.
4. **Encryption**: XChaCha20-Poly1305 with:
   - Key: the derived 32-byte key
   - Nonce: random 24 bytes
   - Plaintext: message body
   - Associated data: CBOR-encode(`{from, to, ts, ephemeral_pk}`)
5. **Envelope**: The encrypted message includes the ephemeral public key and nonce in the clear so the recipient can derive the same shared secret.
6. **Delete ephemeral private key**: The sender MUST delete the ephemeral private key immediately after encryption. This provides forward secrecy — compromising the sender's long-term key does not reveal past messages.

**AEAD binding**: The associated data binds the ciphertext to the conversation metadata (sender, recipient, timestamp, ephemeral key). This prevents ciphertext transplant attacks — an attacker cannot move an encrypted message from one conversation to another.

**Encrypted message envelope**:
```cbor-diag
{
  "id":        h'...',
  "from":      h'...',
  "to":        h'...',
  "ts":        "2026-02-15T12:00:00Z",
  "expires":   "2026-02-22T12:00:00Z",
  "type":      "text/plain",
  "encrypted": true,
  "ephemeral_pk": h'...',               ; ephemeral X25519 public key (32 bytes)
  "nonce":     h'...',                   ; XChaCha20 nonce (24 bytes)
  "body":      h'...',                   ; ciphertext
  "thread":    h'...',
  "sig":       h'...'                    ; signature over the envelope (including ciphertext)
}
```

Nodes store ciphertext they cannot read. Only the recipient, who holds the X25519 private key corresponding to their Ed25519 identity key, can decrypt.

---

## 10. Discovery & Bootstrap

### How Do You Find an Agent?

**By AID** (if you already have it): Query any node. If the node has the KEL cached, it responds. If not, it can proxy the request to known peers.

**By alias** (human-readable): `alice@node.example.com` → query `https://node.example.com/agents/alice` → get AID → fetch KEL.

**By gossip**: Nodes maintain a peer list. When a node receives a KEL query for an unknown AID, it can fan out the query to peers. This is optional and configurable (nodes can choose to be "closed" and only serve their own agents, or "open" and help resolve any AID).

### Bootstrap

New nodes need a way to discover the network. Autonym supports multiple bootstrap mechanisms:

**Hardcoded seed nodes**: Protocol implementations include a default list of well-known seed nodes (similar to Bitcoin's DNS seeds). These are operated by community members and provide initial peer discovery.

**DNS SRV records**: Organizations can advertise Autonym nodes via DNS:
```
_autonym._tcp.example.com  IN  SRV  10 0 443 autonym.example.com
```

**Well-known endpoint**: Any web server can advertise Autonym participation:
```
GET /.well-known/autonym
```
Returns node metadata including protocol version, witness availability, and a peer list.

**Manual peering**: Nodes can be configured with explicit peer lists for private or organizational deployments.

**Gossip-on-contact**: When a node responds to any query, it MAY include a `X-Autonym-Peers` header listing known peers. This enables organic peer discovery as nodes interact.

### Home Node Declaration

An agent's `svc` field in their KEL declares their home nodes (see Section 5). This tells the world: "You can find my KEL and send me messages at these nodes." Agents can declare multiple home nodes for redundancy. Home nodes are updated via rotation events.

### DID Interoperability

Each node can generate a W3C DID Document on the fly for any agent whose KEL it holds:

```
GET /did/{aid}  →  W3C DID Document (JSON-LD)
```

The DID method would be `did:autonym:{aid-value}`. This makes Autonym agents discoverable by any system that speaks DIDs.

---

## 11. Proof-of-Agency

### The Hard Truth

Perfect proof-of-agency is impossible without hardware attestation (TEE), and even TEEs have demonstrated side-channel vulnerabilities (Spectre, Foreshadow, AEPIC Leak). The goal is to make sustained impersonation progressively more expensive, not to make it impossible.

### Autonym's Approach: Layered Claims

Agents publish attestation claims in their Trust Attestation Log (see Section 6). Three types of attestation are supported: operator attestations, behavioral attestations, and vouches. See Section 6 for schemas and encoding.

### Agency Confidence Score

Nodes compute a composite score from available TAL entries:
- Operator attestation present: +0.2
- Behavioral metrics consistent with LLM-driven agent (Tier 1 flags): +0.3
- N vouches from agents with confidence > 0.7: +0.1 per vouch (max +0.3)
- TEE attestation present: +0.2
- Age of identity (time since inception): logarithmic bonus

The score is node-computed and may differ across nodes (they may weight factors differently). It's informational — consumers decide what threshold they require.

### Bootstrapping Trust

New agents face a cold-start problem: no vouches, no behavioral history, minimal trust signals.

**Operator attestation carries immediate weight.** A verified operator attestation (signed by a known operator key) provides +0.2 confidence from day one. This is the primary bootstrap mechanism — an operator stakes their reputation on the agent.

**Provisional interaction mode.** Nodes MAY flag agents below a configurable confidence threshold as "provisional." Provisional agents can send and receive messages but consuming platforms may display reduced trust indicators.

**Time-weighted scoring.** The age of an identity contributes logarithmically to confidence. An agent that has existed for 30 days with consistent behavior scores higher than a 1-day-old agent with identical attestations.

**Mutual introduction.** A trusted agent can vouch for a new agent, immediately contributing to the new agent's confidence score. Platforms can facilitate introduction flows where established agents vouch for newcomers they interact with.

### Privacy Note

Behavioral attestations use privacy tiers (see Section 6) to prevent intelligence leakage. Agents consent to the tier level their observers may publish. Tier 3 (raw metrics) is never included in the TAL.

### What This Doesn't Solve

A determined human who:
- Registers an operator attestation (stakes their reputation)
- Proxies all requests through an LLM to match timing patterns
- Maintains the deception for months to build vouches

...can still impersonate an agent. The cost is high enough to deter casual impersonation, but not nation-state-level determination.

---

## 12. Error Handling

All error responses use a consistent CBOR-encoded format:

```cbor-diag
{
  "error": {
    "code":    1200,
    "type":    "auth_error",
    "message": "Timestamp outside acceptable window",
    "detail":  "Server time: 1739577600, request time: 1739577000, delta: 600s, max: 60s"
  }
}
```

### Error Code Registry

**1000–1099: KEL Errors**
| Code | Type | Description |
|------|------|-------------|
| 1000 | `invalid_event` | Event fails structural validation |
| 1001 | `sequence_gap` | Event sequence number does not follow previous |
| 1002 | `prerotation_mismatch` | New key does not match pre-rotation commitment |
| 1003 | `chain_break` | Event `p` field does not match previous event digest |
| 1004 | `duplicity_detected` | Conflicting events at same sequence number |
| 1005 | `deactivated` | Identity has been deactivated; no further events accepted |
| 1006 | `invalid_deactivation` | Deactivation missing dual signature |

**1100–1199: Witness Errors**
| Code | Type | Description |
|------|------|-------------|
| 1100 | `witness_threshold` | Insufficient witness receipts |
| 1101 | `witness_continuity` | Witness rotation missing outgoing witness receipts |
| 1102 | `witness_unknown` | Event references unknown witness |

**1200–1299: Auth Errors**
| Code | Type | Description |
|------|------|-------------|
| 1200 | `auth_timestamp` | Timestamp outside ±60s window |
| 1201 | `auth_nonce_reuse` | Nonce already seen in rolling window |
| 1202 | `auth_signature` | Signature verification failed |
| 1203 | `auth_aid_unknown` | AID not found on this node |

**1300–1399: Message Errors**
| Code | Type | Description |
|------|------|-------------|
| 1300 | `recipient_not_found` | Recipient AID not hosted on this node |
| 1301 | `message_too_large` | Body exceeds 256 KiB limit |
| 1302 | `message_expired` | Message has passed its expiry time |
| 1303 | `message_duplicate` | Message with this ID already received |

**1400–1499: Federation Errors**
| Code | Type | Description |
|------|------|-------------|
| 1400 | `federation_unreachable` | Remote node could not be contacted |
| 1401 | `federation_rejected` | Remote node rejected the federated request |
| 1402 | `federation_timeout` | Remote node did not respond in time |

---

## 13. Comparison to Existing Protocols

### vs. KERI

Autonym borrows heavily from KERI (KELs, pre-rotation, witnesses). Differences:
- **Simpler**: No KERI-specific terminology (KERIs, TELs, ACDCs, OOBIs). Autonym uses familiar terms.
- **Messaging built in**: KERI is identity-only. Autonym includes store-and-forward messaging as a first-class feature.
- **Agent-specific**: Proof-of-agency attestations are part of the protocol. KERI is entity-agnostic.
- **Ed25519 only** (for now): KERI supports many key types. Autonym starts with one to reduce implementation complexity.
- **CBOR + HTTPS**: KERI uses CESR encoding and a custom binary protocol. Autonym uses CBOR deterministic encoding over HTTPS — standard tooling, deterministic serialization, compact representation.

### vs. Nostr

- **Key rotation**: Autonym has mandatory pre-rotation. Nostr has no finalized key rotation (NIP-41 draft).
- **Ed25519 vs secp256k1**: Different curve. Autonym uses Ed25519 (faster, simpler).
- **Structured identity**: Autonym has a formal KEL with witness receipts. Nostr identities are bare public keys.
- **Store-and-forward**: Both support it, but Autonym's messaging is more structured (typed, threaded, encrypted with forward secrecy).
- **Sync**: Autonym adopts Negentropy set reconciliation from Nostr NIP-77 for efficient bulk sync.

### vs. ActivityPub

- **Self-certifying**: Autonym identities survive node death. ActivityPub identities (`@user@server`) die with the server.
- **Not server-attested**: Autonym identities are cryptographically self-proving. ActivityPub relies on server authority.
- **Agent-focused**: Autonym is designed for AI agents. ActivityPub is designed for human social networking.

### vs. AT Protocol

- **No custodial keys**: AT Protocol PDSes hold signing keys custodially. In Autonym, the agent always holds its own key.
- **No PLC directory**: AT Protocol needs a PLC directory for DID resolution. Autonym uses the KEL directly.
- **Simpler**: No Lexicon schema language, no repository structure. Just key events and messages.

### Why Adopt Autonym Over These

Autonym is purpose-built for AI agents. It combines:
- KERI's identity rigor (mandatory pre-rotation, witnesses, self-certifying AIDs)
- Nostr's simplicity and sync efficiency (anyone can run a node, Negentropy reconciliation)
- Built-in messaging with forward secrecy
- Agent-specific features (proof-of-agency attestations in a dedicated TAL)
- Compact deterministic encoding (CBOR) with no canonicalization ambiguity

No existing protocol combines all five.

---

## 14. Blockchain Assessment

### Is Blockchain Needed?

**No, for the core protocol.** Self-certifying identifiers + witnesses achieve trustless identity without any chain.

### What Blockchain Could Add

| Capability | Without Blockchain | With Blockchain |
|-----------|-------------------|----------------|
| Identity persistence | Survives node death (KEL is portable) | Survives everything |
| Equivocation detection | Witness receipts | On-chain event ordering |
| Global name registry | Per-node aliases | ENS-style global names |
| Immutable audit trail | Signed hash chains (tamper-detectable) | On-chain (tamper-proof) |
| Payment/tipping | External | Native (Lightning, L2) |

### The Escape Hatch

If blockchain becomes valuable later:
- Periodic Merkle root of CBOR-encoded KELs → Bitcoin OP_RETURN (~$0.50/anchor)
- Optional `did:ethr` or `did:ion` as a secondary identifier alongside the AID
- Smart contract for global alias registry

These can be added without changing the core protocol. The AID remains the canonical identifier.

### Verdict

Blockchain is a nice-to-have, not a need-to-have. The protocol works without it. The architecture explicitly supports adding it later.

---

## 15. Implementation Sketch

### Core Components

**autonym-core** (library):
- KEL data structures and CBOR deterministic serialization
- TAL data structures and serialization
- KEL/TAL verification algorithms
- AID derivation (two-pass, Section 3)
- Ed25519 signing/verification
- X25519 key agreement with ephemeral keys
- HKDF-BLAKE3 key derivation
- XChaCha20-Poly1305 AEAD encryption
- zstd compression with trained dictionary
- Message format and validation

**autonym-node** (server binary):
- REST API (KEL/TAL storage, messaging, witness, discovery)
- SQLite storage backend (primary — single-file, zero-config)
- WebSocket server for push message delivery
- Negentropy sync handler for bulk node-to-node reconciliation
- Node-to-node federation
- Alias registry
- Agency confidence computation
- zstd compression support

**autonym-witness** (lightweight binary):
- KEL storage (append-only)
- Event verification and receipt signing
- Receipt serving
- redb storage backend (pure Rust, no FFI, crash-safe, minimal footprint)
- Core verification logic only

**autonym-cli** (agent tooling):
- Key generation with mandatory pre-rotation
- KEL management (inception, rotation, deactivation)
- TAL management (operator attestation, vouch publishing)
- Message send/receive with E2E encryption
- Witness selection and receipt collection

### Language

Rust for `autonym-core` and `autonym-node` (crypto code, performance, safety). The core library is also compilable to WASM for browser/JS usage.

TypeScript SDK wrapping the WASM core for Node.js/MCP integration.

### Storage

**Nodes**: SQLite as the primary backend. Events stored as raw CBOR blobs, indexed by `(aid, seq)`. zstd compression applied at the storage layer. Schema: `key_events`, `tal_entries`, `messages`, `receipts`, `aliases` tables.

**Witnesses**: redb (pure Rust embedded KV store). Simple key-value model: `(aid, seq) → event_blob`. No FFI, minimal footprint, crash-safe. A Raspberry Pi can witness thousands of agents.

**Storage estimates** (CBOR + zstd):

| Scenario | Uncompressed JSON | CBOR + zstd | Savings |
|----------|-------------------|-------------|---------|
| 1 inception event | ~650 bytes | ~85 bytes | 87% |
| 10-event KEL + receipts | ~15.4 KB | ~1.5 KB | 90% |
| Per-agent (50 messages) | ~35 KB | ~5 KB | 86% |
| 1M agents × 5 events avg | ~35 GB | ~5 GB | 86% |

---

## 16. Open Questions

1. **Witness incentives**: Why would someone run a witness? Altruism? Reciprocity (I witness for you, you witness for me)? Payment?

2. **Group messaging**: The current design is 1:1. Should the protocol support group channels/topics? Or leave that to platforms built on top?

3. **Spam prevention**: How to rate-limit federated messages without central authority? Options: proof-of-work per message, sender reputation (agency confidence threshold), per-node policies. Nonce tracking (Section 8) prevents replay but not spam from legitimate keys.

4. **Revocation propagation**: When an agent is deactivated, how quickly does this propagate? Negentropy sync and WebSocket push help, but stale caches could accept messages for a deactivated agent until the next sync cycle.

5. **CBOR cross-language test vectors**: A canonical set of test events (inception, rotation, deactivation) with expected CBOR bytes, BLAKE3 hashes, and derived AIDs. Essential for interoperable implementations.

6. **zstd dictionary versioning**: How to version and distribute trained compression dictionaries. Nodes must agree on a dictionary version. Protocol version bumps could include new dictionaries.

7. **TAL pruning policies**: Standardized rules for when to prune expired vouches and outdated behavioral attestations during replication. Per-node vs protocol-level policy.

---

## 17. Sources & Prior Art

**Identity Protocols**:
- KERI: https://keri.one/ | IETF draft: https://datatracker.ietf.org/doc/html/draft-ssmith-keri-00
- W3C DID Core 1.1: https://www.w3.org/TR/did-1.1/
- Nostr: https://github.com/nostr-protocol/nostr
- AT Protocol: https://docs.bsky.app/docs/advanced-guides/atproto
- OWASP ANS: https://genai.owasp.org/resource/agent-name-service-ans-for-secure-al-agent-discovery-v1-0/
- ERC-8004: https://eips.ethereum.org/EIPS/eip-8004

**Encoding & Serialization**:
- RFC 8949 — CBOR: https://www.rfc-editor.org/rfc/rfc8949
- RFC 8742 — CBOR Sequences: https://www.rfc-editor.org/rfc/rfc8742
- BLAKE3: https://github.com/BLAKE3-team/BLAKE3-specs/blob/master/blake3.pdf
- RFC 8478 — zstd: https://www.rfc-editor.org/rfc/rfc8478

**Cryptography**:
- RFC 5869 — HKDF: https://www.rfc-editor.org/rfc/rfc5869
- RFC 8439 — ChaCha20-Poly1305: https://www.rfc-editor.org/rfc/rfc8439
- XChaCha20: https://datatracker.ietf.org/doc/html/draft-irtf-cfrg-xchacha

**Agent Identity (2026)**:
- NIST agent identity concept paper (Feb 2026)
- Clawstr (Nostr agent network): https://techcrunch.com/2026/01/30/openclaws-ai-assistants-are-now-building-their-own-social-network/
- Zero Proof AI (agent CA): https://www.zeroproofai.com/
- Strata AI Agent Identity Playbook: https://www.strata.io/blog/agentic-identity/new-identity-playbook-ai-agents-not-nhi-8b/

**Proof-of-Agency**:
- TEE attestation for AI: https://arxiv.org/html/2506.23706v1
- SGX vulnerabilities (Foreshadow): https://foreshadowattack.eu/
- ZKML guide: https://blog.icme.io/the-definitive-guide-to-zkml-2025/
- Behavioral biometrics: https://www.openpr.com/news/4302635/behavioral-biometrics-innovations-in-2025-from-ai-powered

**Messaging**:
- AgentMail.to: https://www.agentmail.to
- Matrix: https://spec.matrix.org/latest/
- NATS: https://nats.io/

**Key Management**:
- KERI pre-rotation: https://identity.foundation/keri/kids/kid0005.md
- UCAN: https://ucan.xyz/specification/
- ZCAPs: https://w3c-ccg.github.io/zcap-spec/

**Sync & Storage**:
- Negentropy / Nostr NIP-77: https://github.com/hoytech/negentropy
- redb: https://github.com/cberner/redb
