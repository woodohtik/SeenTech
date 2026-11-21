# Data for migration 20261231000001_verticals_capabilities.sql
# (seen-verticals-readiness-task.md Phase 1). Filled by hand, row by row --
# no automatic guessing. `python scripts/verticals/phase1_data.py` prints the
# SQL; the migration file is that output, committed as is.

CAPABILITIES = {
    # body_measurements, fabric_consumption, sells_by_length, order_dimensions,
    # orders_module, workshop_term, item_term  (task file table)
    'mens_tailoring':     ('thobe',  True,  True,  False, True,  'tailor',     'thobe'),
    'womens_tailoring':   ('womens', True,  True,  False, True,  'tailor',     'piece'),
    'specialty_clothing': (None,     True,  True,  False, True,  'tailor',     'piece'),
    'fabric_store':       (None,     False, True,  False, False, 'technician', 'piece'),
    'furniture':          (None,     True,  True,  True,  True,  'technician', 'piece'),
}

VERTICAL_NAME_UR = {
    'mens_tailoring': 'مردانہ سلائی',
    'womens_tailoring': 'زنانہ سلائی',
    'furniture': 'فرنیچر اور اپہولسٹری',
    'fabric_store': 'کپڑے کی دکانیں',
    'specialty_clothing': 'خصوصی ملبوسات',
}

