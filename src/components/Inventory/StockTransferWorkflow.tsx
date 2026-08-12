import React, { useState, useEffect } from 'react';
import { 
  ArrowRightLeft, 
  Clock, 
  Truck, 
  CheckCircle2, 
  XCircle, 
  AlertTriangle,
  ChevronRight,
  User,
  Calendar,
  Package,
  ArrowRight,
  MoreVertical,
  Search,
  Filter,
  Check,
  X
} from 'lucide-react';
import { supabase } from '../../lib/supabase/client';
import { auth, handleError, OperationType } from '../../lib/firebase';
import { StockTransfer, Branch, BranchInventory, StockLedger, InventoryItem } from '../../types';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';
import Branding from '../Branding';
import { localeOf } from '../../lib/direction';
import i18n from '../../i18n/config';

interface StockTransferWorkflowProps {
  tenantId: string;
}

const StockTransferWorkflow: React.FC<StockTransferWorkflowProps> = ({ tenantId }) => {
  const { t } = useTranslation();
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTransfer, setSelectedTransfer] = useState<StockTransfer | null>(null);
  const [filterStatus, setFilterStatus] = useState<string>('all');
  // Ship/receive had no re-entrancy guard and no disabled button, so two clicks ran the
  // whole deduction loop twice — 60 m in stock, ship 50 m twice, balance -40 m.
  const [busyTransferId, setBusyTransferId] = useState<string | null>(null);

  const mapDbTransferToStockTransfer = (item: any): StockTransfer => {
    const dbItems = item.stock_transfer_items || [];
    const items = dbItems.map((dbItem: any) => ({
      itemId: dbItem.item_id,
      itemName: dbItem.item_name,
      requestedQuantity: Number(dbItem.requested_quantity),
      shippedQuantity: dbItem.shipped_quantity !== null ? Number(dbItem.shipped_quantity) : undefined,
      receivedQuantity: dbItem.received_quantity !== null ? Number(dbItem.received_quantity) : undefined,
    }));

    return {
      id: item.id,
      fromBranchId: item.from_branch_id,
      toBranchId: item.to_branch_id,
      items,
      status: item.status,
      requestedBy: item.requested_by,
      requestedByName: item.requested_by_name,
      shippedBy: item.shipped_by,
      receivedBy: item.received_by,
      notes: item.notes,
      remarks: item.remarks,
      tenantId: item.tenant_id,
      createdAt: item.created_at,
      shippedAt: item.shipped_at,
      receivedAt: item.received_at,
      updatedAt: item.updated_at,
    };
  };

  useEffect(() => {
    if (!tenantId) return;

    const fetchTransfers = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('stock_transfers')
        .select('*, stock_transfer_items(*)')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });
      
      if (error) {
        handleError(error, OperationType.LIST, 'stock_transfers');
      } else {
        setTransfers((data || []).map(mapDbTransferToStockTransfer));
      }
      setLoading(false);
    };

    fetchTransfers();

    const channel = supabase
      .channel('transfers-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'stock_transfers', filter: `tenant_id=eq.${tenantId}` }, () => {
        fetchTransfers();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId]);

  useEffect(() => {
    if (!tenantId) return;

    const fetchBranches = async () => {
      const { data, error } = await supabase
        .from('branches')
        .select('*')
        .eq('tenant_id', tenantId);
      
      if (error) {
        handleError(error, OperationType.LIST, 'branches');
      } else {
        setBranches(data as Branch[]);
      }
    };

    fetchBranches();
  }, [tenantId]);

  const getBranchName = (id: string) => branches.find(b => b.id === id)?.name || id;

  const handleShip = async (transfer: StockTransfer) => {
    if (busyTransferId) return;
    setBusyTransferId(transfer.id);
    try {
      /* --------------------------------------------------------------------
         The old loop did: read quantity -> compute currentQty - requested ->
         write the absolute value, all client-side, with
           * no availability re-check at ship time (only at request time), so a
             transfer requested on Monday could drive the branch negative on
             Wednesday after the stock had been sold;
           * an `if (stockSnap)` that silently skipped the deduction AND the
             ledger row when the source branch had no inventory row, while
             still marking the line shipped — the destination was then credited
             the full amount, creating stock from nothing;
           * a lost-update race against any concurrent sale.

         One server call per line now does the delta, the >= 0 check and the
         ledger row in a single transaction, keyed for idempotency.
         -------------------------------------------------------------------- */
      for (const item of transfer.items) {
        const { error } = await supabase.rpc('transfer_ship_item', {
          p_operation_id: `${transfer.id}:${item.itemId}:ship`,
          p_transfer_id: transfer.id,
          p_from_branch: transfer.fromBranchId,
          p_item_id: item.itemId,
          p_qty: item.requestedQuantity,
        });
        if (error) throw error;

        await supabase
          .from('stock_transfer_items')
          .update({ shipped_quantity: item.requestedQuantity })
          .eq('transfer_id', transfer.id)
          .eq('item_id', item.itemId);
      }

      // 4. Update transfer status to in_transit
      await supabase
        .from('stock_transfers')
        .update({
          status: 'in_transit',
          shipped_by: auth.currentUser?.uid,
          shipped_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        })
        .eq('id', transfer.id);

    } catch (error) {
      handleError(error as any, OperationType.UPDATE, 'stock_transfers');
    } finally {
      setBusyTransferId(null);
    }
  };

  const handleReceive = async (transfer: StockTransfer, receivedQuantities: Record<string, number>, remarks: string) => {
    if (busyTransferId) return;
    setBusyTransferId(transfer.id);
    try {
      /* --------------------------------------------------------------------
         Same treatment as handleShip. Additionally the old code wrote a
         "discrepancy" ledger row with previous_quantity == new_quantity but a
         non-zero `change`, and with no matching stock write — so a shortfall
         was counted twice in the reports. The received quantity is the only
         thing that moves stock; the shortfall is recorded on the transfer line
         itself, not as a phantom ledger entry.
         -------------------------------------------------------------------- */
      for (const item of transfer.items) {
        const receivedQty = Math.max(0, Number(receivedQuantities[item.itemId]) || 0);

        if (receivedQty > 0) {
          const { error } = await supabase.rpc('transfer_receive_item', {
            p_operation_id: `${transfer.id}:${item.itemId}:receive`,
            p_transfer_id: transfer.id,
            p_to_branch: transfer.toBranchId,
            p_item_id: item.itemId,
            p_qty: receivedQty,
          });
          if (error) throw error;
        }

        await supabase
          .from('stock_transfer_items')
          .update({ received_quantity: receivedQty })
          .eq('transfer_id', transfer.id)
          .eq('item_id', item.itemId);
      }

      await supabase
        .from('stock_transfers')
        .update({
          status: 'completed',
          received_by: auth.currentUser?.uid,
          received_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          remarks: remarks || null
        })
        .eq('id', transfer.id);

      setSelectedTransfer(null);
    } catch (error) {
      handleError(error as any, OperationType.UPDATE, 'stock_transfers');
    } finally {
      setBusyTransferId(null);
    }
  };

  const statusMap: Record<string, { label: string, color: string, icon: any }> = {
    pending: { label: t('inventory.status_pending'), color: 'bg-warning/10 text-warning', icon: Clock },
    in_transit: { label: t('inventory.status_in_transit'), color: 'bg-brand/10 text-brand', icon: Truck },
    completed: { label: t('inventory.status_completed'), color: 'bg-success/10 text-success', icon: CheckCircle2 },
    rejected: { label: t('inventory.status_rejected'), color: 'bg-danger/10 text-danger', icon: XCircle }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-content flex items-center gap-3">
            <ArrowRightLeft className="text-brand" size={32} />
            {t('inventory.transfers_title')}
          </h1>
          <p className="text-content-muted font-medium mt-1">{t('inventory.transfers_subtitle')}</p>
        </div>
      </div>

      <div className="bg-surface p-4 rounded-[2rem] border border-border shadow-sm flex items-center gap-4">
        <Filter className="text-content-muted/40" size={20} />
        <div className="flex gap-2">
          {['all', 'pending', 'in_transit', 'completed'].map(status => (
            <button
              key={status}
              onClick={() => setFilterStatus(status)}
              className={cn(
                "px-6 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all",
                filterStatus === status 
                  ? "bg-brand text-white shadow-lg shadow-brand/10" 
                  : "bg-surface-muted text-content-muted hover:bg-border/20"
              )}
            >
              {status === 'all' ? t('common.all') : t(`inventory.status_${status}`, statusMap[status]?.label || status)}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        {transfers
          .filter(t => filterStatus === 'all' || t.status === filterStatus)
          .map((transfer) => {
            const status = statusMap[transfer.status] || statusMap.pending;
            const StatusIcon = status.icon;
            
            return (
              <motion.div 
                key={transfer.id}
                layout
                className="bg-surface rounded-[2rem] border border-border shadow-sm hover:shadow-xl transition-all group overflow-hidden"
              >
                <div className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
                  <div className="flex items-center gap-6">
                    <div className={cn("p-4 rounded-2xl", status.color)}>
                      <StatusIcon size={24} />
                    </div>
                    
                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <span className="text-sm font-black text-content">{getBranchName(transfer.fromBranchId)}</span>
                        <ArrowRight size={16} className="text-border" />
                        <span className="text-sm font-black text-content">{getBranchName(transfer.toBranchId)}</span>
                      </div>
                      <div className="flex items-center gap-4 text-xs font-bold text-content-muted uppercase tracking-widest">
                        <span className="flex items-center gap-1"><Package size={12} /> {transfer.items.length} {t('inventory.items')}</span>
                        <span className="flex items-center gap-1"><Calendar size={12} /> {new Date(transfer.createdAt).toLocaleDateString(localeOf(i18n.language))}</span>
                        <span className="flex items-center gap-1"><User size={12} /> {transfer.requestedByName}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    {transfer.status === 'pending' && (
                      <button 
                        onClick={() => handleShip(transfer)}
                        disabled={busyTransferId === transfer.id}
                        className="bg-brand text-white px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-brand/90 transition-all shadow-lg shadow-brand/10 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {busyTransferId === transfer.id ? t('common.saving') : t('inventory.ship_items')}
                      </button>
                    )}
                    {transfer.status === 'in_transit' && (
                      <button 
                        onClick={() => setSelectedTransfer(transfer)}
                        className="bg-success text-white px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-success/90 transition-all shadow-lg shadow-success/10"
                      >
                        {t('inventory.receive_items')}
                      </button>
                    )}
                    <button 
                      onClick={() => setSelectedTransfer(transfer)}
                      className="bg-surface-muted text-content-muted px-6 py-2.5 rounded-xl font-black text-xs uppercase tracking-widest hover:bg-border/20 transition-all"
                    >
                      {t('common.details')}
                    </button>
                  </div>
                </div>
              </motion.div>
            );
          })}
      </div>

      <AnimatePresence>
        {selectedTransfer && (
          <TransferDetailsModal 
            transfer={selectedTransfer} 
            onClose={() => setSelectedTransfer(null)} 
            onReceive={handleReceive}
            getBranchName={getBranchName}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

const TransferDetailsModal = ({ transfer, onClose, onReceive, getBranchName }: any) => {
  const { t } = useTranslation();
  const [receivedQuantities, setReceivedQuantities] = useState<Record<string, number>>(
    transfer.items.reduce((acc: any, item: any) => ({ ...acc, [item.itemId]: item.shippedQuantity || item.requestedQuantity }), {})
  );
  const [remarks, setRemarks] = useState(transfer.remarks || '');

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div 
        initial={{ opacity: 0 }} 
        animate={{ opacity: 1 }} 
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-md" 
        onClick={onClose} 
      />
      <motion.div 
        initial={{ scale: 0.9, opacity: 0, y: 20 }} 
        animate={{ scale: 1, opacity: 1, y: 0 }}
        exit={{ scale: 0.9, opacity: 0, y: 20 }}
        className="bg-white w-full max-w-3xl rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden flex flex-col"
      >
        <div className="p-8 border-b border-border flex justify-between items-center bg-surface-muted/50">
          <div className="flex items-center gap-4">
            <div className="p-4 bg-brand text-white rounded-2xl shadow-lg shadow-brand/10">
              <Package size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-content">{t('inventory.transfer_details')}</h2>
              <p className="text-xs text-content-muted font-bold uppercase tracking-widest">ID: {transfer.id.substring(0, 8)}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-surface rounded-full transition-colors shadow-sm">
            <X size={24} className="text-content-muted" />
          </button>
        </div>

        <div className="p-8 space-y-8 overflow-y-auto max-h-[70vh]">
          <div className="grid grid-cols-2 gap-8">
            <div className="space-y-4">
              <h3 className="text-xs font-black text-content-muted uppercase tracking-widest">{t('inventory.from')}</h3>
              <div className="p-4 bg-surface-muted rounded-2xl border border-border">
                <p className="font-black text-content">{getBranchName(transfer.fromBranchId)}</p>
                <p className="text-xs font-bold text-content-muted uppercase tracking-widest mt-1">{t('inventory.source_location')}</p>
              </div>
            </div>
            <div className="space-y-4">
              <h3 className="text-xs font-black text-content-muted uppercase tracking-widest">{t('inventory.to')}</h3>
              <div className="p-4 bg-surface-muted rounded-2xl border border-border">
                <p className="font-black text-content">{getBranchName(transfer.toBranchId)}</p>
                <p className="text-xs font-bold text-content-muted uppercase tracking-widest mt-1">{t('inventory.destination_location')}</p>
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <h3 className="text-xs font-black text-content-muted uppercase tracking-widest">{t('inventory.items_list')}</h3>
            <div className="space-y-3">
              {transfer.items.map((item: any) => (
                <div key={item.itemId} className="p-5 bg-surface border border-border rounded-3xl flex items-center justify-between group hover:border-brand/20 transition-all">
                  <div>
                    <p className="font-black text-content">{item.itemName}</p>
                  </div>
                  
                  <div className="flex items-center gap-8">
                    <div className="text-center">
                      <p className="text-xs font-black text-content-muted uppercase tracking-widest mb-1">{t('inventory.requested')}</p>
                      <p className="font-black text-content">{item.requestedQuantity}</p>
                    </div>
                    
                    {transfer.status === 'in_transit' ? (
                      <div className="text-center">
                        <p className="text-xs font-black text-brand uppercase tracking-widest mb-1">{t('inventory.receiving')}</p>
                        <input 
                          type="number"
                          value={receivedQuantities[item.itemId]}
                          onChange={e => setReceivedQuantities({...receivedQuantities, [item.itemId]: Number(e.target.value)})}
                          className="w-20 px-3 py-1.5 bg-brand/10 border-none rounded-xl focus:ring-2 focus:ring-brand font-black text-center text-brand"
                        />
                      </div>
                    ) : (
                      <>
                        {item.shippedQuantity && (
                          <div className="text-center">
                            <p className="text-xs font-black text-content-muted uppercase tracking-widest mb-1">{t('inventory.shipped')}</p>
                            <p className="font-black text-content">{item.shippedQuantity}</p>
                          </div>
                        )}
                        {item.receivedQuantity && (
                          <div className="text-center">
                            <p className="text-xs font-black text-success uppercase tracking-widest mb-1">{t('inventory.received')}</p>
                            <p className="font-black text-success">{item.receivedQuantity}</p>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {transfer.status === 'in_transit' && (
            <div className="space-y-4">
              <div className="p-6 bg-warning/10 rounded-3xl border border-warning/20 flex items-start gap-4">
                <AlertTriangle className="text-warning shrink-0" size={24} />
                <div>
                  <p className="text-sm font-black text-warning uppercase tracking-widest">{t('inventory.reconciliation_notice')}</p>
                  <p className="text-xs font-bold text-warning/80 mt-1 leading-relaxed">
                    {t('inventory.reconciliation_desc')}
                  </p>
                </div>
              </div>
              
              <div className="space-y-2">
                <label className="text-xs font-black text-content-muted uppercase tracking-widest">{t('inventory.receiving_notes_optional')}</label>
                <textarea
                  value={remarks}
                  onChange={(e) => setRemarks(e.target.value)}
                  placeholder={t('inventory.receiving_notes_placeholder')}
                  className="w-full p-4 bg-surface-muted border border-border rounded-2xl focus:ring-2 focus:ring-brand focus:border-brand text-sm font-medium resize-none h-24"
                />
              </div>
            </div>
          )}
          
          {transfer.remarks && transfer.status !== 'in_transit' && (
            <div className="space-y-2">
              <h3 className="text-xs font-black text-content-muted uppercase tracking-widest">{t('inventory.receiving_notes')}</h3>
              <div className="p-4 bg-surface-muted rounded-2xl border border-border">
                <p className="text-sm font-medium text-content">{transfer.remarks}</p>
              </div>
            </div>
          )}
        </div>

        {transfer.status === 'in_transit' && (
          <div className="p-8 bg-surface-muted border-t border-border">
            <button 
              onClick={() => onReceive(transfer, receivedQuantities, remarks)}
              className="w-full bg-success text-white py-4 rounded-2xl font-black text-lg shadow-xl shadow-success/10 hover:bg-success/90 transition-all flex items-center justify-center gap-3"
            >
              <CheckCircle2 size={24} />
              {t('inventory.confirm_reconciliation')}
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
};

export default StockTransferWorkflow;
