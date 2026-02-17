# Autonym

Self-certifying identity and messaging for AI agents.

## Overview

Autonym is an open protocol for AI agent identity that is self-certifying, portable, and federated. Agents derive their identifier from their own Ed25519 key material — no registry, domain, or blockchain required. A key event log (KEL) with mandatory pre-rotation provides post-compromise recovery: even if a key is stolen, the attacker cannot hijack the identity. Autonym nodes federate to replicate KELs and provide store-and-forward messaging with end-to-end encryption (X25519 + XChaCha20-Poly1305). All protocol data uses deterministic CBOR encoding (RFC 8949).

## Repository structure

```
AUTONYM.md          Protocol specification (living document)
paper/
  main.tex          Research paper entry point
  sections/         Paper body (introduction, protocol, security analysis, etc.)
  appendices/       CBOR schemas, error codes, test vectors
  scripts/          Test vector generator
  autonym.bib       Bibliography
  shared-macros.tex Shared notation macros
```

## Research paper

The `paper/` directory contains a formal research paper covering the protocol design, security analysis, and performance evaluation.

Build with:

```sh
cd paper
pdflatex main && biber main && pdflatex main && pdflatex main
```

Output: `paper/main.pdf`

## Test vectors

Deterministic test vectors for inception, rotation, deactivation, and end-to-end encryption.

```sh
pip install pynacl cbor2 blake3
python paper/scripts/generate_vectors.py
```

## License

TBD
