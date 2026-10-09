# مخطط سجل التدقيق الدائم — 2026-10-09

الحالة: اعتمد المستخدم المخطط صراحة بعبارة «اوك». التنفيذ والفحوص والتطبيق المحلي مسجلة في BACKEND_PROGRESS.md. مراجعة
Antigravity المستقلة لم تتوفر: RESOURCE_EXHAUSTED429، لا تقرير ولا ادعاء توافق.
Codex مسؤول عن التوصية والقرارات والتحقق النهائي.

## الغرض والنطاق

حفظ إنشاء وتعديل وحالة الأصناف والصفوف والأرفف والمستخدمين والتجار في سجل
دائم يوضح الحالة السابقة واللاحقة والفاعل ووقته وسبب التعديل. التعديل وسجله
ينجحان أو يتراجعان في معاملة واحدة. لا يعاد بناء سجل تاريخي غير موجود.

يشمل النطاق CREATE/UPDATE/STATUS للكيانات ITEM/ROW/SHELF/USER/MERCHANT.
تظل حركات المخزون والتسويات والشحن والمرتجعات والجرد في دفاترها الحالية؛
لا ازدواج لسجلها ولا تغيير في منطق كمياتها. أحداث login/password/logout/
bootstrap تبقى telemetry أمنية منفصلة في هذه المرحلة وليست سجل المجال الجديد.

## التتبع الحالي ونقطة التغيير

- `ItemsController` → `ItemsService.create` → gate/session validation → قفل
  التاجر وتخصيص الرمز → item.create في معاملة مباشرة. تحديث الصنف وحالته
  عبر AdminMutationService وقفل الصنف، ولا سجل تعديل وصفي دائم.
- `StorageLocationsController` → `StorageLocationsService` →
  AdminMutationService → create/update. update يقرأ الموقع ثم يقفله؛ لقطة
  before الجديدة يجب أن تقرأ بعد القفل، لا تعتمد على قراءة سابقة له.
- `UsersController` → `UsersService` → AdminMutationService → التغيير وحماية
  آخر مدير وإلغاء الجلسات عند اللزوم → commit → recordAdministration Logger.
- `MerchantsController` → `MerchantsService` → AdminMutationService → التغيير
  وإلغاء الجلسات عند التعطيل → commit → recordAdministration Logger.
- AdminMutationService يملك gate وقفل الإدارة وقفل المستخدمين وإعادة تحقق
  الجلسة والدور داخل المعاملة. يستمر ترتيب الأقفال كما هو.
- SecurityAuditService ليس تخزينًا دائمًا أو ذريًا؛ recordAdministration
  يسجل event/actorId/targetId فقط. Prisma schema لا يحتوي نموذج audit events.

نقطة التغيير الصحيحة داخل معاملات الخدمات الحالية، بعد التحقق والأقفال؛
interceptor أو middleware بعد الرد لا يستطيع ضمان before/after أو rollback.

## التصميم ومسؤوليات الكلاسات

ميزة `src/audit-events/` تحتوي:

- `AuditEventsModule`: يصدّر writer/read service ويربط controller دون global
  side effects أو circular dependency مع ميزات المجال.
- `AuditEventWriter`: يقبل Prisma.TransactionClient الموجود، وينشئ سجلًا واحدًا
  بتمثيل حقول مسموحة ومحدد لكل نوع. لا يفتح معاملة مستقلة ولا يسجل request
  body عشوائيًا. لا توجد كلمة مرور/hash/token/session digest في snapshots.
- `AuditEventsReadService`: قراءة مقسمة بترتيب recordedAt ثم id، وفلاتر
  entityType/entityId/actorId/action/from/to/page/limit، والتحقق من حدود التاريخ.
- `AuditEventsController`: GET `/audit-events` وGET `/audit-events/:id` للمدير
  ADMIN فقط؛ لا كتابة أو حذف عبر API. لا وصول للتجار أو الموظفين أو أمين المخزن.
- DTOs محلية محددة للقراءة والاستجابة ولقطات الأنواع، وسبب التعديل داخل
  update/status DTO الخاص بكل ميزة. لا طبقة Repository شكلية جديدة أو base DTO.