# (vertical, stage_key, phase, legacy_status, consumes_materials, label_en, label_ur)
# Rule (task file): first stage -> measurements_taken; middle -> sewing (or the
# enum value of the same name: embroidery / ironing_packaging); ready -> ready;
# delivered / cancelled as named. The stage where material is used is
# consumes_materials, its legacy_status 'cutting'; every stage before it stays
# measurements_taken so fabric is not deducted early. mens_tailoring: the enum
# itself, unchanged.
STAGES = [
    ('mens_tailoring', 'measurements_taken', 'received',    'measurements_taken', False, 'Measurements taken', 'ناپ لے لیا گیا'),
    ('mens_tailoring', 'cutting',            'in_progress', 'cutting',            True,  'Cutting', 'کٹائی'),
    ('mens_tailoring', 'sewing',             'in_progress', 'sewing',             False, 'Sewing', 'سلائی'),
    ('mens_tailoring', 'embroidery',         'in_progress', 'embroidery',         False, 'Embroidery', 'کڑھائی'),
    ('mens_tailoring', 'ironing_packaging',  'in_progress', 'ironing_packaging',  False, 'Ironing & packaging', 'استری اور پیکنگ'),
    ('mens_tailoring', 'ready',              'ready',       'ready',              False, 'Ready', 'تیار'),
    ('mens_tailoring', 'partial_delivered',  'in_progress', 'partial_delivered',  False, 'Partially delivered', 'جزوی حوالگی'),
    ('mens_tailoring', 'delivered',          'delivered',   'delivered',          False, 'Delivered', 'حوالے کر دیا گیا'),
    ('mens_tailoring', 'cancelled',          'cancelled',   'cancelled',          False, 'Cancelled', 'منسوخ'),

    ('womens_tailoring', 'measurements_taken', 'received',    'measurements_taken', False, 'Measurements taken', 'ناپ لے لیا گیا'),
    ('womens_tailoring', 'cutting',            'in_progress', 'cutting',            True,  'Cutting', 'کٹائی'),
    ('womens_tailoring', 'sewing',             'in_progress', 'sewing',             False, 'Sewing', 'سلائی'),
    ('womens_tailoring', 'embroidery',         'in_progress', 'embroidery',         False, 'Embroidery', 'کڑھائی'),
    ('womens_tailoring', 'fitting',            'in_progress', 'sewing',             False, 'Fitting', 'فٹنگ'),
    ('womens_tailoring', 'ironing_packaging',  'in_progress', 'ironing_packaging',  False, 'Ironing & packaging', 'استری اور پیکنگ'),
    ('womens_tailoring', 'ready',              'ready',       'ready',              False, 'Ready', 'تیار'),
    ('womens_tailoring', 'delivered',          'delivered',   'delivered',          False, 'Delivered', 'حوالے کر دیا گیا'),
    ('womens_tailoring', 'cancelled',          'cancelled',   'cancelled',          False, 'Cancelled', 'منسوخ'),

    ('specialty_clothing', 'order_received',      'received',    'measurements_taken', False, 'Order received', 'آرڈر موصول ہوا'),
    ('specialty_clothing', 'design_approval',     'in_progress', 'measurements_taken', False, 'Design / logo approval', 'ڈیزائن / لوگو کی منظوری'),
    ('specialty_clothing', 'cutting',             'in_progress', 'cutting',            True,  'Cutting', 'کٹائی'),
    ('specialty_clothing', 'sewing',              'in_progress', 'sewing',             False, 'Sewing', 'سلائی'),
    ('specialty_clothing', 'printing_embroidery', 'in_progress', 'embroidery',         False, 'Logo printing / embroidery', 'لوگو کی پرنٹنگ / کڑھائی'),
    ('specialty_clothing', 'quality_check',       'in_progress', 'sewing',             False, 'Quality check', 'کوالٹی چیک'),
    ('specialty_clothing', 'ready',               'ready',       'ready',              False, 'Ready', 'تیار'),
    ('specialty_clothing', 'delivered',           'delivered',   'delivered',          False, 'Delivered', 'حوالے کر دیا گیا'),
    ('specialty_clothing', 'cancelled',           'cancelled',   'cancelled',          False, 'Cancelled', 'منسوخ'),

    ('furniture', 'order_received',  'received',    'measurements_taken', False, 'Order received', 'آرڈر موصول ہوا'),
    ('furniture', 'design_approval', 'in_progress', 'measurements_taken', False, 'Design approval', 'ڈیزائن کی منظوری'),
    ('furniture', 'frame_building',  'in_progress', 'measurements_taken', False, 'Frame building', 'فریم کی تیاری'),
    ('furniture', 'upholstery',      'in_progress', 'cutting',            True,  'Upholstery', 'اپہولسٹری'),
    ('furniture', 'finishing',       'in_progress', 'sewing',             False, 'Finishing', 'فنشنگ'),
    ('furniture', 'quality_check',   'in_progress', 'sewing',             False, 'Quality check', 'کوالٹی چیک'),
    ('furniture', 'ready',           'ready',       'ready',              False, 'Ready for delivery', 'حوالگی کے لیے تیار'),
    ('furniture', 'delivered',       'delivered',   'delivered',          False, 'Delivered', 'حوالے کر دیا گیا'),
    ('furniture', 'cancelled',       'cancelled',   'cancelled',          False, 'Cancelled', 'منسوخ'),

    ('fabric_store', 'order_received',    'received',    'measurements_taken', False, 'Order received', 'آرڈر موصول ہوا'),
    ('fabric_store', 'cutting_measuring', 'in_progress', 'cutting',            True,  'Cutting & measuring', 'کٹائی اور پیمائش'),
    ('fabric_store', 'ready_pickup',      'ready',       'ready',              False, 'Ready for pickup', 'وصولی کے لیے تیار'),
    ('fabric_store', 'delivered',         'delivered',   'delivered',          False, 'Delivered', 'حوالے کر دیا گیا'),
    ('fabric_store', 'cancelled',         'cancelled',   'cancelled',          False, 'Cancelled', 'منسوخ'),
]

