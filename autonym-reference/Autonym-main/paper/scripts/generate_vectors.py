#!/usr/bin/env python3
"""
generate_vectors.py — Reproducible test vector generator for the Autonym protocol.

Generates deterministic test vectors for:
  1. Inception event (AID derivation, digest, signature)
  2. Rotation event (pre-rotation verification, chain link, previous-key signing)
  3. Deactivation event (dual-signature: current key + next key)
  4. End-to-end encryption (X25519 DH, HKDF-BLAKE3, XChaCha20-Poly1305)

All outputs are deterministic: the same seed always produces the same vectors.

Requirements:
    pip install pynacl cbor2 blake3

Usage:
    python generate_vectors.py
"""

import hashlib
import hmac
import struct
import sys
from typing import Any

# ── Hash implementation ──────────────────────────────────────────────

try:
    import blake3

    def blake3_hash(data: bytes) -> bytes:
        """BLAKE3 hash with 256-bit output."""
        return blake3.blake3(data).digest()

    def blake3_keyed(data: bytes, key: bytes) -> bytes:
        """BLAKE3 keyed hash (requires exactly 32-byte key)."""
        return blake3.blake3(data, key=key).digest()

    HASH_IMPL = "blake3"
except ImportError:
    # Fallback: BLAKE2b with 32-byte output (NOT protocol-compliant,
    # but structurally equivalent for testing purposes).
    print("WARNING: blake3 package not found, falling back to BLAKE2b.", file=sys.stderr)
    print("         Install blake3: pip install blake3", file=sys.stderr)

    def blake3_hash(data: bytes) -> bytes:
        return hashlib.blake2b(data, digest_size=32).digest()

    def blake3_keyed(data: bytes, key: bytes) -> bytes:
        return hmac.new(key[:32], data, hashlib.blake2b).digest()[:32]

    HASH_IMPL = "blake2b-fallback"

import cbor2
import nacl.bindings
from nacl.signing import SigningKey, VerifyKey

# ── Deterministic seed ───────────────────────────────────────────────

SEED = b"autonym-test-vectors-v1"


def derive_ed25519_keypair(index: int) -> tuple[SigningKey, bytes]:
    """Derive a deterministic Ed25519 keypair from SEED + big-endian index.

    Returns (SigningKey, pk_bytes).
    """
    material = blake3_hash(SEED + struct.pack(">I", index))
    sk = SigningKey(material)
    pk = bytes(sk.verify_key)
    return sk, pk


def cbor_det_encode(obj: Any) -> bytes:
    """CBOR deterministic encode (RFC 8949 S4.2) via cbor2 canonical mode."""
    return cbor2.dumps(obj, canonical=True)


def sign_ed25519(sk: SigningKey, message: bytes) -> bytes:
    """Ed25519 sign, return 64-byte signature."""
    return sk.sign(message).signature


def verify_ed25519(pk_bytes: bytes, message: bytes, sig: bytes) -> bool:
    """Verify Ed25519 signature."""
    vk = VerifyKey(pk_bytes)
    try:
        vk.verify(message, sig)
        return True
    except Exception:
        return False


def hkdf_blake3(ikm: bytes, salt: bytes, info: bytes, length: int = 32) -> bytes:
    """HKDF using BLAKE3 as the underlying hash (extract-then-expand).

    Extract: PRK = BLAKE3-keyed(key=salt_32, data=ikm)
    Expand:  OKM = BLAKE3-keyed(key=PRK, data=T_prev||info||counter)
    """
    # BLAKE3 keyed hash requires exactly 32-byte key
    if len(salt) != 32:
        salt_32 = blake3_hash(salt)
    else:
        salt_32 = salt

    # Extract
    prk = blake3_keyed(ikm, key=salt_32)

    # Expand
    output = b""
    t = b""
    counter = 1
    while len(output) < length:
        t = blake3_keyed(t + info + bytes([counter]), key=prk)
        output += t
        counter += 1
    return output[:length]


# ── Display helpers ──────────────────────────────────────────────────

def hexfmt(data: bytes) -> str:
    return data.hex()


def print_field(label: str, value: bytes | str | int, indent: int = 4):
    prefix = " " * indent
    if isinstance(value, bytes):
        print(f"{prefix}{label} = {hexfmt(value)}")
    else:
        print(f"{prefix}{label} = {value}")


def print_header(title: str):
    print()
    print("=" * 72)
    print(f"  {title}")
    print("=" * 72)


# ════════════════════════════════════════════════════════════════════
# Step 1: Inception Event
# ════════════════════════════════════════════════════════════════════

