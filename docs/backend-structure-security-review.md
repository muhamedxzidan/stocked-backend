# مراجعة اتساق الهيكل والأمان — 2026-10-09

الحالة: حصر المسارات وفحص مصدر موجه، مع Blueprint إصلاح **اعتمده المستخدم ونفذ في الخطوة اللاحقة**. ليست شهادة أمان إنتاج أو اختبار اختراق. HEAD البرمجي `cc372cc`، والتوثيق `d0e8e47` عند البدء. أقسام التحقيق تسجل الحالة قبل الإصلاح؛ التنفيذ المعتمد موثق في آخر هذا التقرير والقسم 15 من BACKEND_PROGRESS. لم يعدل SQL في الإصلاح.

## مصادر وحدود المراجعة

قرئت قواعد stocked وKarpathy في الخطوة السابقة. لا خريطة Graphify للباك إند؛ خريطة Flutter لا تتضمن إعدادات الوكلاء أو مصادر NestJS. بدأ التحقيق من BACKEND_PROGRESS ثم controllers، configure-http، guards، SessionService، خدمات المعاملات، ItemsService، StorageLocationsService، StocktakesReadService، ونقاط النطاق/القفل/إعادة التحقق في بقية خدمات الأعمال، مع أسماء وتغطية اختبارات API. حصر endpoints كامل في controllers الحالية؛ عمق القراءة ليس متساويًا في كل خدمة. لم ينفذ تدقيق شامل لكل سطر SQL أو جميع DTO أو صلاحيات قاعدة الإنتاج أو كل اعتماديات المشروع.

Antigravity: تفويض حصر واقعي read-only إلى `gemini-3.6-flash-medium` بنسخة مصدر دون .env أو بيانات تشغيل؛ فشل بسبب RESOURCE_EXHAUSTED 429 دون تقرير. لا مراجعة مستقلة ناجحة. Codex مسؤول عن النتائج والقرارات.

## الهيكل ومسار البيانات الحالي

`HTTP → ValidationPipe + SessionGuard + PasswordChangeGuard + RolesGuard → Controller → خدمة عملية/قراءة → PrismaService + SQL`.

Controller يوجه الطلب ولا يصل إلى Prisma مباشرة، باستثناء HealthController الذي يجري SELECT 1 لاختبار الجاهزية. هذا استثناء محدد المسؤولية وليس منطق أعمال. Module يربط الاعتماديات. SessionService يملك التحقق والقفل وإبطال الجلسة. AdminMutationService ينظم تعديل الإدارة، StockMutationService ينظم عمليات المخزون، StocktakeTransactionService ينظم تاريخ دورة الجرد. اختلاف الخدمات هنا ناتج عن قواعد أقفال وحالات مختلفة؛ لا دليل يبرر دمجها في خدمة عامة أو اختراع Repository لكل جدول.

## مصفوفة الضوابط حسب عائلة العملية

A=ADMIN، K=WAREHOUSE_KEEPER، E=EMPLOYEE، M=MERCHANT. shipmentWriterRoles وreturnWriterRoles = A/K/E، returnReviewerRoles = A/K.

