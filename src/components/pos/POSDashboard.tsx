import React, { useState, useEffect } from 'react';
import { Customer, InventoryItem } from '../../types/supabase';
import { supabase } from '../../lib/supabase/client';
import CustomerSection from './CustomerSection';
import ProductsGrid from './ProductsGrid';
import CartSidebar, { CartItem } from './CartSidebar';

interface POSDashboardProps {
  tenantId: string;
}

export default function POSDashboard({ tenantId }: POSDashboardProps) {
  // State
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [cartItems, setCartItems] = useState<CartItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Fetch initial data
  useEffect(() => {
    const fetchData = async () => {
      setIsLoading(true);
      try {
        const [customersRes, inventoryRes] = await Promise.all([
          supabase.from('customers').select('*').eq('tenant_id', tenantId),
          supabase.from('inventory_items').select('*').eq('tenant_id', tenantId)
        ]);

        if (customersRes.data) setCustomers(customersRes.data);
        if (inventoryRes.data) setInventory(inventoryRes.data);
      } catch (error) {
        console.error('Error fetching POS data:', error);
      } finally {
        setIsLoading(false);
      }
    };

    if (tenantId) {
      fetchData();
    }
  }, [tenantId]);

  // Cart actions
  const addToCart = (item: InventoryItem, quantity: number = 1) => {
    setCartItems(prev => {
      const existing = prev.find(i => i.item.id === item.id);
      if (existing) {
        return prev.map(i => i.item.id === item.id ? { ...i, quantity: i.quantity + quantity } : i);
      }
      return [...prev, { id: crypto.randomUUID(), item, quantity }];
    });
  };

  const updateCartQuantity = (cartItemId: string, quantity: number) => {
    setCartItems(prev => prev.map(i => i.id === cartItemId ? { ...i, quantity } : i));
  };

  const removeFromCart = (cartItemId: string) => {
    setCartItems(prev => prev.filter(i => i.id !== cartItemId));
  };

  const clearSession = () => {
    setCartItems([]);
    setSelectedCustomer(null);
  };

  const refreshCustomers = async () => {
    const res = await supabase.from('customers').select('*').eq('tenant_id', tenantId);
    if (res.data) setCustomers(res.data);
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-brand"></div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col md:flex-row overflow-hidden bg-gray-100" dir="rtl">
      {/* Main Content Area: Customers + Products */}
      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <div className="p-4 space-y-4">
          <CustomerSection 
            tenantId={tenantId}
            customers={customers} 
            selectedCustomer={selectedCustomer} 
            setSelectedCustomer={setSelectedCustomer}
            onCustomerAdded={refreshCustomers}
          />
          <ProductsGrid 
            inventory={inventory} 
            onAddToCart={addToCart} 
          />
        </div>
      </div>

      {/* Right Sidebar: Cart */}
      <CartSidebar 
        tenantId={tenantId}
        cartItems={cartItems}
        selectedCustomer={selectedCustomer}
        onUpdateQuantity={updateCartQuantity}
        onRemove={removeFromCart}
        onCheckoutSuccess={clearSession}
      />
    </div>
  );
}