def generate_inception() -> dict:
    """Generate a complete inception event with all intermediate values."""
    print_header("TEST VECTOR 1: INCEPTION EVENT")

    # Key generation
    sk0, pk0 = derive_ed25519_keypair(0)   # current key (inception)
    sk1, pk1 = derive_ed25519_keypair(1)   # next key (pre-rotation)
    nkh = blake3_hash(pk1)                 # pre-rotation commitment

    print(f"\n  [1] Key material:")
    print_field("current_sk (seed)", blake3_hash(SEED + struct.pack(">I", 0)))
    print_field("current_pk", pk0)
    print_field("next_pk", pk1)
    print_field("n = BLAKE3(next_pk)", nkh)

    # Build inception event — pass 1: derive AID
    event = {
        "v":   1,
        "t":   "inception",
        "aid": b"",                          # empty for pass 1
        "s":   0,
        "kt":  "ed25519",
        "k":   pk0,
        "n":   nkh,
        "w":   [],
        "wt":  0,
        "svc": [],
        "ts":  "2026-02-15T00:00:00Z",
        "d":   b"",                          # empty for pass 1
    }

    # Pass 1: hash excluding {aid, d, sig}
    hash_fields_1 = {k: v for k, v in event.items() if k not in ("aid", "d", "sig")}
    canonical_1 = cbor_det_encode(hash_fields_1)
    aid_raw = blake3_hash(canonical_1)

    print(f"\n  [2] AID derivation (pass 1):")
    print_field("CBOR bytes (excl aid,d,sig)", canonical_1)
    print_field("CBOR length", len(canonical_1))
    print_field("AID = BLAKE3(above)", aid_raw)

    # Pass 2: set AID, hash excluding {d, sig}
    event["aid"] = aid_raw
    hash_fields_2 = {k: v for k, v in event.items() if k not in ("d", "sig")}
    canonical_2 = cbor_det_encode(hash_fields_2)
    digest = blake3_hash(canonical_2)
    event["d"] = digest

    print(f"\n  [3] Event digest (pass 2):")
    print_field("CBOR bytes (excl d,sig)", canonical_2)
    print_field("CBOR length", len(canonical_2))
    print_field("d = BLAKE3(above)", digest)

    # Sign digest with current key
    sig = sign_ed25519(sk0, digest)
    event["sig"] = sig

    print(f"\n  [4] Signature:")
    print_field("sig = Sign(sk0, d)", sig)
    ok = verify_ed25519(pk0, digest, sig)
    print_field("Verify(pk0, d, sig)", ok)

    # Full CBOR encoding
    full_cbor = cbor_det_encode(event)
    print(f"\n  [5] Full inception event (CBOR):")
    print_field("length", f"{len(full_cbor)} bytes")
    print_field("cbor_hex", full_cbor)

    return {
        "event": event,
        "sk": sk0,
        "pk": pk0,
        "next_sk": sk1,
        "next_pk": pk1,
        "nkh": nkh,
        "aid_raw": aid_raw,
        "digest": digest,
    }


# ════════════════════════════════════════════════════════════════════
# Step 2: Rotation Event
# ════════════════════════════════════════════════════════════════════

def generate_rotation(inception: dict) -> dict:
    """Generate a rotation event following the inception."""
    print_header("TEST VECTOR 2: ROTATION EVENT")

    prev_sk = inception["sk"]
    prev_pk = inception["pk"]
    new_sk = inception["next_sk"]
    new_pk = inception["next_pk"]
    prev_nkh = inception["nkh"]
    aid_raw = inception["aid_raw"]
    prev_digest = inception["digest"]

    # Verify pre-rotation: BLAKE3(new_k) == inception.n
    computed_hash = blake3_hash(new_pk)
    prerot_ok = computed_hash == prev_nkh

    print(f"\n  [1] Pre-rotation verification:")
    print_field("new_pk", new_pk)
    print_field("BLAKE3(new_pk)", computed_hash)
    print_field("inception.n", prev_nkh)
    print_field("MATCH", prerot_ok)
    assert prerot_ok, "Pre-rotation check failed!"

    # Generate next-next keypair
    sk2, pk2 = derive_ed25519_keypair(2)
    nkh2 = blake3_hash(pk2)

    print(f"\n  [2] Next-next keypair:")
    print_field("next_next_pk", pk2)
    print_field("n = BLAKE3(next_next_pk)", nkh2)

    # Construct rotation event
    event = {
        "v":   1,
        "t":   "rotation",
        "aid": aid_raw,
        "s":   1,
        "kt":  "ed25519",
        "k":   new_pk,
        "n":   nkh2,
        "p":   prev_digest,                 # chain link to inception
        "w":   [],
        "wt":  0,
        "ts":  "2026-02-15T06:00:00Z",
        "d":   b"",
    }

    print(f"\n  [3] Chain link:")
    print_field("p = inception.d", prev_digest)

    # Compute digest (exclude d, sig)
    hash_fields = {k: v for k, v in event.items() if k not in ("d", "sig")}
    canonical = cbor_det_encode(hash_fields)
    rot_digest = blake3_hash(canonical)
    event["d"] = rot_digest

    print(f"\n  [4] Event digest:")
    print_field("CBOR bytes (excl d,sig)", canonical)
    print_field("d = BLAKE3(above)", rot_digest)

    # Sign with PREVIOUS key (inception key)
    sig = sign_ed25519(prev_sk, rot_digest)
    event["sig"] = sig

    print(f"\n  [5] Signature (by PREVIOUS key, sk0):")
    print_field("sig = Sign(sk0, d)", sig)
    ok = verify_ed25519(prev_pk, rot_digest, sig)
    print_field("Verify(pk0, d, sig)", ok)

    # Full CBOR
    full_cbor = cbor_det_encode(event)
    print(f"\n  [6] Full rotation event (CBOR):")
    print_field("length", f"{len(full_cbor)} bytes")
    print_field("cbor_hex", full_cbor)

    return {
        "event": event,
        "sk": new_sk,
        "pk": new_pk,
        "next_sk": sk2,
        "next_pk": pk2,
        "nkh": nkh2,
        "aid_raw": aid_raw,
        "digest": rot_digest,
    }