- خدمات المجال مسؤولة عن اختيار الحدث وقراءة before بعد القفل وafter الناتج
  من الكتابة، وطلب writer داخل نفس المعاملة. لا نقل قواعد المجال إلى writer.

## نموذج البيانات المقترح

Prisma model `AuditEvent` / SQL `audit_events`:

- id UUID مولد، entityType enum، entityId UUID ثابت، action enum.
- actorId مرجع users مع Restrict، actorNameSnapshot وactorRoleSnapshot.
  يستخرج الفاعل من المستخدم المقفول داخل المعاملة قبل تغيير المستخدم المستهدف،
  خصوصًا عندما يعدل المدير اسمه/دوره نفسه؛ لا يثق في payload.
- recordedAt من وقت PostgreSQL، بدقة milliseconds.
- reason نص trim بين10 و2000 حرف لكل UPDATE/STATUS، وnull عند CREATE.
- beforeSnapshot JSONB: null عند CREATE، لقطة مسموحة عند UPDATE/STATUS.
- afterSnapshot JSONB: لقطة مسموحة مطلوبة. تميز null والحقل المفقود؛ decimal
  weightKg يمثّل نصًا مضبوطًا كما في عقد الصنف.
- index على recordedAt/id، entityType/entityId/recordedAt، actorId/recordedAt.
  لا FK متعدد الأشكال بين entityId وخمسة جداول؛ تبقى الهوية ولقطتها في التاريخ.

اللقطات تحوي الحقول التجارية/الإدارية المحددة فقط:

- ITEM: id/merchantId/code/name/brand/color/weightKg/notes/isActive.
- ROW: id/warehouseId/code/name/isActive.
- SHELF: id/warehouseId/rowId/merchantId/code/name/isActive.
- USER: id/email/displayName/role/merchantId/isActive/mustChangePassword.
- MERCHANT: id/code/name/phone/isActive.

قراءة هذه البيانات الشخصية إدارية فقط. السبب لا يسجل كلمات مرور أو أسرار؛
تعريف الحقول يمنع نسخ initialPassword/hash/tokens من كائنات المصادقة.

## قواعد الحماية والتوافق

1. إدراج السجل داخل نفس transaction؛ فشل السجل يلغي التعديل وإلغاء الجلسات
   المصاحب. لا catch يسكت الفشل ولا queue تؤخر كتابة السجل بعد نجاح الأعمال.
2. DB constraints لشكل الحدث وreason/actor واللقطات، وtrigger لمنع UPDATE/DELETE
   على السجل. لا API أو وظيفة purge؛ الاحتفاظ بلا حذف تلقائي حتى اعتماد سياسة
   مستقلة. TRUNCATE/DDL وصلاحيات owner خارج ضمان trigger الصفوف، ويجب ضبط
   grants/runtime-vs-migrations في مرحلة الإنتاج؛ لا ادعاء tamper-proof للمالك.
3. كل مسارات الكتابة في الخدمات الخمس تُغطى باختبارات، بما فيها إنشاء الصنف
   بمعاملته المباشرة. التسجيل الصريح في الخدمات ليس ضمان تدقيق لأي SQL مباشر
   خارجها؛ توثيق هذا الحد ومراجعة grants ضروريان.
4. تحديث/status يتطلب reason في DTO وSwagger؛ تغيير متعمد لعقد API:
   الطلب القديم بدون سبب يعود400. يخرج reason من data ORM، ولا يضاف حقل reason
   للكيان نفسه. create لا يتطلب سببًا من العميل لأن action يثبت الإنشاء.
5. طلب ناجح بدون تغير فعلي يسجل حدثًا بلقطتين متساويتين لتتبع العملية؛ الفشل
   400/403/404/409 لا ينشئ حدث تعديل ناجح. payload/ردود الميزات الأخرى ثابتة.
6. gate الجرد الحالي يظل يحجب الكتابة منذ فتح الجرد حتى اعتماد/إلغاء المدير؛
   قراءة audit للأدمن تظل مسموحة. لا مسار audit يسمح بتغيير أثناء الجرد.
