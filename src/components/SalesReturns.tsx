import React, { useState } from 'react';
import { Search, RotateCcw, CheckCircle2 } from 'lucide-react';
import { supabase } from '../lib/supabase/client';
import { handleError, OperationType } from '../lib/firebase';
import { Order } from '../types';
import { PriceDisplay } from './PriceDisplay';

export default function SalesReturns({ tenantId, shiftId }: { tenantId: string, shiftId?: string }) {
  const [searchQuery, setSearchQuery] = useState('');
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(false);
  const [returnReason, setReturnReason] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSearch = async () => {
    if (!searchQuery) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('tenant_id', tenantId);
      
      if (error) throw error;

      const foundDoc = (data || []).find(d => {
        return (
          d.id.includes(searchQuery) || 
          d.id.slice(-6).toUpperCase() === searchQuery.toUpperCase() ||
          d.order_number?.toString() === searchQuery
        );
      });
      
      if (foundDoc) {
        setOrder({
          ...foundDoc,
          orderNumber: foundDoc.order_number,
          customerId: foundDoc.customer_id,
          customerName: foundDoc.customer_name,
          tenantId: foundDoc.tenant_id,
          shiftId: foundDoc.shift_id,
          totalAmount: foundDoc.total_amount,
          paidAmount: foundDoc.paid_amount,
          remainingAmount: foundDoc.remaining_amount,
          paymentMethod: foundDoc.payment_method,
          orderDate: foundDoc.order_date,
          deliveryDate: foundDoc.delivery_date,
          createdBy: foundDoc.created_by,
          createdAt: foundDoc.created_at,
          updatedAt: foundDoc.updated_at
        } as Order);
      } else {
        alert('لم يتم العثور على الفاتورة');
        setOrder(null);
      }
    } catch (error) {
      handleError(error as any, OperationType.LIST, 'orders');
    } finally {
      setLoading(false);
    }
  };

  const handleReturn = async () => {
    if (!order) return;
    if (!confirm('هل أنت متأكد من إرجاع هذه الفاتورة؟')) return;
    
    setIsSubmitting(true);
    try {
      const { error } = await supabase
        .from('orders')
        .update({
          status: 'cancelled',
          returnReason: returnReason,
          returnedAt: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', order.id);

      if (error) throw error;
      
      alert('تم إرجاع الفاتورة بنجاح');
      setOrder(null);
      setSearchQuery('');
      setReturnReason('');
    } catch (error) {
      handleError(error as any, OperationType.UPDATE, 'orders');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto font-sans" style={{ fontFamily: 'IBM Plex Sans, sans-serif' }}>
      <div className="bg-white p-6 rounded-2xl border border-gray-200 shadow-sm space-y-6">
        <div>
          <h2 className="text-xl font-bold text-gray-800 mb-4">إرجاع فاتورة مبيعات</h2>
          <div className="flex gap-4">
            <div className="group flex-1 flex items-center bg-gray-50 border border-gray-200 rounded-xl focus-within:ring-2 focus-within:ring-[#1C8FFF] transition-all overflow-hidden h-12">
              <div className="flex items-center justify-center px-4 border-e border-gray-200/60 text-gray-400 group-focus-within:text-[#1C8FFF] h-full shrink-0 bg-gray-100/50">
                <Search size={18} />
              </div>
              <input 
                type="text"
                placeholder="أدخل رقم الفاتورة للبحث..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                className="flex-1 min-w-0 bg-transparent border-none py-3 px-4 text-sm text-gray-800 outline-none ring-0 placeholder:text-gray-400 font-semibold"
              />
            </div>
            <button 
              onClick={handleSearch}
              disabled={loading || !searchQuery}
              className="bg-[#1C8FFF] text-white px-6 py-3 rounded-xl font-bold hover:bg-[#1C8FFF]/90 transition-colors disabled:opacity-50"
            >
              {loading ? 'جاري البحث...' : 'بحث'}
            </button>
          </div>
        </div>

        {order && (
          <div className="border-t border-gray-100 pt-6 space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-gray-50 p-4 rounded-xl">
                <p className="text-sm text-gray-500 mb-1">رقم الفاتورة</p>
                <p className="font-bold text-gray-800">#{order.orderNumber || order.id.slice(-6).toUpperCase()}</p>
              </div>
              <div className="bg-gray-50 p-4 rounded-xl">
                <p className="text-sm text-gray-500 mb-1">العميل</p>
                <p className="font-bold text-gray-800">{order.customerName}</p>
              </div>
              <div className="bg-gray-50 p-4 rounded-xl">
                <p className="text-sm text-gray-500 mb-1">التاريخ</p>
                <p className="font-bold text-gray-800" dir="ltr">{new Date(order.orderDate).toLocaleDateString('ar-SA')}</p>
              </div>
              <div className="bg-gray-50 p-4 rounded-xl">
                <p className="text-sm text-gray-500 mb-1">الإجمالي</p>
                <p className="font-bold text-[#1C8FFF]"><PriceDisplay amount={order.totalAmount} /></p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-600 mb-2">سبب الإرجاع</label>
              <textarea 
                value={returnReason}
                onChange={(e) => setReturnReason(e.target.value)}
                className="w-full p-4 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-[#1C8FFF] outline-none h-24 resize-none"
                placeholder="اكتب سبب الإرجاع هنا..."
              />
            </div>

            <button 
              onClick={handleReturn}
              disabled={isSubmitting || order.status === 'cancelled'}
              className="w-full bg-red-600 text-white py-4 rounded-xl font-bold text-lg hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              <RotateCcw size={20} />
              {order.status === 'cancelled' ? 'الفاتورة مرتجعة مسبقاً' : 'تأكيد الإرجاع'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
