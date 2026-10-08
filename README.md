# Stocked Backend

باك إند مستقل لإدارة مخزن يخدم عدة تجار، باستخدام NestJS وTypeScript وPostgreSQL وPrisma 7، بدون Firebase.

## الحالة الحالية

تم تنفيذ جداول المستخدمين والتجار والجلسات، والقيود والترحيل واختبارات قاعدة البيانات. API تسجيل الدخول والصلاحيات التطبيقية وعمليات المخزون لم تنفذ بعد. السيرفر الحالي يقدم استجابة NestJS التجريبية فقط. ثغرات الاعتماديات المرصودة سابقًا تحتاج معالجة قبل النشر؛ هذا المشروع ليس جاهزًا للإنتاج.

## المتطلبات

- إصدار Node.js متوافق مع نسخ NestJS/Prisma المثبتة؛ يفضل LTS مدعوم.
- npm وDocker Desktop مع Docker Compose.

## التشغيل المحلي

```bash
npm ci
cp .env.example .env
```

عدّل كلمة المرور في .env ورابط DATABASE_URL بما يتطابق معها، ثم:

```bash
docker compose up -d
npx prisma migrate deploy
npx prisma generate
npm run start:dev
```

السيرفر المحلي: http://localhost:3000. أمر migrate deploy يطبق الترحيلات القائمة؛ لا يصمم جداول جديدة. إعداد DATABASE_URL الحالي محلي؛ لا توجه هذه الخطوات إلى قاعدة إنتاج دون خطة نشر معتمدة.

إذا أبلغ npm عن سكربتات تثبيت جديدة غير معتمدة، راجعها قبل السماح لها؛ الموافقات الحالية محددة لنسخة Prisma الموجودة. لا تستخدم npm audit fix --force كتحديث عام.

كلمة المرور المستخدمة أول مرة تُهيئ volume PostgreSQL. تغيير .env لاحقًا لا يغير كلمة مرور القاعدة الموجودة تلقائيًا. لا تستخدم docker compose down -v إلا إذا قصدت حذف بيانات التطوير.

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

اختبار test:db يحتاج Docker وقاعدة stocked_dev المحلية وصلاحية CREATE DATABASE. ينشئ قاعدة اختبار منفصلة باسم عشوائي ثم يحذفها، دون fixtures في stocked_dev.

## التنظيم

- prisma/schema.prisma: نماذج الهوية والعلاقات.
- prisma/migrations/: SQL قابل للمراجعة بما فيه CHECK وTrigger غير الممثلة في Prisma.
- src/: كود NestJS؛ src/generated/prisma مولد محليًا وغير محفوظ في Git.
- test/database/: اختبارات قيود PostgreSQL.
- [تصميم قاعدة البيانات](docs/database-design.md).
- [سياسة أمان تسجيل الدخول](docs/auth-security-policy.md).
- compose.yaml: PostgreSQL محلية مع تخزين دائم.
- .env.example: نموذج الإعداد دون بيانات حقيقية.

.env وnode_modules وdist وملفات التوليد والكاش لا ترفع إلى المستودع. البيانات الموجودة في PostgreSQL ليست جزءًا من Git. لا أسرار أو حسابات تشغيل جاهزة داخل المشروع.
