/**
 * A test shop for each vertical that is not men's tailoring
 * (seen-open-verticals-task.md, phase 0 items 2-3), only in the local,
 * throw-away database CI starts -- never on staging or production. Owners
 * are *@golden.test, with the golden paths' test password. seed.ts builds them.
 */
export interface VerticalShop {
  vertical: 'womens_tailoring' | 'specialty_clothing' | 'fabric_store' | 'furniture';
  tenantId: string;
  branchId: string;
  ownerStaffId: string;
  ownerEmail: string;
  name: string;
  customer: { id: string; name: string; phone: string };
  /** A length item (sold by the metre) and a piece item. */
  lengthItem: { id: string; name: string; categoryKey: string; price: number; stock: number };
  pieceItem: { id: string; name: string; categoryKey: string; price: number; stock: number };
  /** An order already in the first stage, for the stage path (none for the fabric store: orders are off). */
  order?: { id: string; number: number; firstStage: string; stages: string[] };
  /** Words from another vertical that must not show on this one's screens (phase 0 item 4). */
  forbiddenWords: string[];
}

const id = (n: number, tail: string) => `0e00000${n}-0000-4000-8000-${tail.padStart(12, '0')}`;

export const VERTICAL_SHOPS: VerticalShop[] = [
  {
    vertical: 'womens_tailoring', tenantId: id(2, '1'), branchId: id(2, 'b1'), ownerStaffId: id(2, 'c1'),
    ownerEmail: 'owner-womens@golden.test', name: 'مشغل الاختبار النسائي',
    customer: { id: id(2, 'e1'), name: 'عميلة الاختبار', phone: '0502222221' },
    lengthItem: { id: id(2, 'f1'), name: 'شيفون الاختبار', categoryKey: 'fabric', price: 30, stock: 50 },
    pieceItem: { id: id(2, 'f2'), name: 'عباية جاهزة الاختبار', categoryKey: 'ready_made', price: 250, stock: 5 },
    order: { id: id(2, 'd1'), number: 1, firstStage: 'measurements_taken', stages: ['cutting', 'sewing', 'embroidery', 'fitting', 'ironing_packaging', 'ready', 'delivered'] },
    forbiddenWords: ['ثوب'],
  },
  {
    vertical: 'specialty_clothing', tenantId: id(3, '1'), branchId: id(3, 'b1'), ownerStaffId: id(3, 'c1'),
    ownerEmail: 'owner-specialty@golden.test', name: 'مصنع الاختبار للزي',
    customer: { id: id(3, 'e1'), name: 'مدرسة الاختبار', phone: '0503333331' },
    lengthItem: { id: id(3, 'f1'), name: 'قماش زي الاختبار', categoryKey: 'fabric', price: 18, stock: 200 },
    pieceItem: { id: id(3, 'f2'), name: 'شعار مطرز الاختبار', categoryKey: 'accessories', price: 5, stock: 100 },
    order: { id: id(3, 'd1'), number: 1, firstStage: 'order_received', stages: ['design_approval', 'cutting', 'sewing', 'printing_embroidery', 'quality_check', 'ready', 'delivered'] },
    forbiddenWords: ['ثوب'],
  },
  {
    vertical: 'fabric_store', tenantId: id(4, '1'), branchId: id(4, 'b1'), ownerStaffId: id(4, 'c1'),
    ownerEmail: 'owner-fabric@golden.test', name: 'محل أقمشة الاختبار',
    customer: { id: id(4, 'e1'), name: 'عميل الأقمشة', phone: '0504444441' },
    lengthItem: { id: id(4, 'f1'), name: 'كتان الاختبار', categoryKey: 'linen', price: 25, stock: 60 },
    pieceItem: { id: id(4, 'f2'), name: 'مقص الاختبار', categoryKey: 'accessories', price: 40, stock: 10 },
    forbiddenWords: ['ثوب', 'خياط', 'تفصيل', 'مقاسات الثوب'],
  },
  {
    vertical: 'furniture', tenantId: id(5, '1'), branchId: id(5, 'b1'), ownerStaffId: id(5, 'c1'),
    ownerEmail: 'owner-furniture@golden.test', name: 'محل تنجيد الاختبار',
    customer: { id: id(5, 'e1'), name: 'عميل التنجيد', phone: '0505555551' },
    lengthItem: { id: id(5, 'f1'), name: 'قماش تنجيد الاختبار', categoryKey: 'upholstery_fabric', price: 45, stock: 80 },
    pieceItem: { id: id(5, 'f2'), name: 'إسفنج الاختبار', categoryKey: 'foam', price: 60, stock: 20 },
    order: { id: id(5, 'd1'), number: 1, firstStage: 'order_received', stages: ['design_approval', 'frame_building', 'upholstery', 'finishing', 'quality_check', 'ready', 'delivered'] },
    forbiddenWords: ['ثوب', 'خياط', 'تفصيل', 'مقاسات الثوب'],
  },
];
