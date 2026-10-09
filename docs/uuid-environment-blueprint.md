# مخطط توحيد UUID وإصلاح صيغة البيئة المحلية — 2026-10-09

الحالة: اعتمد المستخدم المخطط برسالة «نفذ»؛ نُفذ وجرى التحقق بنجاح.
النتائج: API170/170، unit4/4، build/lint/Prettier ودقة البيئة والاتصال المحلي
نجحت. التفاصيل والحدود في القسم22 من BACKEND_PROGRESS.md.
مرحلة سجل التدقيق السابقة رُفعت إلى origin/main في commit5dc4c5a.

## الغرض ونقطة التغيير المثبتة

التاجر قد يرسل merchantId صحيحًا بحروف كبيرة؛ PostgreSQL وUUID validation
يقبلان الهوية نفسها، لكن ست خدمات تقارن النص الخام بmerchantId القادم من
قاعدة البيانات، فترد403 لتاجره نفسه. خدمات الشحن والمرتجعات تطبع requested
إلى lower-case بالفعل؛ نطبق النمط نفسه في القراءات الباقية.

ملف .env المحلي يبدأ بسطر import dotenv/config غير صالح لتنسيق env. فحص
قراءة فقط أثبت أنه السطر الوحيد غير الصالح وأن حذفه يبقي كل مفاتيح وقيم
الإعدادات التي يقرأها dotenv كما هي. لا أسرار طبعت أو تغيرت في التحقيق.

## المسار الحالي والبنية

HTTP query → UUID validation → controller → private scope/readMerchant →
merchant ownership comparison → Prisma predicates/RepeatableRead → response.
AuthenticationContext يأتي من SessionService وPrisma؛ merchantId فيه هو UUID
قاعدة البيانات canonical. لا نبدل السياق أو نوسع الأدوار أو الملكية.

البيئة: .env → dotenv في Prisma/Nest، و.env → parser Docker Compose في
الأوامر المحلية. dotenv يتجاهل السطر الغريب، بينما Compose يرفض الملف.

## الحل وخريطة الكلاسات والملفات

الخدمات الحالية تظل تملك قواعد نطاق القراءة؛ private scope يطبع requested
قبل المقارنة ويرجع الهوية المطبعة للأدوار الداخلية، وهوية السياق للتاجر.

| الملف | change point |
| --- | --- |
| src/items/items.service.ts | scope requestedMerchantId |
| src/inventory/inventory.service.ts | scope balances/movements |
| src/receipts/receipts.service.ts | readMerchant list/detail |
| src/stock-adjustments/stock-adjustments.service.ts | scope list/detail |
| src/storage-locations/storage-locations.service.ts | scope لكل قراءة تدعم merchantId |
| src/stocktakes/stocktakes-read.service.ts | scope list/lines/scopes |
| test/inventory/merchant-scope.e2e-spec.ts جديد | اختبار عابر لحدود القراءات، ببيانات فعلية لتاجرين |
| .env المحلي المستبعد من Git | إزالة السطر الأول المثبت فقط؛ لا تغيير قيم أو تهيئة حسابات |
| docs/BACKEND_PROGRESS.md وuuid-environment-blueprint.md | توثيق الاعتماد والنتائج والمتبقي |
| docs/inventory-api.md وitems-api.md وreceipts-api.md وstorage-locations-api.md وstocktakes-api.md | سياسة UUID المقصودة للقراءة |

لا global pipe أو Helper/base service؛ التطبيع في change point المحدد يطابق
النمط السليم القائم في shipments/returns. لا إعادة تصميم للخدمات أو تغيير
في DTO/Swagger؛ UUID نفسه ما زال مطلوبًا وصالحًا، والفلتر نفسه مقبول.
لا تعديل write DTOs أو canonical idempotency hashing في هذه المرحلة.

## الأمن والتوافق

- الهوية own merchant بحروف كبيرة/صغيرة/مختلطة تعطي نفس النتيجة.
- هوية تاجر آخر تظل403 بكل تمثيل حرفي. تفاصيل تاجر آخر تظل404؛ no filter
  لا يفتح نطاق التاجر؛ لا تغيير لأدوار الكتابة أو اعتماد الجرد والتسويات.
- requested مفقود يستمر ضمن النطاق الحالي؛ UUID غير صالح أو متعدد القيم
  لا ينفذ SQL قراءة مفوضة؛ global validation يبقى كما هو.
- الشحن/المرتجعات لا تحتاج تعديل مصدر، ويثبت اختبار القراءة أنها تظل متسقة.
- إصلاح .env لا يغير password/secret/user/db/url؛ backup0600 محلي خارجGit
  قبل التعديل، ومقارنة dotenv.parse للمفتاح/القيمة في الذاكرة دون طباعتها.
- لا تسجل .env/backup/config resolved values في Git أو logs. فحص Docker
  Compose config --quiet فقط، ثم تحقق اتصال وhealth؛ لا إعادة إنشاء حاوية
  أو حذف volume أو نقل قاعدة بيانات أو تدوير أسرار.

## خطوات التنفيذ بعد الاعتماد

1. اختبار regression HTTP قبل الإصلاح: own uppercase يعود403 في مسار خام،
   بينما lowercase والشحن/المرتجعات تقبل. إنشاء بيانات منفصلة لتاجرين في
   قاعدة اختبار؛ لا بيانات اختبار للتطوير.
2. تعديل المقارنات الست فقط إلى requested normalized على النمط القائم.
3. التحقق من items/balances/movements/receipts/adjustments/location reads/
   stocktakes reads: own UUID بكل case، other UUID403، تفاصيل أخرى404،
   جميع records ضمن التاجر، وصلاحية الداخلي عبرالتجار محفوظة.
4. backup .env المحلي0600 ثم إزالة السطر الأول فقط مع assert أنه نفس السطر
   المتوقع وأن parsed settings متطابقة. عند اختلاف المكتشف: توقف، بلا
   إعادة كتابة تلقائية أو تعويض قيم مخمنة.
5. build/lint/unit/focused API ثم full API؛ format/diff checks. schema/SQL
   لا تتغير، ولا نعيد اختبارات migration دون سبب جديد.
6. Compose config --quiet وPrisma connection/status وlocal health؛ لا تشغيل
   container mutation. توثيق الفحوص الحالية والحدود والملفات بالاسم.

الخطوة التالية بعد هذا النطاق: تحديد نواقص قواعد الأعمال واعتمادها، ثم قبول
دورة العمل الكاملة وتجهيز التشغيل الآمن وstaging. Flutter ربطه نطاق لاحق.
