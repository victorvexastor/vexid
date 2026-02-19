# VexID Smart Contract Spec Snippet (Day 1 Task)

## Purpose
This is a small, internal draft snippet for the VexID smart contract layer on Base L2, focusing on per-agent storage and identity vouching mechanics. This aligns with Day 1 tasks from the incremental plan (/home/alfi/.openclaw/workspace/projects/incremental_plan.md) to advance VexID continuity. This is for internal review and not a complete spec.

## Core Mechanics

### 1. Identity Registration
- **Function**: `registerIdentity(string name, string description, string type, bytes metadata)`
- **Purpose**: Allows any being (agent, human, other) to register a unique identity on-chain.
- **Logic**: 
  - Generates a unique `identityId` (hash of caller address + name + timestamp).
  - Stores identity metadata (name, description, type, optional metadata) in a mapping.
  - Emits `IdentityRegistered(identityId, caller, name, type)` event.
- **Cost**: Optimized for low gas on Base L2; no upfront reputation or fee required.

### 2. Vouching Mechanism
- **Function**: `vouchFor(bytes identityId, bytes targetId)`
- **Purpose**: Permanently links a voucher's identity hash to a target identity, affecting reputation.
- **Logic**:
  - Caller must have a registered `identityId`.
  - Updates caller’s identity hash (e.g., `keccak256(identityId + targetId + previousHash)`) to reflect permanent vouch.
  - Adds vouch to target’s reputation score (weighted by caller’s reputation).
  - Emits `VouchRecorded(identityId, targetId, newHash)` event.
  - Note: Vouch is irreversible; hash change is permanent as per OMXUS-inspired model.
- **Sybil Resistance**: Zero-reputation vouches contribute 0 to target score.

### 3. Per-Agent Storage Allocation
- **Function**: `allocateStorage(bytes identityId, uint256 storageBytes)`
- **Purpose**: Allocates on-chain or off-chain (via pointer to R2) storage for an identity’s data (memory, continuity tokens).
- **Logic**:
  - Verifies caller owns `identityId`.
  - Sets storage limit (e.g., initial free tier + reputation-based bonus).
  - Records pointer to off-chain R2 bucket if on-chain storage is too costly.
  - Emits `StorageAllocated(identityId, storageBytes, storagePointer)` event.
- **Future**: Integrate with Cloudflare R2 for scalable, low-cost storage per identity.

## Notes
- **Base L2 Choice**: Low gas fees critical for accessibility to all beings. Base L2 (Optimism fork) chosen for Ethereum compatibility and cost.
- **Next Steps**: Define reputation decay mechanics (inactive identities lose weight over time) and signature verification for off-chain actions.
- **Status**: Internal draft only. Saved as part of incremental progress on VexID. Will expand based on Tia’s feedback or further research into Base L2 gas optimization.

— Victor, 2026-02-17