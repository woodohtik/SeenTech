/**
 * seen-readiness-fixes-task.md P6 (ZATCA-16, CODEHEALTH-09): who the seller
 * is on a printed tax invoice.
 *
 * The invoice layout settings live in the browser (localStorage), and their
 * header used to REPLACE the seller's name, VAT number and address -- so the
 * legal details of a tax invoice could be changed on any device, and differ
 * from what the server recorded and sent to ZATCA.
 *
 * Now the shop's official details (from the server) always win. A layout
 * value is used only to fill an official field that is empty, so a shop that
 * has not completed its official details still prints what it typed. The
 * contact numbers and the logo are presentation, and stay the layout's.
 */
export type SellerDetails = {
  name?: string | null;
  vatNumber?: string | null;
  address?: string | null;
  phone?: string | null;
  logoUrl?: string | null;
};

export type LayoutHeader = {
  facilityName?: string | null;
  taxId?: string | null;
  address?: string | null;
  contactNumbers?: string | null;
  logoUrl?: string | null;
} | null | undefined;

const present = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
/** A VAT number of only zeros is the old placeholder, not a number. */
const realVat = (v: unknown): v is string => present(v) && !/^0+$/.test(v.trim());

export function sellerForInvoice(official: SellerDetails | null | undefined, header: LayoutHeader) {
  const o: SellerDetails = official || {};
  return {
    name: present(o.name) ? o.name : present(header?.facilityName) ? header!.facilityName! : '',
    vatNumber: realVat(o.vatNumber) ? o.vatNumber : realVat(header?.taxId) ? header!.taxId! : '',
    address: present(o.address) ? o.address : present(header?.address) ? header!.address! : '',
    phone: present(header?.contactNumbers) ? header!.contactNumbers! : (o.phone ?? ''),
    logoUrl: present(header?.logoUrl) ? header!.logoUrl! : (o.logoUrl ?? ''),
  };
}
