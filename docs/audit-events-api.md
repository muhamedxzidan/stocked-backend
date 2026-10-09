# سجل تدقيق التعديلات الدائم

السجل يخص إنشاء وتعديل وحالة الأصناف والصفوف والأرفف والمستخدمين والتجار.
يسجل داخل معاملة التعديل نفسها؛ فشل إدراجه يلغي التعديل وإبطال الجلسات
المصاحب. لا يوجد إنشاء تاريخ قديم افتراضي ولا نقل لتسويات المخزون إلى هذا
السجل؛ دفاتر الحركات والجرد والنقل والشحن والمرتجعات القائمة تبقى مستقلة.

## المسارات والصلاحية

| الطريقة والمسار | الدور | الرد |
| --- | --- | --- |
| GET /api/v1/audit-events | ADMIN | items/total/page/limit |
| GET /api/v1/audit-events/:id | ADMIN | الحدث أو404 |

الجلسة يجب أن تكون فعالة وأن تنتهي خطوة تغيير كلمة المرور الأولية. قراءة
الموظف/أمين المخزن/التاجر مرفوضة403، حتى عندما يخص الحدث عملًا قام به بنفسه.
لا POST/PATCH/DELETE للسجل. قراءته للمدير تستمر أثناء الجرد، وتبقى تعديلات
الأعمال محجوبة حتى انتهاء الجرد وفق بروتوكوله القائم.

الفلاتر فقط entityType/entityId/actorId/action/from/to/page/limit. entityType:
ITEM/ROW/SHELF/USER/MERCHANT؛ action:CREATE/UPDATE/STATUS. UUID v4 مطلوب
للهويات. from شامل وto غير شامل؛ إذا وجدا معًا يجب from<to. الترقيم page1
افتراضيًا حتى1,000,000، limit25 افتراضيًا حتى100. الكسور والصيغة الأسية
والحقول غير المدعومة ترفض400. الترتيب recordedAt ثم id تنازليًا.

## تمثيل الحدث

id/entityType/entityId/action/actorId/actorNameSnapshot/actorRoleSnapshot/
recordedAt/reason/beforeSnapshot/afterSnapshot. recordedAt وقت PostgreSQL
بدقةmilliseconds. هوية واسم ودور الفاعل تؤخذ من المستخدم المقفول داخل
المعاملة قبل تغيير نفسه؛ الاسم اللاحق لا يغيّر فاعل الحدث القديم.

CREATE:reason=null وbeforeSnapshot=null. UPDATE/STATUS:reason نص trim
بين10 و2000 حرف وbeforeSnapshot موجود. afterSnapshot موجود دائمًا. no-op
ناجح يسجل حدثًا بلقطتين متساويتين؛ الفشل لا يسجل تعديلًا ناجحًا.

| النوع | حقول اللقطة المسموحة |
| --- | --- |
| ITEM | id/merchantId/code/name/brand/color/weightKg/notes/isActive |
| ROW | id/warehouseId/code/name/isActive |
| SHELF | id/warehouseId/rowId/merchantId/code/name/isActive |
| USER | id/email/displayName/role/merchantId/isActive/mustChangePassword |
| MERCHANT | id/code/name/phone/isActive |

weightKg نص عشري موجب بثلاث خانات. brand/color/notes قد تكون null؛
merchantId في USER قد يكون null. قبل/بعد يحتويان نفس مجموعة الحقول لكل
نوع. لا initialPassword/passwordHash/token/session/tokenHash. لا نسخ
request body كامل. الاسم والبريد والهاتف بيانات إدارية مقصودة وتقرأ للمدير
فقط؛ يجب عدم وضع أسرار في reason أو الحقول الوصفية.

Swagger ينشر نماذج كل نوع وحالة null. يستعمل anyOf لأن لقطة SHELF تشمل
حقول ROW مع هوية الصف والتاجر؛ oneOf سيجعل الشكل الصحيح يطابق نموذجين
بسبب السماح القياسي بالحقول الإضافية في OpenAPI. DB يفرض مجموعة الحقول
المحددة تمامًا وأنواعها ويمنع الحقول الزائدة، وAPI يستخرجها صراحة.

## أثر التوافق

reason **مطلوب** في PATCH تعديل/حالة users/merchants/items، وفي PATCH
storage-locations/rows/:id أو shelves/:id. لا يصبح حقلًا في كيان المجال.
الطلب القديم بلا reason يعيد400. وجود reason فقط لا يكفي لتعديل؛ يلزم حقل
عمل واحد على الأقل. CREATE لا يتطلب reason، والردود القديمة لم تتغير.

```json
{"name":"اسم الصنف المصحح","reason":"تصحيح الاسم طبقًا لبيانات التاجر المعتمدة"}
```

```json
{"isActive":false,"reason":"إيقاف الصنف بناءً على مراجعة المدير"}
```

إذا جمع تحديث الموقع name وisActive يصنف STATUS وتحفظ اللقطة كلا التعديلين؛
تحديث مستخدم جمع name/role/merchantId يصنف UPDATE وتحفظ كل الاختلافات.

## حدود الحماية والاحتفاظ

Trigger يمنع UPDATE/DELETE، وقيد الفاعل يسمح CREATE ITEM للأدوار الداخلية
المصرح لها، أما بقية الأحداث فللADMIN. FK يمنع حذف الفاعل المرجعي. لا purge
تلقائي؛ الاحتفاظ مستمر حتى اعتماد سياسة أخرى. row trigger لا يمنع المالك
من TRUNCATE/DDL أو تعطيل triggers؛ grants وفصل runtime/migrations والتحقق
من backup/restore لإنتاج بنود مستقلة. التسجيل الصريح يغطي API والخدمات
المحددة، وليس SQL مباشرًا خارجها. أحداث login/password/logout/bootstrap
تبقى logs أمنية منفصلة؛ لم تحول إلى دفتر دائم في هذه المرحلة.