| العائلة | حدود الصلاحية/الملكية | الكتابة والمعاملة | دليل التحقق الموجود |
|---|---|---|---|
| Health/login | عامان صراحة؛ login يخضع محدد المحاولات | login يقفل الحساب قبل إصدار الجلسة | test/app.e2e-spec.ts |
| me/password/logout | جلسة موثقة؛ يسمح مسار تغيير كلمة المرور المبدئي | قفل مستخدم، تدوير وإبطال؛ لا تغيير بيانات أعمال | test/app.e2e-spec.ts |
| users/merchants | جميع المسارات A فقط، لا قراءات M | AdminMutationService، حماية آخر مدير وإبطال الجلسات | test/users وtest/merchants |
| items | إنشاء A/K/E، تعديل A، قراءة الجميع؛ scope للـ M في list/get/code/label | create: gate ثم user ثم merchant/counter؛ تعديل عبر AdminMutationService | test/items، ومنها forged merchant filters |
| receipts | إنشاء A/K/E، قراءة الجميع مع نطاق M | StockMutationService؛ source merchant/items، placements، posting ذرية وactor-bound replay | test/receipts وtest/stocktakes |
| inventory | قراءة فقط؛ نطاق M للأرصدة والحركات والتفاصيل | لا endpoint لتعديل الرصيد مباشرة | test/receipts وtest/shipments |
| adjustments | كتابة A وحده، قراءة الجميع مع نطاق M | مصدر receipt أو stocktake، placements، posting، actor-bound replay | test/receipts وtest/stocktakes |
| shipments | تسجيل/تجهيز/خروج A/K/E؛ قراءة نطاق M | خدمات عملية مستقلة، أقفال مصدر/رصيد وإعادة تحقق، خروج واحد | test/shipments |
| returns | استلام/فحص A/K/E، مراجعة A/K؛ قراءة نطاق M | مصدر شحنة وceiling وحالة review، custody منفصلة عن restock | test/returns |
| locations | إنشاء/تعديل A؛ نقل A/K؛ قراءة نطاق M | إدارة عبر AdminMutationService؛ النقل عبر StockMutationService | test/stocktakes؛ فجوة null مفصلة أدناه |
| stocktakes | فتح/عد/حضور/ملاحظات/submit A/K؛ reopen/approve/cancel A؛ reads الجميع وevents staff فقط | قفل عام persisted، دورة/count version، حضور، settlement ذري | test/stocktakes |

هذه المصفوفة تربط التنفيذ باختبار موجود؛ لا تعني أن كل تركيب للحقول أو كل حالة إنتاج اختبرت. راجع قائمة المسارات التالية للـ method-level overrides.

## النتائج المثبتة وحدودها

### R1 — خلل تحقق null في تعديل المواقع (أولوية الإصلاح الأولى)

`src/storage-locations/dto/storage-location.dto.ts`، UpdateStorageLocationDto.name وisActive يستخدمان IsOptional؛ يتجاوز التحقق قيمة null. `StorageLocationsService.update` يتعامل مع وجود قيمة ليست undefined كتعديل ويمرر input إلى Prisma. الحقلان غير nullable في `prisma/schema.prisma`. بالمقابل UpdateItemDto.name يفرق عن undefined عبر ValidateIf.

أعيد إنتاج قبول DTO باستخدام class-transformer وclass-validator من dist: `{name:null}` و`{isActive:null}` كلاهما validationErrors=0. هذا إثبات فجوة المدخلات؛ لم يختبر HTTP/null أو يدع نجاح كتابة null في قاعدة البيانات. المتوقع أن يمنعها التخزين لاحقًا بدل 400 مبكر؛ أثر HTTP يثبت بالاختبار المقترح. ليست ثغرة تجاوز دور أو عزل تاجر مثبتة.

### R2 — Swagger الجرد والمواقع أضعف من عقد المصدر

controllers الجرد والمواقع تستقبل Idempotency-Key لكن لا ApiHeader يعلن required، ولا response DTO/ApiOkResponse/ApiCreatedResponse يصف return schema. الشحن والمرتجعات يملكان ذلك؛ inventory/receipts/adjustments لديهم response decorators دون type مفصل. المستندات المكتوبة لا تعوض OpenAPI عند توليد عميل. لا تغير statuses الحالية لمجرد أن endpoints أخرى تعيد 200/201؛ كل حالة تعتمد عقد العملية.

### R3 — بعض فلاتر المواقع مقبولة وتجاهلها مؤكد من المصدر

