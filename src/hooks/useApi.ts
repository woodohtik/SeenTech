import { createServiceHooks } from '../lib/api/factory';

export const useCustomers = createServiceHooks('customers');
export const useOrders = createServiceHooks('orders');
export const useInventoryItems = createServiceHooks('inventory_items');
export const useStaff = createServiceHooks('staff');