# ════════════════════════════════════════════════════════════════════
# Step 3: Deactivation Event
# ════════════════════════════════════════════════════════════════════

def generate_deactivation(rotation: dict) -> dict:
    """Generate a deactivation event with dual signatures."""
    print_header("TEST VECTOR 3: DEACTIVATION EVENT (dual-signature)")

    current_sk = rotation["sk"]
    current_pk = rotation["pk"]
    next_sk = rotation["next_sk"]
    next_pk = rotation["next_pk"]
    nkh = rotation["nkh"]
    aid_raw = rotation["aid_raw"]
    prev_digest = rotation["digest"]

    # Construct deactivation event
    event = {
        "v":   1,
        "t":   "deactivation",
        "aid": aid_raw,
        "s":   2,
        "p":   prev_digest,
        "ts":  "2026-02-15T12:00:00Z",
        "ns":  b"",                          # placeholder, filled after digest
        "d":   b"",
    }

    # Compute digest (exclude d, sig from hash input)
    hash_fields = {k: v for k, v in event.items() if k not in ("d", "sig")}
    canonical = cbor_det_encode(hash_fields)
    deact_digest = blake3_hash(canonical)
    event["d"] = deact_digest

    print(f"\n  [1] Event digest:")
    print_field("CBOR bytes (excl d,sig)", canonical)
    print_field("d = BLAKE3(above)", deact_digest)

    # Primary signature: current key (rotation key, sk1)
    sig = sign_ed25519(current_sk, deact_digest)
    event["sig"] = sig

    print(f"\n  [2] Primary signature (current key, sk1):")
    print_field("sig = Sign(sk1, d)", sig)
    ok1 = verify_ed25519(current_pk, deact_digest, sig)
    print_field("Verify(pk1, d, sig)", ok1)

    # Dual signature: next pre-committed key (sk2)
    ns = sign_ed25519(next_sk, deact_digest)
    event["ns"] = ns

    print(f"\n  [3] Next-key signature (sk2) — dual-sig:")
    print_field("ns = Sign(sk2, d)", ns)
    ok2 = verify_ed25519(next_pk, deact_digest, ns)
    print_field("Verify(pk2, d, ns)", ok2)

    # Verify: BLAKE3(pk2) should match rotation.n
    computed_nkh = blake3_hash(next_pk)
    nkh_ok = computed_nkh == nkh

    print(f"\n  [4] Dual-sig pre-rotation verification:")
    print_field("BLAKE3(pk2)", computed_nkh)
    print_field("rotation.n", nkh)
    print_field("MATCH", nkh_ok)
    assert nkh_ok, "Dual-sig pre-rotation check failed!"

    # Full CBOR
    full_cbor = cbor_det_encode(event)
    print(f"\n  [5] Full deactivation event (CBOR):")
    print_field("length", f"{len(full_cbor)} bytes")
    print_field("cbor_hex", full_cbor)

    return {"event": event, "digest": deact_digest}


# ════════════════════════════════════════════════════════════════════
# Step 4: E2E Encryption
# ════════════════════════════════════════════════════════════════════

