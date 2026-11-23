# Layout checks — baseline

Fixture backend, clock fixed at 2026-11-23T09:00:00.000Z. 329 states, **321 failing**.

| check | failing states |
|---|---|
| text under 14px | 321 |
| touch targets under 44px | 76 |
| overflow | 61 |
| text over text | 54 |
| a word a line | 49 |

## Failing states

| screen | width | dir | sidebar | assistant | main px | title lines | failures |
|---|---|---|---|---|---|---|---|
| dashboard | 360 | rtl | open → drawer | closed | 360 | 1 | overflow x1; text under 14px x43; touch targets under 44px x12 |
| dashboard | 360 | rtl | open → drawer | open → sheet | 360 | 1 | overflow x1; text under 14px x43; touch targets under 44px x16 |
| pos | 360 | rtl | open → drawer | closed | 360 | 1 | text under 14px x30; touch targets under 44px x16 |
| orders | 360 | rtl | open → drawer | closed | 360 | 1 | text under 14px x73; touch targets under 44px x42 |
| order-new | 360 | rtl | open → drawer | closed | 360 | 1 | text under 14px x73; touch targets under 44px x42 |
| customers | 360 | rtl | open → drawer | closed | 360 | 1 | text under 14px x93; touch targets under 44px x28 |
| inventory | 360 | rtl | open → drawer | closed | 360 | 1 | text under 14px x61; touch targets under 44px x26 |
| reports | 360 | rtl | open → drawer | closed | 360 | 1 | text under 14px x17; touch targets under 44px x5 |
| settings | 360 | rtl | open → drawer | closed | 360 | 1 | text under 14px x23; touch targets under 44px x4 |
| dashboard | 390 | rtl | open → drawer | closed | 390 | 1 | text under 14px x43; touch targets under 44px x12 |
| dashboard | 390 | rtl | open → drawer | open → sheet | 390 | 1 | text under 14px x43; touch targets under 44px x17 |
| pos | 390 | rtl | open → drawer | closed | 390 | 1 | text under 14px x30; touch targets under 44px x16 |
| orders | 390 | rtl | open → drawer | closed | 390 | 1 | text under 14px x75; touch targets under 44px x42 |
| order-new | 390 | rtl | open → drawer | closed | 390 | 1 | text under 14px x75; touch targets under 44px x42 |
| customers | 390 | rtl | open → drawer | closed | 390 | 1 | text under 14px x93; touch targets under 44px x29 |
| inventory | 390 | rtl | open → drawer | closed | 390 | 1 | text under 14px x61; touch targets under 44px x26 |
| reports | 390 | rtl | open → drawer | closed | 390 | 1 | text under 14px x17; touch targets under 44px x5 |
| settings | 390 | rtl | open → drawer | closed | 390 | 1 | text under 14px x23; touch targets under 44px x4 |
| dashboard | 768 | rtl | open → drawer | closed | 768 | 1 | text under 14px x59; touch targets under 44px x12 |
| dashboard | 768 | rtl | open → drawer | open → overlay 440px | 768 | 1 | text under 14px x59; touch targets under 44px x17 |
| pos | 768 | rtl | open → drawer | closed | 768 | 1 | a word a line x3; text over text x5; text under 14px x16; touch targets under 44px x18 |
| orders | 768 | rtl | open → drawer | closed | 768 | 1 | text under 14px x94; touch targets under 44px x42 |
| order-new | 768 | rtl | open → drawer | closed | 768 | 1 | text under 14px x94; touch targets under 44px x42 |
| customers | 768 | rtl | open → drawer | closed | 768 | 1 | text under 14px x93; touch targets under 44px x31 |
| inventory | 768 | rtl | open → drawer | closed | 768 | 1 | text under 14px x44; touch targets under 44px x13 |
| reports | 768 | rtl | open → drawer | closed | 768 | 1 | overflow x1; text under 14px x10 |
| settings | 768 | rtl | open → drawer | closed | 768 | 1 | text under 14px x29; touch targets under 44px x6 |
| dashboard | 1024 | rtl | open | closed | 768 | 1 | overflow x2; a word a line x1; text over text x2; text under 14px x94; touch targets under 44px x8 |
| dashboard | 1024 | rtl | open | open → overlay 440px | 768 | 1 | overflow x2; a word a line x1; text over text x2; text under 14px x94; touch targets under 44px x9 |
| dashboard | 1024 | rtl | open | expanded → overlay 640px | 768 | 1 | overflow x2; a word a line x1; text over text x2; text under 14px x94; touch targets under 44px x9 |
| dashboard | 1024 | rtl | collapsed | closed | 944 | 1 | text under 14px x95; touch targets under 44px x8 |
| dashboard | 1024 | rtl | collapsed | open → overlay 440px | 944 | 1 | text under 14px x95; touch targets under 44px x9 |
| dashboard | 1024 | rtl | collapsed | expanded → overlay 640px | 944 | 1 | text under 14px x95; touch targets under 44px x9 |
| pos | 1024 | rtl | open | closed | 768 | 1 | overflow x6; a word a line x3; text over text x5; text under 14px x14; touch targets under 44px x19 |
| pos | 1024 | rtl | open | open → overlay 440px | 768 | 1 | overflow x6; a word a line x3; text over text x5; text under 14px x14; touch targets under 44px x20 |
| pos | 1024 | rtl | open | expanded → overlay 640px | 768 | 1 | overflow x6; a word a line x3; text over text x5; text under 14px x14; touch targets under 44px x20 |
| pos | 1024 | rtl | collapsed | closed | 944 | 1 | a word a line x3; text over text x3; text under 14px x13; touch targets under 44px x19 |
| pos | 1024 | rtl | collapsed | open → overlay 440px | 944 | 1 | a word a line x3; text over text x3; text under 14px x13; touch targets under 44px x20 |
| pos | 1024 | rtl | collapsed | expanded → overlay 640px | 944 | 1 | a word a line x3; text over text x3; text under 14px x13; touch targets under 44px x20 |
| orders | 1024 | rtl | open | closed | 768 | 1 | text under 14px x50; touch targets under 44px x38 |
| orders | 1024 | rtl | open | open → overlay 440px | 768 | 1 | text under 14px x50; touch targets under 44px x39 |
| orders | 1024 | rtl | open | expanded → overlay 640px | 768 | 1 | text under 14px x50; touch targets under 44px x39 |
| orders | 1024 | rtl | collapsed | closed | 944 | 1 | text under 14px x49; touch targets under 44px x38 |
| orders | 1024 | rtl | collapsed | open → overlay 440px | 944 | 1 | text under 14px x49; touch targets under 44px x39 |
| orders | 1024 | rtl | collapsed | expanded → overlay 640px | 944 | 1 | text under 14px x49; touch targets under 44px x39 |
| order-new | 1024 | rtl | open | closed | 768 | 1 | text under 14px x50; touch targets under 44px x38 |
| order-new | 1024 | rtl | open | open → overlay 992px | 768 | 1 | text under 14px x90; touch targets under 44px x42 |
| order-new | 1024 | rtl | open | expanded → overlay 992px | 768 | 1 | text under 14px x90; touch targets under 44px x42 |
| order-new | 1024 | rtl | collapsed | closed | 944 | 1 | text under 14px x49; touch targets under 44px x38 |
| order-new | 1024 | rtl | collapsed | open → overlay 992px | 944 | 1 | text under 14px x89; touch targets under 44px x42 |
| order-new | 1024 | rtl | collapsed | expanded → overlay 992px | 944 | 1 | text under 14px x89; touch targets under 44px x42 |
| customers | 1024 | rtl | open | closed | 768 | 1 | text under 14px x48; touch targets under 44px x33 |
| customers | 1024 | rtl | open | open → overlay 440px | 768 | 1 | text under 14px x48; touch targets under 44px x34 |
| customers | 1024 | rtl | open | expanded → overlay 640px | 768 | 1 | text under 14px x48; touch targets under 44px x34 |
| customers | 1024 | rtl | collapsed | closed | 944 | 1 | text under 14px x47; touch targets under 44px x33 |
| customers | 1024 | rtl | collapsed | open → overlay 440px | 944 | 1 | text under 14px x47; touch targets under 44px x34 |
| customers | 1024 | rtl | collapsed | expanded → overlay 640px | 944 | 1 | text under 14px x47; touch targets under 44px x34 |
| inventory | 1024 | rtl | open | closed | 768 | 2 | text under 14px x23; touch targets under 44px x14 |
| inventory | 1024 | rtl | open | open → overlay 440px | 768 | 2 | text under 14px x23; touch targets under 44px x15 |
| inventory | 1024 | rtl | open | expanded → overlay 640px | 768 | 2 | text under 14px x23; touch targets under 44px x15 |
| inventory | 1024 | rtl | collapsed | closed | 944 | 1 | text under 14px x34; touch targets under 44px x14 |
| inventory | 1024 | rtl | collapsed | open → overlay 440px | 944 | 1 | text under 14px x34; touch targets under 44px x15 |
| inventory | 1024 | rtl | collapsed | expanded → overlay 640px | 944 | 1 | text under 14px x34; touch targets under 44px x15 |
| reports | 1024 | rtl | open | closed | 768 | 1 | overflow x4; text under 14px x4; touch targets under 44px x1 |
| reports | 1024 | rtl | open | open → overlay 440px | 768 | 1 | overflow x4; text under 14px x4; touch targets under 44px x2 |
| reports | 1024 | rtl | open | expanded → overlay 640px | 768 | 1 | overflow x4; text under 14px x4; touch targets under 44px x2 |
| reports | 1024 | rtl | collapsed | closed | 944 | 1 | overflow x3; text under 14px x7; touch targets under 44px x1 |
| reports | 1024 | rtl | collapsed | open → overlay 440px | 944 | 1 | overflow x3; text under 14px x7; touch targets under 44px x2 |
| reports | 1024 | rtl | collapsed | expanded → overlay 640px | 944 | 1 | overflow x3; text under 14px x7; touch targets under 44px x2 |
| settings | 1024 | rtl | open | closed | 768 | 1 | text under 14px x39; touch targets under 44px x20 |
| settings | 1024 | rtl | open | open → overlay 440px | 768 | 1 | text under 14px x39; touch targets under 44px x21 |
| settings | 1024 | rtl | open | expanded → overlay 640px | 768 | 1 | text under 14px x39; touch targets under 44px x21 |
| settings | 1024 | rtl | collapsed | closed | 944 | 1 | text under 14px x26; touch targets under 44px x8 |
| settings | 1024 | rtl | collapsed | open → overlay 440px | 944 | 1 | text under 14px x26; touch targets under 44px x9 |
| settings | 1024 | rtl | collapsed | expanded → overlay 640px | 944 | 1 | text under 14px x26; touch targets under 44px x9 |
| dashboard | 1280 | rtl | open | closed | 1024 | 1 | text under 14px x97 |
| dashboard | 1280 | rtl | open | open → docked 440px | 584 | 2 | overflow x22; a word a line x8; text over text x7; text under 14px x92 |
| dashboard | 1280 | rtl | open | expanded → docked 640px | 384 | 2 | overflow x63; a word a line x10; text over text x9; text under 14px x83 |
| dashboard | 1280 | rtl | collapsed | closed | 1200 | 1 | text under 14px x96 |
| dashboard | 1280 | rtl | collapsed | open → docked 440px | 760 | 1 | overflow x2; a word a line x1; text over text x2; text under 14px x93 |
| dashboard | 1280 | rtl | collapsed | expanded → docked 640px | 560 | 2 | overflow x25; a word a line x9; text over text x8; text under 14px x89 |
| pos | 1280 | rtl | open | closed | 1024 | 1 | a word a line x3; text over text x3; text under 14px x14 |
| pos | 1280 | rtl | open | open → docked 440px | 584 | 1 | overflow x1; text over text x9; text under 14px x14 |
| pos | 1280 | rtl | open | expanded → docked 640px | 384 | 1 | overflow x1; text over text x10; text under 14px x14 |
| pos | 1280 | rtl | collapsed | closed | 1200 | 1 | text under 14px x13 |
| pos | 1280 | rtl | collapsed | open → docked 440px | 760 | 1 | overflow x6; a word a line x3; text over text x7; text under 14px x13 |
| pos | 1280 | rtl | collapsed | expanded → docked 640px | 560 | 1 | overflow x1; text over text x9; text under 14px x13 |
| orders | 1280 | rtl | open | closed | 1024 | 1 | text under 14px x50 |
| orders | 1280 | rtl | open | open → docked 440px | 584 | 1 | text under 14px x50 |
| orders | 1280 | rtl | open | expanded → docked 640px | 384 | 1 | overflow x1; text under 14px x50 |
| orders | 1280 | rtl | collapsed | closed | 1200 | 1 | text under 14px x49 |
| orders | 1280 | rtl | collapsed | open → docked 440px | 760 | 1 | text under 14px x49 |
| orders | 1280 | rtl | collapsed | expanded → docked 640px | 560 | 1 | text under 14px x49 |
| order-new | 1280 | rtl | open | closed | 1024 | 1 | text under 14px x50 |
| order-new | 1280 | rtl | open | open → overlay 1024px | 1024 | 1 | text under 14px x90 |
| order-new | 1280 | rtl | open | expanded → overlay 1024px | 1024 | 1 | text under 14px x90 |
| order-new | 1280 | rtl | collapsed | closed | 1200 | 1 | text under 14px x49 |
| order-new | 1280 | rtl | collapsed | open → overlay 1024px | 1200 | 1 | text under 14px x89 |
| order-new | 1280 | rtl | collapsed | expanded → overlay 1024px | 1200 | 1 | text under 14px x89 |
| customers | 1280 | rtl | open | closed | 1024 | 1 | text under 14px x48 |
| customers | 1280 | rtl | open | open → docked 440px | 584 | 1 | a word a line x3; text over text x14; text under 14px x48 |
| customers | 1280 | rtl | open | expanded → docked 640px | 384 | 1 | a word a line x3; text over text x28; text under 14px x44 |
| customers | 1280 | rtl | collapsed | closed | 1200 | 1 | text under 14px x47 |
| customers | 1280 | rtl | collapsed | open → docked 440px | 760 | 1 | text over text x1; text under 14px x47 |
| customers | 1280 | rtl | collapsed | expanded → docked 640px | 560 | 1 | a word a line x3; text over text x14; text under 14px x47 |
| inventory | 1280 | rtl | open | closed | 1024 | 1 | text under 14px x35 |
| inventory | 1280 | rtl | open | open → docked 440px | 584 | 2 | text under 14px x31 |
| inventory | 1280 | rtl | open | expanded → docked 640px | 384 | 2 | text under 14px x31 |
| inventory | 1280 | rtl | collapsed | closed | 1200 | 1 | text under 14px x40 |
| inventory | 1280 | rtl | collapsed | open → docked 440px | 760 | 2 | text under 14px x40 |
| inventory | 1280 | rtl | collapsed | expanded → docked 640px | 560 | 2 | text under 14px x36 |
| reports | 1280 | rtl | open | closed | 1024 | 1 | overflow x2; text under 14px x8 |
| reports | 1280 | rtl | open | open → docked 440px | 584 | 2 | overflow x2; text under 14px x4 |
| reports | 1280 | rtl | open | expanded → docked 640px | 384 | 3 | overflow x2; a word a line x1; text under 14px x4 |
| reports | 1280 | rtl | collapsed | closed | 1200 | 1 | text under 14px x7 |
| reports | 1280 | rtl | collapsed | open → docked 440px | 760 | 1 | overflow x2; text under 14px x3 |
| reports | 1280 | rtl | collapsed | expanded → docked 640px | 560 | 2 | overflow x2; text under 14px x3 |
| settings | 1280 | rtl | open | closed | 1024 | 1 | text under 14px x40 |
| settings | 1280 | rtl | open | open → docked 440px | 584 | 1 | text under 14px x40 |
| settings | 1280 | rtl | open | expanded → docked 640px | 384 | 1 | overflow x3; a word a line x5; text under 14px x40 |
| settings | 1280 | rtl | collapsed | closed | 1200 | 1 | text under 14px x27 |
| settings | 1280 | rtl | collapsed | open → docked 440px | 760 | 1 | text under 14px x27 |
| settings | 1280 | rtl | collapsed | expanded → docked 640px | 560 | 1 | text under 14px x27 |
| dashboard | 1366 | rtl | open | closed | 1110 | 1 | text under 14px x97 |
| dashboard | 1366 | rtl | open | open → docked 440px | 670 | 2 | overflow x5; a word a line x4; text over text x3; text under 14px x93 |
| dashboard | 1366 | rtl | open | expanded → docked 640px | 470 | 2 | overflow x47; a word a line x11; text over text x4; text under 14px x89 |
| dashboard | 1366 | rtl | collapsed | closed | 1286 | 1 | text under 14px x96 |
| dashboard | 1366 | rtl | collapsed | open → docked 440px | 846 | 1 | a word a line x1; text over text x1; text under 14px x94 |
| dashboard | 1366 | rtl | collapsed | expanded → docked 640px | 646 | 2 | overflow x8; a word a line x4; text over text x6; text under 14px x92 |
| pos | 1366 | rtl | open | closed | 1110 | 1 | a word a line x1; text over text x1; text under 14px x14 |
| pos | 1366 | rtl | open | open → docked 440px | 670 | 1 | text over text x1; text under 14px x14 |
| pos | 1366 | rtl | open | expanded → docked 640px | 470 | 1 | overflow x1; text over text x10; text under 14px x14 |
| pos | 1366 | rtl | collapsed | closed | 1286 | 1 | text under 14px x13 |
| pos | 1366 | rtl | collapsed | open → docked 440px | 846 | 1 | overflow x6; a word a line x3; text over text x3; text under 14px x13 |
| pos | 1366 | rtl | collapsed | expanded → docked 640px | 646 | 1 | text over text x9; text under 14px x13 |
| orders | 1366 | rtl | open | closed | 1110 | 1 | text under 14px x50 |
| orders | 1366 | rtl | open | open → docked 440px | 670 | 1 | text under 14px x50 |
| orders | 1366 | rtl | open | expanded → docked 640px | 470 | 1 | overflow x1; text under 14px x50 |
| orders | 1366 | rtl | collapsed | closed | 1286 | 1 | text under 14px x49 |
| orders | 1366 | rtl | collapsed | open → docked 440px | 846 | 1 | text under 14px x49 |
| orders | 1366 | rtl | collapsed | expanded → docked 640px | 646 | 1 | text under 14px x49 |
| order-new | 1366 | rtl | open | closed | 1110 | 1 | text under 14px x50 |
| order-new | 1366 | rtl | open | open → overlay 1024px | 1110 | 1 | text under 14px x90 |
| order-new | 1366 | rtl | open | expanded → overlay 1024px | 1110 | 1 | text under 14px x90 |
| order-new | 1366 | rtl | collapsed | closed | 1286 | 1 | text under 14px x49 |
| order-new | 1366 | rtl | collapsed | open → overlay 1024px | 1286 | 1 | text under 14px x89 |
| order-new | 1366 | rtl | collapsed | expanded → overlay 1024px | 1286 | 1 | text under 14px x89 |
| customers | 1366 | rtl | open | closed | 1110 | 1 | text under 14px x48 |
| customers | 1366 | rtl | open | open → docked 440px | 670 | 1 | a word a line x1; text over text x2; text under 14px x48 |
| customers | 1366 | rtl | open | expanded → docked 640px | 470 | 1 | overflow x3; a word a line x3; text over text x21; text under 14px x48 |
| customers | 1366 | rtl | collapsed | closed | 1286 | 1 | text under 14px x47 |
| customers | 1366 | rtl | collapsed | open → docked 440px | 846 | 1 | text under 14px x47 |
| customers | 1366 | rtl | collapsed | expanded → docked 640px | 646 | 1 | a word a line x1; text over text x2; text under 14px x47 |
| inventory | 1366 | rtl | open | closed | 1110 | 1 | text under 14px x35 |
| inventory | 1366 | rtl | open | open → docked 440px | 670 | 2 | text under 14px x35 |
| inventory | 1366 | rtl | open | expanded → docked 640px | 470 | 2 | text under 14px x31 |
| inventory | 1366 | rtl | collapsed | closed | 1286 | 1 | text under 14px x40 |
| inventory | 1366 | rtl | collapsed | open → docked 440px | 846 | 2 | text under 14px x40 |
| inventory | 1366 | rtl | collapsed | expanded → docked 640px | 646 | 2 | text under 14px x40 |
| reports | 1366 | rtl | open | closed | 1110 | 1 | overflow x2; text under 14px x8 |
| reports | 1366 | rtl | open | open → docked 440px | 670 | 1 | overflow x2; text under 14px x4 |
| reports | 1366 | rtl | open | expanded → docked 640px | 470 | 3 | overflow x2; a word a line x1; text under 14px x4 |
| reports | 1366 | rtl | collapsed | closed | 1286 | 1 | text under 14px x7 |
| reports | 1366 | rtl | collapsed | open → docked 440px | 846 | 1 | overflow x2; text under 14px x7 |
| reports | 1366 | rtl | collapsed | expanded → docked 640px | 646 | 2 | overflow x2; text under 14px x3 |
| settings | 1366 | rtl | open | closed | 1110 | 1 | text under 14px x41 |
| settings | 1366 | rtl | open | open → docked 440px | 670 | 1 | text under 14px x41 |
| settings | 1366 | rtl | open | expanded → docked 640px | 470 | 1 | a word a line x2; text under 14px x41 |
| settings | 1366 | rtl | collapsed | closed | 1286 | 1 | text under 14px x28 |
| settings | 1366 | rtl | collapsed | open → docked 440px | 846 | 1 | text under 14px x28 |
| settings | 1366 | rtl | collapsed | expanded → docked 640px | 646 | 1 | text under 14px x28 |
| dashboard | 1440 | rtl | open | closed | 1184 | 1 | text under 14px x97 |
| dashboard | 1440 | rtl | open | open → docked 440px | 744 | 1 | overflow x3; a word a line x2; text over text x3; text under 14px x94 |
| dashboard | 1440 | rtl | open | expanded → docked 640px | 544 | 2 | overflow x31; a word a line x9; text over text x7; text under 14px x90 |
| dashboard | 1440 | rtl | collapsed | closed | 1360 | 1 | text under 14px x96 |
| dashboard | 1440 | rtl | collapsed | open → docked 440px | 920 | 1 | text under 14px x95 |
| dashboard | 1440 | rtl | collapsed | expanded → docked 640px | 720 | 2 | overflow x4; a word a line x3; text over text x2; text under 14px x92 |
| pos | 1440 | rtl | open | closed | 1184 | 1 | text under 14px x14 |
| pos | 1440 | rtl | open | open → docked 440px | 744 | 1 | overflow x12; a word a line x3; text over text x5; text under 14px x14 |
| pos | 1440 | rtl | open | expanded → docked 640px | 544 | 1 | overflow x1; text over text x9; text under 14px x14 |
| pos | 1440 | rtl | collapsed | closed | 1360 | 1 | text under 14px x13 |
| pos | 1440 | rtl | collapsed | open → docked 440px | 920 | 1 | a word a line x3; text over text x3; text under 14px x13 |
| pos | 1440 | rtl | collapsed | expanded → docked 640px | 720 | 1 | overflow x12; text over text x1; text under 14px x13 |
| orders | 1440 | rtl | open | closed | 1184 | 1 | text under 14px x50 |
| orders | 1440 | rtl | open | open → docked 440px | 744 | 1 | text under 14px x50 |
| orders | 1440 | rtl | open | expanded → docked 640px | 544 | 1 | text under 14px x50 |
| orders | 1440 | rtl | collapsed | closed | 1360 | 1 | text under 14px x49 |
| orders | 1440 | rtl | collapsed | open → docked 440px | 920 | 1 | text under 14px x49 |
| orders | 1440 | rtl | collapsed | expanded → docked 640px | 720 | 1 | text under 14px x49 |
| order-new | 1440 | rtl | open | closed | 1184 | 1 | text under 14px x50 |
| order-new | 1440 | rtl | open | open → overlay 1024px | 1184 | 1 | text under 14px x90 |
| order-new | 1440 | rtl | open | expanded → overlay 1024px | 1184 | 1 | text under 14px x90 |
| order-new | 1440 | rtl | collapsed | closed → overlay 1024px | 1360 | 1 | text under 14px x49 |
| order-new | 1440 | rtl | collapsed | open → overlay 1024px | 1360 | 1 | text under 14px x89 |
| order-new | 1440 | rtl | collapsed | expanded → overlay 1024px | 1360 | 1 | text under 14px x89 |
| customers | 1440 | rtl | open | closed | 1184 | 1 | text under 14px x48 |
| customers | 1440 | rtl | open | open → docked 440px | 744 | 1 | a word a line x1; text over text x1; text under 14px x48 |
| customers | 1440 | rtl | open | expanded → docked 640px | 544 | 1 | a word a line x3; text over text x14; text under 14px x48 |
| customers | 1440 | rtl | collapsed | closed | 1360 | 1 | text under 14px x47 |
| customers | 1440 | rtl | collapsed | open → docked 440px | 920 | 1 | text under 14px x47 |
| customers | 1440 | rtl | collapsed | expanded → docked 640px | 720 | 1 | a word a line x1; text over text x1; text under 14px x47 |
| inventory | 1440 | rtl | open | closed | 1184 | 1 | text under 14px x41 |
| inventory | 1440 | rtl | open | open → docked 440px | 744 | 2 | text under 14px x41 |
| inventory | 1440 | rtl | open | expanded → docked 640px | 544 | 2 | text under 14px x37 |
| inventory | 1440 | rtl | collapsed | closed | 1360 | 1 | text under 14px x40 |
| inventory | 1440 | rtl | collapsed | open → docked 440px | 920 | 1 | text under 14px x40 |
| inventory | 1440 | rtl | collapsed | expanded → docked 640px | 720 | 2 | text under 14px x40 |
| reports | 1440 | rtl | open | closed | 1184 | 1 | text under 14px x8 |
| reports | 1440 | rtl | open | open → docked 440px | 744 | 1 | overflow x2; text under 14px x4 |
| reports | 1440 | rtl | open | expanded → docked 640px | 544 | 2 | overflow x2; text under 14px x4 |
| reports | 1440 | rtl | collapsed | closed | 1360 | 1 | text under 14px x7 |
| reports | 1440 | rtl | collapsed | open → docked 440px | 920 | 1 | overflow x2; text under 14px x7 |
| reports | 1440 | rtl | collapsed | expanded → docked 640px | 720 | 1 | overflow x2; text under 14px x3 |
| settings | 1440 | rtl | open | closed | 1184 | 1 | text under 14px x41 |
| settings | 1440 | rtl | open | open → docked 440px | 744 | 1 | text under 14px x41 |
| settings | 1440 | rtl | open | expanded → docked 640px | 544 | 1 | text under 14px x41 |
| settings | 1440 | rtl | collapsed | closed | 1360 | 1 | text under 14px x28 |
| settings | 1440 | rtl | collapsed | open → docked 440px | 920 | 1 | text under 14px x28 |
| settings | 1440 | rtl | collapsed | expanded → docked 640px | 720 | 1 | text under 14px x28 |
| dashboard | 1536 | rtl | open | closed | 1280 | 1 | text under 14px x97 |
| dashboard | 1536 | rtl | open | open → docked 440px | 840 | 1 | a word a line x1; text over text x1; text under 14px x95 |
| dashboard | 1536 | rtl | open | expanded → docked 640px | 640 | 2 | overflow x11; a word a line x4; text over text x5; text under 14px x93 |
| dashboard | 1536 | rtl | collapsed | closed | 1456 | 1 | text under 14px x96 |
| dashboard | 1536 | rtl | collapsed | open → docked 440px | 1016 | 1 | text under 14px x96 |
| dashboard | 1536 | rtl | collapsed | expanded → docked 640px | 816 | 1 | a word a line x1; text over text x2; text under 14px x94 |
| pos | 1536 | rtl | open | closed | 1280 | 1 | text under 14px x14 |
| pos | 1536 | rtl | open | open → docked 440px | 840 | 1 | overflow x6; a word a line x3; text over text x3; text under 14px x14 |
| pos | 1536 | rtl | open | expanded → docked 640px | 640 | 1 | text over text x9; text under 14px x14 |
| pos | 1536 | rtl | collapsed | closed | 1456 | 1 | text under 14px x13 |
| pos | 1536 | rtl | collapsed | open → docked 440px | 1016 | 1 | a word a line x3; text over text x3; text under 14px x13 |
| pos | 1536 | rtl | collapsed | expanded → docked 640px | 816 | 1 | overflow x6; a word a line x3; text over text x3; text under 14px x13 |
| orders | 1536 | rtl | open | closed | 1280 | 1 | text under 14px x50 |
| orders | 1536 | rtl | open | open → docked 440px | 840 | 1 | text under 14px x50 |
| orders | 1536 | rtl | open | expanded → docked 640px | 640 | 1 | text under 14px x50 |
| orders | 1536 | rtl | collapsed | closed | 1456 | 1 | text under 14px x49 |
| orders | 1536 | rtl | collapsed | open → docked 440px | 1016 | 1 | text under 14px x49 |
| orders | 1536 | rtl | collapsed | expanded → docked 640px | 816 | 1 | text under 14px x49 |
| order-new | 1536 | rtl | open | closed | 1280 | 1 | text under 14px x50 |
| order-new | 1536 | rtl | open | open → overlay 1024px | 1280 | 1 | text under 14px x90 |
| order-new | 1536 | rtl | open | expanded → overlay 1024px | 1280 | 1 | text under 14px x90 |
| order-new | 1536 | rtl | collapsed | closed | 1456 | 1 | text under 14px x49 |
| order-new | 1536 | rtl | collapsed | open → overlay 1024px | 1456 | 1 | text under 14px x89 |
| order-new | 1536 | rtl | collapsed | expanded → overlay 1024px | 1456 | 1 | text under 14px x89 |
| customers | 1536 | rtl | open | closed | 1280 | 1 | text under 14px x48 |
| customers | 1536 | rtl | open | open → docked 440px | 840 | 1 | text under 14px x48 |
| customers | 1536 | rtl | open | expanded → docked 640px | 640 | 1 | a word a line x1; text over text x7; text under 14px x48 |
| customers | 1536 | rtl | collapsed | closed | 1456 | 1 | text under 14px x47 |
| customers | 1536 | rtl | collapsed | open → docked 440px | 1016 | 1 | text under 14px x47 |
| customers | 1536 | rtl | collapsed | expanded → docked 640px | 816 | 1 | text under 14px x47 |
| inventory | 1536 | rtl | open | closed | 1280 | 1 | text under 14px x41 |
| inventory | 1536 | rtl | open | open → docked 440px | 840 | 2 | text under 14px x41 |
| inventory | 1536 | rtl | open | expanded → docked 640px | 640 | 2 | text under 14px x41 |
| inventory | 1536 | rtl | collapsed | closed | 1456 | 1 | text under 14px x40 |
| inventory | 1536 | rtl | collapsed | open → docked 440px | 1016 | 1 | text under 14px x40 |
| inventory | 1536 | rtl | collapsed | expanded → docked 640px | 816 | 2 | text under 14px x40 |
| reports | 1536 | rtl | open | closed | 1280 | 1 | text under 14px x8 |
| reports | 1536 | rtl | open | open → docked 440px | 840 | 1 | overflow x2; text under 14px x8 |
| reports | 1536 | rtl | open | expanded → docked 640px | 640 | 2 | overflow x2; text under 14px x4 |
| reports | 1536 | rtl | collapsed | closed | 1456 | 1 | text under 14px x7 |
| reports | 1536 | rtl | collapsed | open → docked 440px | 1016 | 1 | overflow x2; text under 14px x7 |
| reports | 1536 | rtl | collapsed | expanded → docked 640px | 816 | 1 | overflow x2; text under 14px x7 |
| settings | 1536 | rtl | open | closed | 1280 | 1 | text under 14px x42 |
| settings | 1536 | rtl | open | open → docked 440px | 840 | 1 | text under 14px x42 |
| settings | 1536 | rtl | open | expanded → docked 640px | 640 | 1 | text under 14px x42 |
| settings | 1536 | rtl | collapsed | closed | 1456 | 1 | text under 14px x29 |
| settings | 1536 | rtl | collapsed | open → docked 440px | 1016 | 1 | text under 14px x29 |
| settings | 1536 | rtl | collapsed | expanded → docked 640px | 816 | 1 | text under 14px x29 |
| dashboard | 1920 | rtl | open | closed | 1664 | 1 | text under 14px x97 |
| dashboard | 1920 | rtl | open | open → docked 440px | 1224 | 1 | text under 14px x97 |
| dashboard | 1920 | rtl | open | expanded → docked 640px | 1024 | 1 | text under 14px x97 |
| dashboard | 1920 | rtl | collapsed | closed | 1840 | 1 | text under 14px x96 |
| dashboard | 1920 | rtl | collapsed | open → docked 440px | 1400 | 1 | text under 14px x96 |
| dashboard | 1920 | rtl | collapsed | expanded → docked 640px | 1200 | 1 | text under 14px x96 |
| pos | 1920 | rtl | open | closed | 1664 | 1 | text under 14px x14 |
| pos | 1920 | rtl | open | open → docked 440px | 1224 | 1 | text under 14px x14 |
| pos | 1920 | rtl | open | expanded → docked 640px | 1024 | 1 | a word a line x3; text over text x3; text under 14px x14 |
| pos | 1920 | rtl | collapsed | closed | 1840 | 1 | text under 14px x13 |
| pos | 1920 | rtl | collapsed | open → docked 440px | 1400 | 1 | text under 14px x13 |
| pos | 1920 | rtl | collapsed | expanded → docked 640px | 1200 | 1 | text under 14px x13 |
| orders | 1920 | rtl | open | closed | 1664 | 1 | text under 14px x50 |
| orders | 1920 | rtl | open | open → docked 440px | 1224 | 1 | text under 14px x50 |
| orders | 1920 | rtl | open | expanded → docked 640px | 1024 | 1 | text under 14px x50 |
| orders | 1920 | rtl | collapsed | closed | 1840 | 1 | text under 14px x49 |
| orders | 1920 | rtl | collapsed | open → docked 440px | 1400 | 1 | text under 14px x49 |
| orders | 1920 | rtl | collapsed | expanded → docked 640px | 1200 | 1 | text under 14px x49 |
| order-new | 1920 | rtl | open | closed | 1664 | 1 | text under 14px x50 |
| order-new | 1920 | rtl | open | open → overlay 1024px | 1664 | 1 | text under 14px x90 |
| order-new | 1920 | rtl | open | expanded → overlay 1024px | 1664 | 1 | text under 14px x90 |
| order-new | 1920 | rtl | collapsed | closed | 1840 | 1 | text under 14px x49 |
| order-new | 1920 | rtl | collapsed | open → overlay 1024px | 1840 | 1 | text under 14px x89 |
| order-new | 1920 | rtl | collapsed | expanded → overlay 1024px | 1840 | 1 | text under 14px x89 |
| customers | 1920 | rtl | open | closed | 1664 | 1 | text under 14px x48 |
| customers | 1920 | rtl | open | open → docked 440px | 1224 | 1 | text under 14px x48 |
| customers | 1920 | rtl | open | expanded → docked 640px | 1024 | 1 | text under 14px x48 |
| customers | 1920 | rtl | collapsed | closed | 1840 | 1 | text under 14px x47 |
| customers | 1920 | rtl | collapsed | open → docked 440px | 1400 | 1 | text under 14px x47 |
| customers | 1920 | rtl | collapsed | expanded → docked 640px | 1200 | 1 | text under 14px x47 |
| inventory | 1920 | rtl | open | closed | 1664 | 1 | text under 14px x41 |
| inventory | 1920 | rtl | open | open → docked 440px | 1224 | 1 | text under 14px x41 |
| inventory | 1920 | rtl | open | expanded → docked 640px | 1024 | 1 | text under 14px x41 |
| inventory | 1920 | rtl | collapsed | closed | 1840 | 1 | text under 14px x40 |
| inventory | 1920 | rtl | collapsed | open → docked 440px | 1400 | 1 | text under 14px x40 |
| inventory | 1920 | rtl | collapsed | expanded → docked 640px | 1200 | 1 | text under 14px x40 |
| reports | 1920 | rtl | open | closed | 1664 | 1 | text under 14px x8 |
| reports | 1920 | rtl | open | open → docked 440px | 1224 | 1 | text under 14px x8 |
| reports | 1920 | rtl | open | expanded → docked 640px | 1024 | 1 | overflow x2; text under 14px x8 |
| reports | 1920 | rtl | collapsed | closed | 1840 | 1 | text under 14px x7 |
| reports | 1920 | rtl | collapsed | open → docked 440px | 1400 | 1 | text under 14px x7 |
| reports | 1920 | rtl | collapsed | expanded → docked 640px | 1200 | 1 | text under 14px x7 |
| settings | 1920 | rtl | open | closed | 1664 | 1 | text under 14px x44 |
| settings | 1920 | rtl | open | open → docked 440px | 1224 | 1 | text under 14px x45 |
| settings | 1920 | rtl | open | expanded → docked 640px | 1024 | 1 | text under 14px x45 |
| settings | 1920 | rtl | collapsed | closed | 1840 | 1 | text under 14px x30 |
| settings | 1920 | rtl | collapsed | open → docked 440px | 1400 | 1 | text under 14px x32 |
| settings | 1920 | rtl | collapsed | expanded → docked 640px | 1200 | 1 | text under 14px x32 |
| dashboard | 360 | ltr | open → drawer | closed | 360 | 1 | overflow x2; a word a line x1; text under 14px x41; touch targets under 44px x12 |
| orders | 360 | ltr | open → drawer | closed | 360 | 1 | text under 14px x83; touch targets under 44px x42 |
| dashboard | 1280 | ltr | open | closed | 1024 | 1 | text under 14px x108 |
| orders | 1280 | ltr | open | closed | 1024 | 1 | text under 14px x53 |
| dashboard | 1920 | ltr | open | closed | 1664 | 1 | text under 14px x109 |
| orders | 1920 | ltr | open | closed | 1664 | 1 | text under 14px x53 |

## Passing states

| screen | width | dir | sidebar | assistant | main px | title lines | failures |
|---|---|---|---|---|---|---|---|
| dashboard | 320 | rtl | open → drawer | closed | 320 | 1 | ok |
| pos | 320 | rtl | open → drawer | closed | 320 | 2 | ok |
| orders | 320 | rtl | open → drawer | closed | 320 | 1 | ok |
| order-new | 320 | rtl | open → drawer | closed | 320 | 1 | ok |
| customers | 320 | rtl | open → drawer | closed | 320 | 1 | ok |
| inventory | 320 | rtl | open → drawer | closed | 320 | 1 | ok |
| reports | 320 | rtl | open → drawer | closed | 320 | 2 | ok |
| settings | 320 | rtl | open → drawer | closed | 320 | 1 | ok |


## Requests with no fixture (answered empty)

- GET /api/tenant/settings
- GET table/order_history
- POST rpc/get_shift_cash_balance
- POST rpc/reserve_offline_numbers