ListStorageLocationsDto مشترك ويقبل rowId/itemId/shelfId لكل قراءات المواقع. entries وtransfers لا يستعملان rowId؛ rows لا يستعمل itemId/shelfId؛ shelves لا يستعمل itemId. هذا اختلاف عقد واضح، لا تسرب ملكية مثبت: نطاق merchantId باق في where. يحتاج اختيار عقد صريح: فصل query DTO لكل endpoint بحيث يعرض ويقبل الفلاتر المدعومة فقط، مع توثيق أي تغيير كاسر؛ إضافة semantics جديدة للفلاتر ليست معتمدة ضمن الإصلاح الأول.

### R4 — أثر تعديلات البيانات الوصفية ليس تاريخًا دائمًا كاملًا

ItemsService.update/setStatus وStorageLocationsService.update لا ينشئان سجل تعديلات دائمًا يتضمن قبل/بعد/السبب والفاعل لكل تغيير. users/merchants يسجلان أحداث إدارة عبر Logger؛ هذا ليس جدول تاريخ ذري دائم. دفتر الحركات والجرد مختلفان ولهما مصادر/توقيت محفوظة. إذا كان المطلوب تاريخ كل تعديل وصفي كذلك، يحتاج Blueprint مستقل لتحديد أنواع الأحداث والاحتفاظ والحقول وعدم تسريب الأسرار. لا ينشأ نظام audit عام شكلي في هذه المرحلة.

### R5 — أمان الإنتاج ما زال يحتاج تحقق تشغيل مستقل

Environment يمنع sslmode=disable صراحة في الإنتاج فقط؛ لا يثبت بذلك TLS مع تحقق هوية خادم PostgreSQL. PrismaPg يستخدم connectionString الحالي. لم تقرأ أسرار الإنتاج أو تفحص TLS الفعلي أو grants مستخدم DB أو عزل migration/runtime. Cookie/CSRF/CORS عميل الويب لم تنفذ وفق configure-http وسياسة الأمان؛ bearer الحالي لا يثبت اكتمال تكامل الويب. هذه حدود جاهزية إنتاج وليست اختراقًا مثبتًا؛ قرار نشر/اتصال إنتاج يحتاج نطاقًا مستقلًا.

### R6 — تحسينات اتساق بدون إعادة هندسة شكلية

controllers الجرد والمواقع يستخدمان c/i/q مقابل context/input/query في الوحدات القديمة؛ يمكن توحيد التسميات في الملفات المعدلة. scope تكرر ويختلف تطبيع UUID؛ المقارنة case-sensitive في بعض الخدمات بينما PostgreSQL UUID يقبل uppercase. أثره المحتمل رفض فلتر مكافئ، لا زيادة الصلاحية. لا يستبدل scope كله بخدمة عامة قبل اختبارات عقد متعددة الأدوار وتحديد حاجة فعلية.

## Blueprint مقترح: إصلاح عقد المواقع والتحقق وتوثيق الجرد

**الحالة: اعتمده المستخدم صراحة ونفذ في 2026-10-09. نتائج التحقيق أعلاه تصف الحالة قبل الإصلاح.**

