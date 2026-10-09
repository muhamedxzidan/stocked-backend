# Blueprint استكمال عقود القراءة — 2026-10-09

الحالة: اعتمد المستخدم التصميم بعبارة «اوك»؛ نفذ النطاق واختبرت حالات العقد المحددة. نتائج الفحوص النهائية في القسم 17 من BACKEND_PROGRESS. نقطة البدء `dea05f7` والملفات نظيفة. لا Graphify backend موجود؛ استخدم BACKEND_PROGRESS وخريطة الملفات في تقرير المراجعة ثم المصادر المحددة. Antigravity تعذر في المرحلة السابقة بسبب quota429؛ لم تكرر محاولة الحصة نفسها، ولم تدع مراجعة مستقلة.

## الغرض

جعل عقود query للجرد تقبل الفلاتر المنفذة فقط، وتوثيق الردود الحالية للمخزون والاستلام والتسويات في OpenAPI، بحيث يستطيع العميل اللاحق الاعتماد على عقد حقيقي. الباك إند وحده؛ Flutter مرجع قواعد وليس نطاق التنفيذ.

## Current Flow / Data Flow

`HTTP → global validation/session/password/roles guards → feature Controller → Read/operation Service → Prisma select + scope → JSON`.

الجرد: list يستخدم merchantId/status؛ lines يستخدم merchantId/shelfId؛ scopes يستخدم merchantId؛ events يستخدم pagination فقط وstaff-only. إعادة استخدام ListStocktakesDto في scopes/events ووجود status في lines يقبل حقولًا لا تستعملها الخدمة.

المخزون: InventoryService يرجع balance/صفحة balances، وmovement/صفحة movements بمصادر receipt/adjustment/shipment/return المتداخلة. updatedAt nullable للصنف الذي لا رصيد له. الاستلام: receiptSelect يحدد header وبنودها ومصدر الحركة؛ التسويات: adjustmentSelect يحدد header وصنفها ومصدر receipt أو stocktakeLineId ومعلومات الحركة. POST الاستلام والتسويات يرجع201 أول مرة و200 عند الإعادة بنفس JSON. Controllers فيها response decorators بلا type ولا schema كاملة.

## Structure / Class Map

- query DTO لكل contract حقيقي: list، lines، scopes، events. يملك validation ووصف الفلاتر فقط؛ لا base classes لمشاركة decorators.
- response DTO محلي لكل feature: ميزان/حركة ومصادرها، استلام وبند، تسوية ومصدرها، وصفحات النتائج. مسؤوليتها وصف JSON الفعلي فقط، لا منطق أو تخزين.
- Controller يحدد DTO/Swagger ويرسل إلى نفس Service.
- الخدمات الحالية تظل قواعد العملية/الملكية والمعاملة؛ تغير أنواع query فقط حيث يلزم. guards وSQL والـ posting لا تتغير.
- Widget tree غير منطبق لأن النطاق backend-only.

## Files Map

| الملف | السبب |
| --- | --- |
| src/stocktakes/dto/stocktake.dto.ts + stocktake-query.dto.ts عند الفصل | تضييق/تنظيم DTO القراءة دون تغيير DTO الأوامر |
| src/stocktakes/stocktakes.controller.ts وstocktakes-read.service.ts | ربط كل endpoint بعقد query الصحيح والتسمية |
| src/inventory/dto/inventory-response.dto.ts وinventory.controller.ts | وصف balances/movements ومصادرها المتداخلة كما يعرضها select الحالي |
| src/receipts/dto/receipt-response.dto.ts وreceipts.controller.ts | وصف header/bند/page و201/200 وrequired key |
| src/stock-adjustments/dto/adjustment-response.dto.ts وstock-adjustments.controller.ts | وصف payload الحالي وnullable receipt/stocktake sources و201/200 وrequired key |
| test/stocktakes/stocktakes.e2e-spec.ts وtest/receipts/receipts.e2e-spec.ts واختبارات المصدر المناسبة للشحن/المرتجعات | query validation وعزل التاجر ومطابقة schemas مع JSON لمصادر الحركة الفعلية |
| docs/stocktakes-api.md وinventory-api.md وreceipts-api.md وBACKEND_PROGRESS.md | التوافق والعقود والتنفيذ والمتبقي |

## Change Point / الحل

الفلاتر المتجاهلة تصل عبر DTO موسع أكثر من الاستعلام؛ الحل تضييق DTO بدل إضافة semantics جديدة من دون طلب. Swagger ناقص لأن response decorators بلا schema؛ الحل نماذج scalar/nested محددة على select وJSON الفعلي، وليس empty object أو نموذج ORM كامل أو تغيير الاستجابة لتناسب التوثيق.

| GET الجرد | query المقبول بالإضافة إلى page/limit |
| --- | --- |
| /stocktakes | merchantId,status |
| /stocktakes/:id/lines | merchantId,shelfId |
| /stocktakes/:id/scopes | merchantId |
| /stocktakes/:id/events | لا فلاتر إضافية؛ staff فقط |

رفض status في lines/scopes، وmerchantId/status في events بـ400 بدل تجاهلها. الفلاتر المدعومة تستمر. لا إزالة بحث أو تصفية ولا تعامل مع مشروع Flutter في هذا التغيير.

## Task Breakdown / Verify

1. regression tests تثبت قبول الفلاتر المتجاهلة حاليًا ونقص schema، ثم تتوقع400 أو schema الفعلية.
2. فصل query contracts وربط endpoints والخدمات دون تغيير where أو guards؛ تحقق pagination وsupported filters والملكية.
3. وصف response DTO حقلاً بحقل من select/payload؛ nested nullable sources وDateTime/UUID/enums؛ Idempotency-Key required في POST الاستلام والتسويات فقط؛ الاستجابة201 و200 موثقتان.
4. integration tests تربط schemas بالردود الحقيقية: صنف بلا رصيد؛ الاستلام؛ التسوية اليدوية؛ تسوية الجرد؛ خروج الشحنة؛ GOOD return وaccepted review؛ مصادر غير مستخدمة null، صفحات وإعادة الطلب، ورفض reads خارج ملكية التاجر. لا اختبار DTO كإثبات كافٍ لعزل التاجر.
5. format/lint/build/unit/API tests المناسبة، مراجعة diff؛ لا migrations فلا تعاد اختبارات SQL دون مبرر جديد.
6. تحديث BACKEND_PROGRESS بكل ملفات/نتائج/قيود، والعقود بأثر التوافق. لا إعلان اكتمال audit أو production.

## حدود النطاق والقبول

- لا schema/migration/package أو تغيير qty/ledger/roles/session/lock أو الشكل الحالي لـ JSON/statuses.
- الفلاتر المتجاهلة فقط تصبح400؛ documented supported filters تظل فعالة. كل response schema يطابق المصدر الفعلي بما في ذلك المصادر المتداخلة وnullability.
- لا نماذج response مشتركة شكلية لكل المشروع؛ تتشارك فقط تمثيلات فعليًا متطابقة مثبتة، مع مسؤولية feature واضحة.
- سجل التعديلات الوصفية الدائم، تشغيل الإنتاج وTLS/grants، UUID scope normalization، واختبار قبول العميل تبقى نطاقات لاحقة.
- بوابة الاعتماد استوفيت بعبارة «اوك» قبل التنفيذ وفق AGENTS.md قسم 10.