def generate_e2e(inception: dict) -> dict:
    """Generate an E2E encryption example."""
    print_header("TEST VECTOR 4: END-TO-END ENCRYPTION")

    sender_aid = inception["aid_raw"]

    # Recipient: deterministic keypair at index 10
    recv_sk, recv_pk = derive_ed25519_keypair(10)
    recv_aid = blake3_hash(recv_pk)  # simplified recipient AID

    print(f"\n  [1] Participants:")
    print_field("sender_aid", sender_aid)
    print_field("recipient_ed25519_pk", recv_pk)
    print_field("recipient_aid (derived)", recv_aid)

    # Ephemeral X25519 keypair (deterministic from seed)
    eph_seed = blake3_hash(SEED + b"ephemeral-x25519")
    eph_sk = eph_seed  # raw 32-byte X25519 scalar
    eph_pk = nacl.bindings.crypto_scalarmult_base(eph_sk)

    print(f"\n  [2] Ephemeral X25519 keypair:")
    print_field("ephemeral_sk", eph_sk)
    print_field("ephemeral_pk", eph_pk)

    # Convert recipient Ed25519 pk to X25519
    recv_x25519_pk = nacl.bindings.crypto_sign_ed25519_pk_to_curve25519(recv_pk)

    print(f"\n  [3] Recipient key conversion (Ed25519 -> X25519):")
    print_field("recipient_x25519_pk", recv_x25519_pk)

    # X25519 DH -> shared secret
    shared_secret = nacl.bindings.crypto_scalarmult(eph_sk, recv_x25519_pk)

    print(f"\n  [4] X25519 Diffie-Hellman:")
    print_field("shared_secret", shared_secret)

    # HKDF-BLAKE3 key derivation
    salt = sender_aid + recv_aid
    info = b"autonym-e2e-v1"
    symmetric_key = hkdf_blake3(shared_secret, salt, info, 32)

    print(f"\n  [5] HKDF-BLAKE3 key derivation:")
    print_field("salt (sender_aid || recipient_aid)", salt)
    print_field("info", info)
    print_field("symmetric_key (32 bytes)", symmetric_key)

    # XChaCha20-Poly1305 AEAD encryption
    plaintext = b"Hello from Autonym agent!"
    timestamp = "2026-02-15T12:00:00Z"

    # Associated data: CBOR({from, to, ts, ephemeral_pk})
    ad_obj = {
        "from": sender_aid,
        "to":   recv_aid,
        "ts":   timestamp,
        "ephemeral_pk": eph_pk,
    }
    ad = cbor_det_encode(ad_obj)

    # Deterministic nonce for reproducibility (in production, use random 24 bytes)
    nonce = blake3_hash(SEED + b"nonce")[:24]

    print(f"\n  [6] Encryption:")
    print_field("plaintext", plaintext)
    print_field("plaintext (utf8)", plaintext.decode())
    print_field("associated_data (CBOR)", ad)
    print_field("ad length", f"{len(ad)} bytes")
    print_field("nonce (24 bytes)", nonce)

    ciphertext = nacl.bindings.crypto_aead_xchacha20poly1305_ietf_encrypt(
        plaintext, ad, nonce, symmetric_key
    )

    print_field("ciphertext", ciphertext)
    print_field("ciphertext length", f"{len(ciphertext)} bytes (includes 16-byte Poly1305 tag)")

    # Verify: recipient derives same shared secret via DH(recv_sk, eph_pk)
    recv_x25519_sk = nacl.bindings.crypto_sign_ed25519_sk_to_curve25519(
        bytes(recv_sk) + recv_pk
    )
    shared_secret_recv = nacl.bindings.crypto_scalarmult(recv_x25519_sk, eph_pk)

    # Decrypt
    decrypted = nacl.bindings.crypto_aead_xchacha20poly1305_ietf_decrypt(
        ciphertext, ad, nonce, symmetric_key
    )

    print(f"\n  [7] Verification:")
    print_field("recipient_shared_secret", shared_secret_recv)
    print_field("DH match", shared_secret_recv == shared_secret)
    print_field("decrypted", decrypted)
    print_field("decrypted (utf8)", decrypted.decode())
    print_field("Roundtrip OK", decrypted == plaintext)

    assert shared_secret_recv == shared_secret, "DH shared secrets do not match!"
    assert decrypted == plaintext, "Decryption failed!"

    return {
        "symmetric_key": symmetric_key,
        "nonce": nonce,
        "plaintext": plaintext,
        "ciphertext": ciphertext,
        "eph_pk": eph_pk,
        "shared_secret": shared_secret,
    }


# ════════════════════════════════════════════════════════════════════
# Main
# ════════════════════════════════════════════════════════════════════

def main():
    print("Autonym Protocol — Deterministic Test Vectors")
    print(f"Hash implementation: {HASH_IMPL}")
    print(f"Seed: {hexfmt(SEED)}  ({SEED.decode('ascii')})")
    print(f"Date: 2026-02-15")

    inception = generate_inception()
    rotation = generate_rotation(inception)
    generate_deactivation(rotation)
    generate_e2e(inception)

    print()
    print("=" * 72)
    print("  All test vectors generated successfully.")
    print("=" * 72)


if __name__ == "__main__":
    main()