- الغرض: إصلاح R1، وإكمال OpenAPI للجرد والمواقع (R2)، وإزالة فلاتر المواقع التي يقبلها endpoint دون تنفيذها (R3)، مع توحيد تسميات الملفات المتأثرة فقط.
- current flow/data flow: request DTO → feature controller → same existing service/transaction → same Prisma/SQL → صراحة حقول الاستجابة المحددة. لا تعديل منطق التسويات أو أدوار الوصول أو قواعد قاعدة البيانات.
- structure/class map: query DTO محدد لكل قراءة يملك validation الخاص بها؛ response DTO للتمثيل والتوثيق فقط؛ controllers تظل توجيهًا، services تبقى القواعد والنطاق، خدمات transaction/gate لا تتغير.
- files map: storage-locations DTO/controller/service types + stocktakes DTO/controller؛ response DTO جديدة عند الحاجة الفعلية؛ اختبارات stocktakes أو اختبار HTTP مخصص للعقد؛ docs/storage-locations-api.md وstocktakes-api.md وBACKEND_PROGRESS.md. receipts/adjustments response schemas خارج النطاق الأول ويسجلان متابعة.
- change point: ValidateIf يرفض null للحقول غير nullable؛ query DTO ينشر ويقبل supported filters فقط؛ Swagger يصف payload الفعلي دون فرض شكل استجابة موحد كاسر.
- أبسط حل صحيح: الاستفادة من pattern UpdateItemDto، لا إضافة package أو validation layer أو abstract base classes لمشاركة بضعة decorators. فصل DTO يدعم رفض الحقول الزائدة بـ global whitelist، بدل تجاهلها بصمت.
- خطوات: (1) اختبارات regression لnull/empty update + filters غير مدعومة مع إثبات unchanged state، (2) تعديل DTO والتسميات، (3) response DTO/ApiHeader/response schema تعكس payload وstaff/merchant variants، (4) اختبار OpenAPI وآثار منع M وتحقق idempotency، (5) format/lint/build/tests المناسبة، (6) تحديث العقود وسجل التقدم وفحص الفرق.
- توافق: query fields المتجاهلة ستصبح 400 بدل نجاح بلا أثر؛ يوثق ذلك قبل الربط مع Flutter. HTTP statuses وأشكال payload والصلاحيات والحركات لا تتغير. لا migration أو package أو تعديل Flutter أو نشر.
- acceptance: null المرفوض يرجع 400 ولا يغير البيانات؛ nullable المشروع فعليًا يظل مسموحًا؛ كل query معلن له أثر أو يرفض؛ required Idempotency-Key وschemas ظاهرة في OpenAPI ومطابقة الاستجابة؛ لا زيادة نطاق تاجر أو regression في دورة الجرد.
- خارج النطاق: سجل وصفي دائم R4، تقوية تشغيل الإنتاج R5، تعميم scope، إعادة توزيع كل خدمات الريبو. لكل منها تصميم واعتماد مستقل عند الحاجة.

## حصر endpoints من المصدر

الحصر استخراج من decorators ولا يمثل تحققًا ديناميكيًا لكل policy. أدوار method تتقدم على class في RolesGuard. Public/authenticated محددان في auth/health.