# (vertical, field_key, label_en, label_ur, options_en, options_ur) -- options in
# the same order as the stored Arabic options; the stored value stays Arabic.
FIELDS = [
    ('fabric_store', 'fabric_type', 'Fabric type', 'کپڑے کی قسم',
     ['Cotton', 'Silk', 'Linen', 'Wool', 'Polyester', 'Lace'], ['سوتی', 'ریشم', 'لینن', 'اون', 'پالئیسٹر', 'لیس']),
    ('fabric_store', 'color', 'Colour', 'رنگ', None, None),
    ('fabric_store', 'pattern', 'Pattern / print', 'ڈیزائن / پرنٹ', None, None),
    ('fabric_store', 'sale_unit', 'Sale unit', 'فروخت کی اکائی', ['Metre', 'Full roll'], ['میٹر', 'پورا رول']),
    ('fabric_store', 'quantity_meters', 'Quantity (m)', 'مقدار (میٹر)', None, None),
    ('fabric_store', 'width_cm', 'Fabric width (cm)', 'کپڑے کی چوڑائی (سینٹی میٹر)', None, None),

    ('furniture', 'piece_type', 'Piece type', 'ٹکڑے کی قسم',
     ['Sofa', 'Chair', 'Mattress', 'Curtain', 'Table'], ['صوفہ', 'کرسی', 'گدا', 'پردہ', 'میز']),
    ('furniture', 'upholstery_fabric', 'Upholstery fabric', 'اپہولسٹری کا کپڑا',
     ['Velvet', 'Leather', 'Cotton', 'Linen'], ['مخمل', 'چمڑا', 'سوتی', 'لینن']),
    ('furniture', 'wood_type', 'Wood type', 'لکڑی کی قسم',
     ['Beech', 'Swedish pine', 'MDF', 'Pine'], ['بیچ', 'سویڈش پائن', 'ایم ڈی ایف', 'پائن']),
    ('furniture', 'foam_density', 'Foam density', 'فوم کی کثافت', ['High', 'Medium', 'Low'], ['زیادہ', 'درمیانی', 'کم']),
    ('furniture', 'dimensions', 'Dimensions', 'پیمائش', None, None),
    ('furniture', 'color', 'Colour', 'رنگ', None, None),

    ('mens_tailoring', 'collar_type', 'Collar type', 'کالر کی قسم', ['Classic', 'Mandarin', 'Round'], ['کلاسک', 'چینی', 'گول']),
    ('mens_tailoring', 'cuff_type', 'Cuff type', 'کف کی قسم', ['Single', 'Double', 'Press stud'], ['سنگل', 'ڈبل', 'بٹن دار']),
    ('mens_tailoring', 'pocket_type', 'Pocket type', 'جیب کی قسم', ['Side', 'Chest', 'Hidden'], ['سائیڈ', 'سینہ', 'چھپی ہوئی']),
    ('mens_tailoring', 'closure_type', 'Closure type', 'بندش کی قسم', ['Zip', 'Buttons'], ['زپ', 'بٹن']),
    ('mens_tailoring', 'collar_padding', 'Collar padding', 'کالر کی لائننگ', ['Stiff', 'Soft'], ['سخت', 'نرم']),
    ('mens_tailoring', 'embroidery', 'Embroidery', 'کڑھائی', None, None),

    ('specialty_clothing', 'uniform_type', 'Uniform type', 'یونیفارم کی قسم',
     ['School', 'Medical', 'Corporate', 'Sports', 'Other'], ['اسکول', 'طبی', 'کمپنی', 'کھیل', 'دیگر']),
    ('specialty_clothing', 'quantity', 'Quantity', 'تعداد', None, None),
    ('specialty_clothing', 'size_range', 'Size range', 'سائز کی رینج', None, None),
    ('specialty_clothing', 'fabric_type', 'Fabric type', 'کپڑے کی قسم',
     ['Cotton', 'Polyester', 'Knit', 'Stain-resistant'], ['سوتی', 'پالئیسٹر', 'نٹ', 'داغ سے محفوظ']),
    ('specialty_clothing', 'color', 'Colour', 'رنگ', None, None),
    ('specialty_clothing', 'logo_placement', 'Logo placement', 'لوگو کی جگہ', None, None),

    ('womens_tailoring', 'garment_type', 'Garment type', 'لباس کی قسم',
     ['Abaya', 'Dress', 'Jalabiya', 'Skirt'], ['عبایا', 'فراک', 'جلابیہ', 'اسکرٹ']),
    ('womens_tailoring', 'sleeve_style', 'Sleeve style', 'آستین کا انداز',
     ['Wide', 'Fitted', 'Flared', 'Sleeveless'], ['کھلی', 'تنگ', 'گھیر دار', 'بغیر آستین']),
    ('womens_tailoring', 'neck_shape', 'Neckline', 'گلے کی شکل', ['Round', 'V', 'Boat', 'Closed'], ['گول', 'وی', 'کشتی نما', 'بند']),
    ('womens_tailoring', 'length', 'Length (cm)', 'لمبائی (سینٹی میٹر)', None, None),
    ('womens_tailoring', 'lining', 'Lining', 'استر', None, None),
    ('womens_tailoring', 'embroidery', 'Embroidery / decoration', 'کڑھائی / سجاوٹ', None, None),
]

