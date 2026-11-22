# ZATCA Phase 2 — compliance record

seen-readiness-fixes-task.md P2.6. This file records what has actually been checked. It does **not** say the system is approved: until every row in "Not yet run" passes, nothing customer-facing may say so.

## Checked (2026-11-22, staging)

| What | How | Result |
|---|---|---|
| Every document stamped at issue: next ICV, UUID, fixed lines | `supabase/staging-checks/zatca_documents_at_issue_test.sql` | PASS 12 |
| Signing strictly in ICV order; a stale PIH or a skipped document is refused; one signer per shop | same file | PASS |
| A credit note can't be edited or deleted from the browser (ZATCA-14) | same file | PASS |
| The Phase 1 QR and the first PIH have no line breaks (ZATCA-12) | same file | PASS |
| The queue: every invoice and credit note queued; retry with a growing delay; "failed" after 30 tries | `supabase/staging-checks/zatca_queue_test.sql` | PASS 5 |
| The XML: ICV, PIH (first = ZATCA's fixed value), QR, `cac:Signature`, TaxTotal twice, UBL order, standard (buyer, supply date), credit/debit notes (reference, reason) | `src/server/zatcaInvoiceXml.test.ts` | 44/44 |
| Hash: the same before the signature block exists and from the signed document; drops UBLExtensions, `cac:Signature`, the QR reference and the XML declaration | same | PASS |
| Signature: ECDSA secp256k1 in DER, verifies with the certificate's key | same | PASS |
| SignedProperties: the element in the document is the one whose digest is in SignedInfo | same | PASS |
| Phase 2 QR: tags 1–9 with the XML's values, one base64 string | same | PASS |
| The 30 truth-table sales: lines add up to the header | same | 30/30 |
| Ordered signer: PIH chain, fixed date/UUID, a broken document stops the chain | `src/server/zatcaChain.test.ts` | PASS |

The tests sign with a **test-only** self-signed key (`src/server/__fixtures__`). ZATCA has never seen these documents.

## Not yet run (needs ZATCA's tools or account)

1. **ZATCA SDK `fatoora -validate`** on the documents `zatcaInvoiceXml.test.ts` builds: XSD, schematron (EN 16931 and KSA rules), the hash and the signature as ZATCA computes them. The canonical form and the SignedProperties digest follow ZATCA's published algorithm, but only the SDK can confirm them byte for byte. Adding it to CI needs the SDK downloaded from ZATCA's developer portal (a Java tool).
2. **The sandbox (developer portal)**: CSR → compliance certificate → `/api/zatca/run-compliance-tests` now sends the six documents (standard and simplified invoice, credit note, debit note, chained ICV 1–6) → record each answer here.
3. **Simulation**, then production, with a real shop's OTP (the founder).

## Known gaps (left for the founder)

- Items marked "معفى" are reported as **not subject to VAT** (`O`, `VATEX-SA-OOS`). ZATCA does not accept an invoice that mixes `O` with taxed items; the tax adviser needs to give the right exemption code (`E` + a `VATEX-SA-…` code).
- The seller's **building number and district** (ZATCA-18) are written only when known; the shop settings don't collect them yet.
- The **environment** is not yet a per-shop field (ZATCA-04): compliance runs on the test environment, sending uses production.
- **Deposits** (ZATCA-13): an advance payment still has no invoice of its own; needs the tax adviser's rule.
- **The POS receipt** printed at the sale still carries the Phase 1 QR. A reprint shows the Phase 2 QR once the invoice is signed (seconds later when online). An offline sale can't be signed until it syncs.