| المسار | metadata الصلاحية | المصدر |
|---|---|---|
| POST `/api/v1/auth/login` | PUBLIC | `src/auth/auth.controller.ts` |
| GET `/api/v1/auth/me` | Authenticated (auth methods) | `src/auth/auth.controller.ts` |
| POST `/api/v1/auth/change-password` | Authenticated (auth methods) | `src/auth/auth.controller.ts` |
| POST `/api/v1/auth/logout` | Authenticated (auth methods) | `src/auth/auth.controller.ts` |
| GET `/api/v1/health` | PUBLIC | `src/health/health.controller.ts` |
| GET `/api/v1/balances` | ADMIN, WAREHOUSE_KEEPER, EMPLOYEE, MERCHANT | `src/inventory/inventory.controller.ts` |
| GET `/api/v1/balances/:itemId` | ADMIN, WAREHOUSE_KEEPER, EMPLOYEE, MERCHANT | `src/inventory/inventory.controller.ts` |
| GET `/api/v1/movements` | ADMIN, WAREHOUSE_KEEPER, EMPLOYEE, MERCHANT | `src/inventory/inventory.controller.ts` |
| GET `/api/v1/movements/:id` | ADMIN, WAREHOUSE_KEEPER, EMPLOYEE, MERCHANT | `src/inventory/inventory.controller.ts` |
| POST `/api/v1/items` | ADMIN, WAREHOUSE_KEEPER, EMPLOYEE | `src/items/items.controller.ts` |
| GET `/api/v1/items` | ADMIN, WAREHOUSE_KEEPER, EMPLOYEE, MERCHANT | `src/items/items.controller.ts` |
| GET `/api/v1/items/by-code/:code` | ADMIN, WAREHOUSE_KEEPER, EMPLOYEE, MERCHANT | `src/items/items.controller.ts` |
| GET `/api/v1/items/:id/label` | ADMIN, WAREHOUSE_KEEPER, EMPLOYEE, MERCHANT | `src/items/items.controller.ts` |
| GET `/api/v1/items/:id` | ADMIN, WAREHOUSE_KEEPER, EMPLOYEE, MERCHANT | `src/items/items.controller.ts` |
| PATCH `/api/v1/items/:id` | ADMIN | `src/items/items.controller.ts` |
| PATCH `/api/v1/items/:id/status` | ADMIN | `src/items/items.controller.ts` |
| POST `/api/v1/merchants` | ADMIN | `src/merchants/merchants.controller.ts` |
| GET `/api/v1/merchants` | ADMIN | `src/merchants/merchants.controller.ts` |
| GET `/api/v1/merchants/:id` | ADMIN | `src/merchants/merchants.controller.ts` |
| PATCH `/api/v1/merchants/:id` | ADMIN | `src/merchants/merchants.controller.ts` |
| PATCH `/api/v1/merchants/:id/status` | ADMIN | `src/merchants/merchants.controller.ts` |
| POST `/api/v1/receipts` | ADMIN, WAREHOUSE_KEEPER, EMPLOYEE | `src/receipts/receipts.controller.ts` |
| GET `/api/v1/receipts` | ADMIN, WAREHOUSE_KEEPER, EMPLOYEE, MERCHANT | `src/receipts/receipts.controller.ts` |
| GET `/api/v1/receipts/:id` | ADMIN, WAREHOUSE_KEEPER, EMPLOYEE, MERCHANT | `src/receipts/receipts.controller.ts` |
| POST `/api/v1/returns` | ...returnWriterRoles | `src/returns/returns.controller.ts` |
| POST `/api/v1/returns/:id/inspect` | ...returnWriterRoles | `src/returns/returns.controller.ts` |
| POST `/api/v1/returns/inspection-lines/:id/review` | ...returnReviewerRoles | `src/returns/returns.controller.ts` |
| GET `/api/v1/returns` | ...returnWriterRoles, MERCHANT | `src/returns/returns.controller.ts` |
| GET `/api/v1/returns/:id` | ...returnWriterRoles, MERCHANT | `src/returns/returns.controller.ts` |
| POST `/api/v1/shipments` | ...shipmentWriterRoles | `src/shipments/shipments.controller.ts` |
| POST `/api/v1/shipments/:id/prepare` | ...shipmentWriterRoles | `src/shipments/shipments.controller.ts` |
| POST `/api/v1/shipments/:id/dispatch` | ...shipmentWriterRoles | `src/shipments/shipments.controller.ts` |
| GET `/api/v1/shipments` | ...shipmentWriterRoles, MERCHANT | `src/shipments/shipments.controller.ts` |
| GET `/api/v1/shipments/:id` | ...shipmentWriterRoles, MERCHANT | `src/shipments/shipments.controller.ts` |
| POST `/api/v1/stock-adjustments` | ADMIN | `src/stock-adjustments/stock-adjustments.controller.ts` |
| GET `/api/v1/stock-adjustments` | ADMIN, WAREHOUSE_KEEPER, EMPLOYEE, MERCHANT | `src/stock-adjustments/stock-adjustments.controller.ts` |
| GET `/api/v1/stock-adjustments/:id` | ADMIN, WAREHOUSE_KEEPER, EMPLOYEE, MERCHANT | `src/stock-adjustments/stock-adjustments.controller.ts` |
| POST `/api/v1/stocktakes` | ADMIN, WAREHOUSE_KEEPER | `src/stocktakes/stocktakes.controller.ts` |
| POST `/api/v1/stocktakes/:id/counts` | ADMIN, WAREHOUSE_KEEPER | `src/stocktakes/stocktakes.controller.ts` |
| POST `/api/v1/stocktakes/:id/attendance` | ADMIN, WAREHOUSE_KEEPER | `src/stocktakes/stocktakes.controller.ts` |
| POST `/api/v1/stocktakes/:id/notes` | ADMIN, WAREHOUSE_KEEPER | `src/stocktakes/stocktakes.controller.ts` |
| POST `/api/v1/stocktakes/:id/submit` | ADMIN, WAREHOUSE_KEEPER | `src/stocktakes/stocktakes.controller.ts` |
| POST `/api/v1/stocktakes/:id/reopen` | ADMIN | `src/stocktakes/stocktakes.controller.ts` |
| POST `/api/v1/stocktakes/:id/approve` | ADMIN | `src/stocktakes/stocktakes.controller.ts` |
| POST `/api/v1/stocktakes/:id/cancel` | ADMIN | `src/stocktakes/stocktakes.controller.ts` |
| GET `/api/v1/stocktakes` | ADMIN, WAREHOUSE_KEEPER, EMPLOYEE, MERCHANT | `src/stocktakes/stocktakes.controller.ts` |
| GET `/api/v1/stocktakes/:id` | ADMIN, WAREHOUSE_KEEPER, EMPLOYEE, MERCHANT | `src/stocktakes/stocktakes.controller.ts` |
| GET `/api/v1/stocktakes/:id/lines` | ADMIN, WAREHOUSE_KEEPER, EMPLOYEE, MERCHANT | `src/stocktakes/stocktakes.controller.ts` |
| GET `/api/v1/stocktakes/:id/scopes` | ADMIN, WAREHOUSE_KEEPER, EMPLOYEE, MERCHANT | `src/stocktakes/stocktakes.controller.ts` |
| GET `/api/v1/stocktakes/:id/events` | ADMIN, WAREHOUSE_KEEPER, EMPLOYEE | `src/stocktakes/stocktakes.controller.ts` |
| POST `/api/v1/storage-locations/rows` | ADMIN | `src/storage-locations/storage-locations.controller.ts` |
| POST `/api/v1/storage-locations/shelves` | ADMIN | `src/storage-locations/storage-locations.controller.ts` |
| PATCH `/api/v1/storage-locations/rows/:id` | ADMIN | `src/storage-locations/storage-locations.controller.ts` |
| PATCH `/api/v1/storage-locations/shelves/:id` | ADMIN | `src/storage-locations/storage-locations.controller.ts` |
| GET `/api/v1/storage-locations/rows` | ADMIN, WAREHOUSE_KEEPER, EMPLOYEE, MERCHANT | `src/storage-locations/storage-locations.controller.ts` |
| GET `/api/v1/storage-locations/shelves` | ADMIN, WAREHOUSE_KEEPER, EMPLOYEE, MERCHANT | `src/storage-locations/storage-locations.controller.ts` |
| GET `/api/v1/storage-locations/balances` | ADMIN, WAREHOUSE_KEEPER, EMPLOYEE, MERCHANT | `src/storage-locations/storage-locations.controller.ts` |
| GET `/api/v1/storage-locations/custody` | ADMIN, WAREHOUSE_KEEPER, EMPLOYEE, MERCHANT | `src/storage-locations/storage-locations.controller.ts` |
| POST `/api/v1/storage-locations/transfers` | ADMIN, WAREHOUSE_KEEPER | `src/storage-locations/storage-locations.controller.ts` |
| POST `/api/v1/storage-locations/custody-transfers` | ADMIN, WAREHOUSE_KEEPER | `src/storage-locations/storage-locations.controller.ts` |
| GET `/api/v1/storage-locations/entries` | ADMIN, WAREHOUSE_KEEPER, EMPLOYEE, MERCHANT | `src/storage-locations/storage-locations.controller.ts` |
| GET `/api/v1/storage-locations/transfers` | ADMIN, WAREHOUSE_KEEPER, EMPLOYEE, MERCHANT | `src/storage-locations/storage-locations.controller.ts` |
| POST `/api/v1/users` | ADMIN | `src/users/users.controller.ts` |
| GET `/api/v1/users` | ADMIN | `src/users/users.controller.ts` |
| GET `/api/v1/users/:id` | ADMIN | `src/users/users.controller.ts` |
| PATCH `/api/v1/users/:id` | ADMIN | `src/users/users.controller.ts` |
| PATCH `/api/v1/users/:id/status` | ADMIN | `src/users/users.controller.ts` |

