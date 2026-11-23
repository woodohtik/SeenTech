# ux-probes

The eight browser probes of **ux-ui-audit v1.0.0** by UXBYISSA
(https://github.com/uxbyissa/ux-ui-audit), copied unchanged, with their MIT
licence (`LICENSE`), as `seen-responsive-layout-task.md` Phase 0 asks.

`scripts/responsive-snapshots.ts` evaluates `probe-core`, `probe-rtl`,
`probe-heuristics` and `probe-perception` inside each screen at the four
report widths. Their output is a list of leads to read, not a report: the raw
JSON goes to `.responsive-out/<label>/probes/` and is not committed.

`probe-focus` needs a real Tab keypress first, `probe-routes` issues real GETs,
and `probe-ltr` / `probe-parity` are for the English and bilingual passes --
they are here for the final audit, not run by the snapshot tool.

Do not edit these files: update them by copying a newer release over them.
