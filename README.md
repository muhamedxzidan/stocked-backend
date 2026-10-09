# Stocked Backend

باك اند مستقل لمخزن يخدم عدة تجار باستخدام NestJS وTypeScript وPostgreSQL وPrisma 7، بدون Firebase.

## المنفذ حاليًا

- جداول المستخدمين والتجار والجلسات وقيود الهوية وثبات رمز التاجر.
- API الدخول والخروج والحساب الحالي وتغيير كلمة المرور.
- Argon2id، جلسات opaque محفوظة كبصمات فقط، انتهاء وخمول وتغيير إلزامي لكلمة المرور.
- حراس المصادقة والدور والرفض الافتراضي، وحدود محاولات مشتركة داخل PostgreSQL.
- أمر تهيئة أول مدير تفاعلي لمرة واحدة، دون حسابات أو كلمات مرور افتراضية.
- Swagger للتطوير، وفحص جاهزية اتصال القاعدة.
- إدارة المستخدمين والتجار للمدير فقط، مع حماية آخر مدير وإبطال الجلسات ذريًا عند التغييرات الحساسة.
- دليل الأصناف لكل تاجر، وأكواد محلية ثابتة بعداد ذري مستقل، وقراءة مقيدة بالتاجر وبيانات ملصق CODE128. إنشاء الصنف لا يضيف كمية.
- استلام فعلي ببنود حالة وملاحظات تفصيلية، ورصيد وسجل حركات ذريّان، وقراءة معزولة حسب التاجر، وتسويات موثقة للمدير وأمين المخزن. الاستلام المعيب يدخل الرصيد العام مع حفظ الوصف.

- الشحنات: تسجيل الطلب ثم التجهيز ثم خروج كامل ذري، مع اسم ووقت منفذ كل مرحلة ومنع الصرف فوق المتاح.
- المرتجعات: استلام فعلي ثم فحص كامل ثم قرار مستقل للمجموعات ذات الملاحظات، مع سجل المستلم والفاحص والمعتمد، وسقف إرجاع محمي وصلاحيات قراءة معزولة. [عقد المرتجعات](docs/returns-api.md).

الجرد وقفل الحركات أثناءه مرحلة تالية. ثغرات اعتماديات Prisma وقائمة تحضيرات النشر لم تغلق بعد؛ لا يعتبر المشروع جاهزًا للإنتاج.

## التشغيل المحلي

يحتاج Node.js متوافقًا مع الحزم المثبتة (يفضل LTS مدعومًا)، وnpm وDocker Desktop.

```bash
npm ci
cp .env.example .env
```

هذه خطوة أول مرة فقط؛ لا تستبدل .env الموجودة. اضبط بيانات PostgreSQL وDATABASE_URL، وولد AUTH_RATE_LIMIT_SECRET عشوائيًا وضعه في .env:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
docker compose up -d
npx prisma generate
npx prisma migrate deploy
npm run admin:bootstrap
npm run start:dev
```

admin:bootstrap يطلب كلمة المرور بإدخال مخفي ويمنع التنفيذ بعد وجود أي حساب. لم ينشئ تنفيذ المرحلة مديرًا في قاعدة التطوير. التفاصيل وعقد API في [دليل المصادقة](docs/auth-api.md).

- API: http://127.0.0.1:3000/api/v1
- Swagger محلي: http://127.0.0.1:3000/api/docs
- جاهزية القاعدة: http://127.0.0.1:3000/api/v1/health

تغيير كلمة PostgreSQL في .env لا يغير كلمة القاعدة في volume قائمة. لا تستخدم docker compose down -v إلا إذا قصدت حذف بيانات التطوير.
migrate deploy يطبق ترحيلات موجودة؛ لا يغير التصميم تلقائيًا. لا توجه أوامر التطوير إلى إنتاج.

## التحقق

```bash
npx prisma validate
npx prisma migrate status
npm run lint
npm run build
npm test
npm run test:e2e
npm run test:db
```

اختبارات API وDB تنشئ قواعد محلية منفصلة عشوائية وتحذفها؛ تحتاج Docker وstocked_dev المحلية وصلاحية CREATE DATABASE، ولا تضيف fixtures إلى قاعدة التطوير.

## تقسيم المشروع

| المسار | المسؤولية |
|---|---|
| src/config/ | إعدادات موثوقة والتحقق من البيئة |
| src/database/ | اتصال Prisma ودورة حياته |
| src/auth/ | الدخول والجلسات والحراس وإعادة التفويض داخل المعاملات الإدارية |
| src/users/ | إدارة الحسابات والأدوار وحماية آخر مدير |
| src/merchants/ | إدارة التجار وثبات الرمز وحالة النشاط |
| src/items/ | الأصناف وعزل الملكية وتخصيص الأكواد وبيانات الملصق |
| src/receipts/ | مستندات الاستلام وبنود الحالة وهوية المستلم ووقت الخادم |
| src/inventory/ | أقفال الأرصدة وترحيل دفتر الحركات وقراءة المخزون |
| src/stock-adjustments/ | تصحيحات موثقة تقتصر على المدير وأمين المخزن |
| src/bootstrap/ | إنشاء أول مدير عبر CLI |
| src/http/ | حدود HTTP والتحقق والأخطاء وتوثيق OpenAPI |
| src/health/ | جاهزية اتصال PostgreSQL |
| prisma/schema.prisma | النماذج والعلاقات |
| prisma/migrations/ | SQL وتاريخ الترحيلات والقيود |
| test/ | اختبارات كلمة المرور وHTTP وقيود PostgreSQL |
| scripts/cleanup-login-attempts.mjs | صيانة عدادات المحاولات المنتهية |

المسار: HTTP → Guards → DTO → Controller → Service → Prisma → PostgreSQL. الكتابات الإدارية تعيد التفويض داخل المعاملة.
اللوجيك في الخدمات؛ Controller لا يحتفظ بقواعد كلمة المرور أو SQL. لا تعديل في Flutter.

## المستندات

- [حالة التنفيذ الكاملة وخطة الاستكمال](docs/BACKEND_PROGRESS.md) — ابدأ به عند العودة للمشروع.
- [تصميم قاعدة البيانات](docs/database-design.md)
- [سياسة الأمان](docs/auth-security-policy.md)
- [بلوبرنت التنفيذ ومراحل الاستكمال](docs/auth-implementation-blueprint.md)
- [عقد المصادقة وتعليمات التشغيل وحدود الإنتاج](docs/auth-api.md)
- [دليل إدارة المستخدمين والتجار](docs/admin-api.md)
- [بلوبرنت الإدارة المعتمد](docs/users-merchants-blueprint.md)
- [دليل الأصناف والباركود](docs/items-api.md)
- [بلوبرنت الأصناف المعتمد](docs/items-barcode-blueprint.md)
- [عقد الاستلام والتسويات](docs/receipts-api.md)
- [عقد الأرصدة وسجل الحركات](docs/inventory-api.md)
- [مخطط تنفيذ الاستلام والمخزون](docs/receipts-inventory-blueprint.md)

.env وnode_modules وdist وsrc/generated/prisma والكاش غير متتبعة في Git. بيانات PostgreSQL ليست جزءًا من المستودع. لا تستخدم npm audit fix --force؛ التحذيرات المتبقية موثقة في دليل المصادقة.

## Shipments

The backend supports immutable order registration, preparation and full atomic warehouse dispatch. Registration/preparation do not reserve stock. See [shipment API and operational limits](docs/shipments-api.md) and the [approved implementation blueprint](docs/shipments-blueprint.md). Each milestone preserves its actor and server timestamp; merchant reads are ownership-scoped.