## الفحوص التي نفذت في المراجعة

- reproduction DTO مباشر عبر plainToInstance + validate: قبول null للحقلين، validationErrors=0 لكل حالة. بعد إعادة build تتطابق المصادر؛ لا تعديل للكود بين reproduction والـ build.
- `npm run test:e2e -- --no-file-parallelism`: المحاولة الأولى build نجح لكن قواعد الاختبار لم تتصل بسبب EPERM داخل sandbox، 148 skipped و8 failed suites، وليس فشل assertions. أعيد الأمر بالصلاحية المناسبة: build نجح، 8 ملفات و148 اختبارًا نجحت.
- لم تنفذ فحوص SQL/unit/lint مجددًا في هذه المراجعة، ولم تختبر الإنتاج أو تصل إليه. نتائج المراحل السابقة محفوظة في BACKEND_PROGRESS ولا تقدم كتنفيذ جديد.
- `git diff --check`: نجح لتغييرات التوثيق.

هذه نتائج مراجعة وعرض تصميم، وليست تنفيذ إصلاحات R1–R6.


## نتيجة تنفيذ Blueprint المعتمد — 2026-10-09

المستخدم أكد أن العمل للباك إند فقط؛ stocked Flutter مرجع، واستبدال الباك إند فيه يتم لاحقًا.

