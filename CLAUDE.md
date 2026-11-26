## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- When graphify-out/graph.json exists, run `graphify query "<question>"` before your first grep, search or source-file read for a codebase question, and put this rule in every subagent prompt that explores code. Read raw files only for lines the graph or an earlier read already located. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.

## قواعد الجودة (seen-stability-guardrails-task.md)

هذه القواعد تمنع دائرة «نصلّح شي فيخرب شي ثاني». تنطبق على كل تعديل.

1. **قبل أي تعديل:** `graphify query "<ما ستغيّره>"` لمعرفة الملفات والشاشات المتأثرة، وقائمتها تُكتب في وصف الـ PR (والـ commit) تحت «قد يتأثر».
2. **لا إصلاح بدون اختبار.** أي خطأ يُصلح، يُكتب له **أولاً** اختبار يفشل بسببه، ثم يُصلح فينجح. والاختبار يبقى للأبد:
   - في `supabase/tests/` لقاعدة البيانات.
   - بجانب الملف (`*.test.ts(x)`) للواجهة.
   - في `e2e/golden/` للمسار الكامل.
3. **الدوال من اللقطة، لا من migration قديم.**
   - إعادة تعريف دالة قاعدة بيانات تبدأ **دائماً** من ملفها في `supabase/schema/functions/`، أي آخر نسخة.
   - **ممنوع النسخ من ملف migration قديم**، فهذا ما أضاع سلسلة زاتكا وفحص سلة المحذوفات من قبل.
   - بعد أي migration تغيّر دالة: `npx tsx scripts/db/snapshot-functions.ts --linked` (من staging بعد تطبيقها)، وتُحفظ اللقطة في نفس الـ commit.
   - أي سطر محذوف من دالة حساسة يحتاج سطر تبرير في الوصف: `create_pos_sale`، `app_current_tenant_id`، `update_order_status*`، `record_order_payment`، `close_shift`، `process_sales_return`، `issue_tax_invoice*`.
4. **بعد أي تعديل:**
   - `npm run lint`، و`npm run test`، واختبارات قاعدة البيانات (`npx tsx scripts/db/pgtap-linked.ts` على staging، أو `supabase test db` محلياً)، والمسارات الذهبية.
   - **ما يُقال «تم» والفحص أحمر**، ولا يُقال «جاهز» قبل `docs/release-checklist.md`.
5. **لا دفع مباشر لـ `main`.** الإنتاج عبر Pull Request من `staging` وبموافقة المؤسس («ادفع»).
6. **الملفات العملاقة** (`POS.tsx`، `Orders.tsx`، `server.ts`، `Customers.tsx`، `Staff.tsx`):
   - لا إعادة كتابة شاملة الآن.
   - أي ميزة جديدة تُكتب في ملف أو مكوّن مستقل.
   - أي جزء يُلمس بتعديل كبير يُستخرج لملفه. والهدف ألا تكبر هذه الملفات.
7. **المهام:**
   - قبل بدء أي مهمة: حدّث حالتها في `docs/tasks/INDEX.md`، وانقل ملفها من الجذر إلى `docs/tasks/`.
   - لا تُعتبر «منتهية» إلا ومعايير القبول كلها ✅ والاختبارات مكتوبة.
8. **المستودع عام:** لا يُحفظ في git أي ملف مهمة أو مراجعة أو تقرير أمني أو ملف فيه بيانات عملاء. هذه في `docs/tasks/` و`docs/reviews/` و`docs/founder/`، وهي خارج git (`.gitignore`).