# Furniture: question 6 default -- three numeric dimensions, the piece count
# and design notes. (vertical, key, label_ar, label_en, label_ur, type, sort)
NEW_FIELDS = [
    ('furniture', 'width_cm',     'العرض (سم)',      'Width (cm)',   'چوڑائی (سینٹی میٹر)', 'number', 20),
    ('furniture', 'depth_cm',     'العمق (سم)',      'Depth (cm)',   'گہرائی (سینٹی میٹر)', 'number', 21),
    ('furniture', 'height_cm',    'الارتفاع (سم)',   'Height (cm)',  'اونچائی (سینٹی میٹر)', 'number', 22),
    ('furniture', 'pieces_count', 'عدد القطع',       'Number of pieces', 'ٹکڑوں کی تعداد', 'number', 23),
    ('furniture', 'design_notes', 'ملاحظات التصميم', 'Design notes', 'ڈیزائن نوٹس', 'text', 24),
]

# (vertical, category_key, label_en, label_ur, measure_kind)
# length: fabric, lining, lace, upholstery_fabric, and every fabric-store
# category but accessories (task file) -- EXCEPT mens_tailoring, where only
# `fabric` is measured today; making its lining a length category would change
# the men's shops (forbidden), so it stays count.
CATEGORIES = [
    ('fabric_store', 'cotton', 'Cotton', 'سوتی', 'length'),
    ('fabric_store', 'silk', 'Silk', 'ریشم', 'length'),
    ('fabric_store', 'linen', 'Linen', 'لینن', 'length'),
    ('fabric_store', 'wool', 'Wool', 'اون', 'length'),
    ('fabric_store', 'synthetic', 'Synthetic / polyester', 'مصنوعی / پالئیسٹر', 'length'),
    ('fabric_store', 'lace', 'Lace', 'لیس', 'length'),
    ('fabric_store', 'accessories', 'Sewing accessories', 'سلائی کے لوازمات', 'count'),
    ('fabric_store', 'other', 'Other', 'دیگر', 'length'),

    ('furniture', 'wood', 'Wood', 'لکڑی', 'count'),
    ('furniture', 'foam', 'Foam', 'فوم', 'count'),
    ('furniture', 'upholstery_fabric', 'Upholstery fabric', 'اپہولسٹری کا کپڑا', 'length'),
    ('furniture', 'springs', 'Springs', 'اسپرنگ', 'count'),
    ('furniture', 'legs', 'Legs', 'پائے', 'count'),
    ('furniture', 'accessories', 'Accessories', 'لوازمات', 'count'),
    ('furniture', 'other', 'Other', 'دیگر', 'count'),

    ('mens_tailoring', 'fabric', 'Fabric', 'کپڑا', 'length'),
    ('mens_tailoring', 'thread', 'Thread', 'دھاگا', 'count'),
    ('mens_tailoring', 'button', 'Buttons', 'بٹن', 'count'),
    ('mens_tailoring', 'lining', 'Lining', 'استر', 'count'),
    ('mens_tailoring', 'accessories', 'Accessories', 'لوازمات', 'count'),
    ('mens_tailoring', 'ready_made', 'Ready-made', 'ریڈی میڈ', 'count'),
    ('mens_tailoring', 'other', 'Other', 'دیگر', 'count'),

    ('specialty_clothing', 'fabric', 'Fabric', 'کپڑا', 'length'),
    ('specialty_clothing', 'thread', 'Thread', 'دھاگا', 'count'),
    ('specialty_clothing', 'buttons', 'Buttons', 'بٹن', 'count'),
    ('specialty_clothing', 'zippers', 'Zips', 'زپ', 'count'),
    ('specialty_clothing', 'logos_patches', 'Logos & patches', 'لوگو اور بیج', 'count'),
    ('specialty_clothing', 'accessories', 'Accessories', 'لوازمات', 'count'),
    ('specialty_clothing', 'other', 'Other', 'دیگر', 'count'),

    ('womens_tailoring', 'fabric', 'Fabric', 'کپڑا', 'length'),
    ('womens_tailoring', 'thread', 'Thread', 'دھاگا', 'count'),
    ('womens_tailoring', 'button', 'Buttons', 'بٹن', 'count'),
    ('womens_tailoring', 'lining', 'Lining', 'استر', 'length'),
    ('womens_tailoring', 'lace', 'Lace', 'لیس', 'length'),
    ('womens_tailoring', 'accessories', 'Accessories', 'لوازمات', 'count'),
    ('womens_tailoring', 'ready_made', 'Ready-made', 'ریڈی میڈ', 'count'),
    ('womens_tailoring', 'other', 'Other', 'دیگر', 'count'),
]


