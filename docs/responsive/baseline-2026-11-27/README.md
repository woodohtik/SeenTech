# Layout guard — "before" (27 Nov 2026)

seen-ui-responsive-alignment-audit-task.md, phase 0. Screens and forms of the
CI test shop (fake data only) at 390 / 820 / 1024 / 1280, and `report.json`:
the guard's findings (e2e/golden/zz-layout-guard.spec.ts), CI run 45934235507.

First count: 151 fails (target-under-24 78, dialog-focus 36, dialog-role 24,
misaligned-row 7, field-height 6), 72 warnings.

Known blind spot of this first run: SmartSelect and DatePicker are not inputs,
so rows with them (the purchase order's item / quantity / price row, the new
order's customer / date / tailor row) are not measured until phase 1 marks
them `data-field-control`.