7. يحذف استعمال recordAdministration Logger بعد نقل جميع أحداثه إلى التخزين
   الدائم، مع الحفاظ على record لأحداث المصادقة. اختبارات الإدارة تتحدث للعقد.
8. تغيير الاسم والدور يؤخذ كعملية واحدة، وbefore/after يحتفظان بكل الاختلافات؛
   لا تكتفى event label تخفي تعديلًا آخر في نفس الطلب.

## خريطة الملفات المتوقعة

| الملف/النطاق | المسؤولية |
| --- | --- |
| prisma/schema.prisma + migration جديدة | enums/model/constraints/indexes وحماية عدم التعديل |
| src/audit-events/*.ts وdto/* | writer/read/controller/module وعقود محددة |
| src/app.module.ts | ربط ميزة القراءة |
| src/items/items.service.ts + items.module.ts + update/status DTO | سجل داخل create/mutate والسبب |
| src/storage-locations/storage-locations.service.ts + module/DTO | before بعد القفل، سجل الإنشاء والتحديث والحالة والسبب |
| src/users/users.service.ts + module/update/status DTO | سجل ذري مع حماية الإدارة وإلغاء الجلسات |
| src/merchants/merchants.service.ts + module/update/status DTO | سجل ذري وإنشاء/تعديل/تعطيل وربط الجلسات |
| src/auth/security-audit.service.ts | إزالة Logger الإدارة الذي يحل محله السجل؛ إبقاء auth telemetry |
| test/administration وcatalog وstocktakes واختبار audit جديد | تحديث الأسباب، ملكية/صلاحيات/rollback/concurrency/privacy |
| test/database اختبار جديد | immutability والقيود دون إعادة كتابة الترحيلات القديمة |
| docs/audit-events-api.md وBACKEND_PROGRESS.md | العقد والملفات والفحوص والحدود والمتبقي |

المسار النهائي:
`HTTP reason validated → role/session/gate → existing locks → before snapshot →
mutation + session revocation → after snapshot → audit insert → commit → response`.
وعند فشل أي جزء: rollback كامل. قراءة السجل ADMIN فقط، بلا UI أو Flutter.

## خطوات التنفيذ والتحقق بعد الاعتماد

1. قراءة قواعد/مهارات Prisma اللازمة للترحيل، وتحديد جميع update/status callers
   واختباراتهم من المصدر. لا حزم جديدة ولا إعادة هيكلة غير متعلقة.
2. إضافة نموذج وترحيل جديد واختبارات القيود/عدم تعديل السجل؛ لا نسخ بيانات
   وهمية إلى السجل. ترحيلات قاعدة الاختبار المعزولة أولًا.
3. writer وعقود snapshots، ثم كل ميزة داخل معاملاتها القائمة. قراءة الموقع
   بعد القفل، والحفاظ على قواعد آخر مدير/عضوية التجار وإلغاء الجلسات.
4. reason validation/docs والتوافق ثم ADMIN-only read API وSwagger.
5. اختبارات فعلية: كل create/update/status، قبل/بعد وnull والسبب/الفاعل/الوقت؛
   سرية كلمات المرور/tokens؛ فشل إدراج السجل يلغي تعديلًا وإلغاء جلساته؛
   تضارب تعديلين لا ينتج before قديمًا؛ forbidden roles؛ blocked stocktake؛
   طلب بلا سبب؛ no-op؛ pagination/date bounds؛ لا تعديل/حذف audit.
6. build/lint/format/unit/full API/DB المناسب، مراجعة primary نهائية.
7. توثيق النتائج، ثم backup وتطبيق الترحيل المحلي المعتاد بعد نجاح اختبارات
   الترحيل. لا نشر إنتاج أو تغيير بيانات الإنتاج في هذا النطاق.

## المتبقي خارج النطاق

الأمان الفعلي لـ production grants/TLS/secrets والاعتماديات، دورة قبول العميل،
UUID normalization، وربط Flutter لاحقًا. حفظ أحداث auth failures دائمًا وسياسة
حماية معرفات محاولات الدخول نطاق مستقل؛ لا خلطها بتعديلات المجال الناجحة.