def q(s):
    return 'NULL' if s is None else "'" + str(s).replace("'", "''") + "'"


def js(v):
    import json
    return 'NULL' if v is None else q(json.dumps(v, ensure_ascii=False)) + '::jsonb'


def b(x):
    return 'true' if x else 'false'


def sql():
    out = []
    caps = []
    for k, (bm, fc, sbl, od, om, wt, it) in CAPABILITIES.items():
        cap = {'body_measurements': bm, 'fabric_consumption': fc, 'sells_by_length': sbl,
               'order_dimensions': od, 'orders_module': om, 'workshop_term': wt, 'item_term': it}
        caps.append(f"  ({q(k)}, {js(cap)}, {q(VERTICAL_NAME_UR[k])})")
    out.append("UPDATE public.verticals v SET capabilities = d.cap, name_ur = d.name_ur\n  FROM (VALUES\n" + ",\n".join(caps) + "\n  ) AS d(key, cap, name_ur)\n WHERE v.key = d.key;")
    rows = [f"  ({q(v)}, {q(k)}, {q(p)}, {q(l)}::order_status, {b(c)}, {q(en)}, {q(ur)})" for v, k, p, l, c, en, ur in STAGES]
    out.append("UPDATE public.vertical_workflow_stages s\n   SET phase = d.phase, legacy_status = d.legacy_status, consumes_materials = d.consumes,\n       label_en = d.label_en, label_ur = d.label_ur\n  FROM (VALUES\n" + ",\n".join(rows) + "\n  ) AS d(vertical_key, stage_key, phase, legacy_status, consumes, label_en, label_ur)\n WHERE s.vertical_key = d.vertical_key AND s.stage_key = d.stage_key;")
    rows = []
    for v, k, en, ur, oen, our in FIELDS:
        oi = None if oen is None else {'en': oen, 'ur': our}
        rows.append(f"  ({q(v)}, {q(k)}, {q(en)}, {q(ur)}, {js(oi)})")
    out.append("UPDATE public.vertical_field_schemas f\n   SET label_en = d.label_en, label_ur = d.label_ur, options_i18n = d.options_i18n\n  FROM (VALUES\n" + ",\n".join(rows) + "\n  ) AS d(vertical_key, field_key, label_en, label_ur, options_i18n)\n WHERE f.vertical_key = d.vertical_key AND f.field_key = d.field_key;")
    rows = [f"  ({q(v)}, {q(k)}, {q(ar)}, {q(en)}, {q(ur)}, {q(t)}, 'order_item', {s})" for v, k, ar, en, ur, t, s in NEW_FIELDS]
    out.append("INSERT INTO public.vertical_field_schemas (vertical_key, field_key, label_ar, label_en, label_ur, field_type, applies_to, sort)\nSELECT * FROM (VALUES\n" + ",\n".join(rows) + "\n) AS d(vertical_key, field_key, label_ar, label_en, label_ur, field_type, applies_to, sort)\nWHERE NOT EXISTS (SELECT 1 FROM public.vertical_field_schemas f WHERE f.vertical_key = d.vertical_key AND f.field_key = d.field_key);")
    rows = [f"  ({q(v)}, {q(k)}, {q(en)}, {q(ur)}, {q(m)})" for v, k, en, ur, m in CATEGORIES]
    out.append("UPDATE public.vertical_inventory_categories c\n   SET label_en = d.label_en, label_ur = d.label_ur, measure_kind = d.measure_kind\n  FROM (VALUES\n" + ",\n".join(rows) + "\n  ) AS d(vertical_key, category_key, label_en, label_ur, measure_kind)\n WHERE c.vertical_key = d.vertical_key AND c.category_key = d.category_key;")
    return "\n\n".join(out)


if __name__ == '__main__':
    import sys
    sys.stdout.reconfigure(encoding='utf-8')
    print(sql())
