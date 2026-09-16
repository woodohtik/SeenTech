// ZATCA Phase 6 (seen-zatca-readiness-task.md): this used to duplicate
// src/lib/zatca.ts's TLV/base64 QR encoding byte-for-byte (same algorithm,
// written twice) -- any future fix or the Phase 2 field 6-9 QR extension
// would only have been applied to whichever file someone happened to edit.
// src/lib/zatca.ts is the canonical implementation (it's the one actually
// wired into the live POS.tsx checkout path); this file now just re-exports
// it so every printing screen that imports generateZatcaQR from here keeps
// working unchanged.
export { generateZatcaQR } from '../lib/zatca';