- R1 أصلح بـ ValidateIf للحقول غير nullable في تحديث المواقع؛ HTTP regression قبل الإصلاح أعاد500 لـ name:null، وبعد الإصلاح يعيد400 دون تغيير row/shelf. الطلب الفارغ/الاسم الفارغ/نوع Boolean الخاطئ/حقول الملكية مرفوضة.
- R2 أضيف response DTO فعلية للجرد والمواقع وApiHeader للمفتاح المطلوب، وanyOf لتمثيل staff/merchant، مع statuses وpayload الحالية. نماذج DTO هنا عقد عرض فقط؛ لا تملك منطقًا أو تخزينًا ولا تؤسس طبقات شكلية.
- R3 أزيل DTO الفلاتر الجامع، وفصلت أربعة عقود query واضحة: rows، shelves، balances/custody، entries/transfers. يشترك المساران فقط عندما يملكان نفس الحقول المدعومة فعليًا؛ دون inheritance أو base class لمشاركة decorators. service تغيّر type فقط، وwhere/الملكية والمعاملة بقيت كما هي.
- وحدت أسماء context/input/query في controllers المعدلة. لا migrations أو packages أو Flutter أو نشر.
- R4 التاريخ الوصفي الدائم وR5 أمان التشغيل وR6 تعميم scope/UUID خارج هذا التنفيذ؛ receipts/adjustments/inventory response schemas تستكمل لاحقًا بحسب نطاق مستقل.
- متابعة اكتشفت من قراءة العقود الحالية: StocktakeLinesQueryDto يقبل status غير المستخدم في lines، وListStocktakesDto يعاد استخدامه للـ scopes/events رغم عدم تنفيذ status في scopes وعدم تنفيذ merchantId/status في events. هذه الفلاتر لم تتغير لأن نطاق R3 المعتمد خاص بالمواقع؛ يلزم تضييق عقود query للجرد في Blueprint مستقل، ولا تعتبر استجابات Swagger المكتملة إصلاحًا لذلك.

الفحوص النهائية ومسؤوليات الملفات مسجلة في BACKEND_PROGRESS. فحوص المراجعة أعلاه تبقى تاريخية ولا تستبدل نتائج التنفيذ.
