import React, { useState, useEffect } from 'react';
import { 
  Scale, 
  ArrowRightLeft, 
  Settings, 
  FileText, 
  CheckCircle2, 
  AlertTriangle, 
  Search, 
  Layers, 
  Package, 
  TrendingUp, 
  Lock, 
  ShieldCheck, 
  Loader2,
  Undo2,
  RefreshCw
} from 'lucide-react';
import { supabase } from '../../lib/supabase/client';
import { useTranslation } from 'react-i18next';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../../lib/utils';
import { useStaff } from '../../contexts/StaffContext';
import { 
  DEFAULT_FABRIC_UNITS, 
  safeRound, 
  convertToBaseUnit, 
  convertFromBaseUnit, 
  formatSmartStockDisplay,
  getUnitLabel 
} from '../../utils/fabricUomConverter';
import { localeOf } from '../../lib/direction';
import i18n from '../../i18n/config';

interface FabricUomConversionProps {
  tenantId: string;
}

interface FabricItem {
  id: string;
  name: string;
  sku: string;
  unit: string;      // Purchase/Large unit, e.g. "roll", "bolt", "yard"
  baseUnit: string;  // Base unit, e.g. "meter", "piece"
  conversionRate: number;
  category: string;
  minThreshold: number;
}

interface BranchInventory {
  id: string;
  branchId: string;
  itemId: string;
  quantity: number;
}

interface Branch {
  id: string;
  name: string;
}

interface ConversionLog {
  id: string;
  created_at: string;
  staff_name: string;
  from_unit: string;
  to_unit: string;
  converted_qty: number;
  resulting_qty: number;
  conversion_rate: number;
  notes: string;
  itemName: string;
}

const FabricUomConversion: React.FC<FabricUomConversionProps> = ({ tenantId }) => {
  const { t } = useTranslation();
  const { currentStaff } = useStaff();

  // Role Checks
  const canEditConversion = currentStaff && [
    'owner', 
    'admin', 
    'manager', 
    'branch_manager', 
    'warehouse_manager',
    'super_admin'
  ].includes(currentStaff.role);

  // States
  const [activeSubTab, setActiveSubTab] = useState<'display' | 'convert' | 'settings' | 'logs'>('display');
  const [items, setItems] = useState<FabricItem[]>([]);
  const [branchStocks, setBranchStocks] = useState<BranchInventory[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [conversionLogs, setConversionLogs] = useState<ConversionLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [refreshCounter, setRefreshCounter] = useState(0);

  // Form states for conversion
  const [selectedItemId, setSelectedItemId] = useState('');
  const [selectedBranchId, setSelectedBranchId] = useState('');
  const [conversionAction, setConversionAction] = useState<'unroll' | 'bundle'>('unroll'); // unroll = large to base, bundle = base to large
  const [inputQty, setInputQty] = useState<number | ''>('');
  const [conversionNotes, setConversionNotes] = useState('');
  const [processing, setProcessing] = useState(false);
  const [successMessage, setSuccessMessage] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  // Form states for settings
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [settingLargeUnit, setSettingLargeUnit] = useState('roll');
  const [settingBaseUnit, setSettingBaseUnit] = useState('meter');
  const [settingRate, setSettingRate] = useState<number>(25);

  // Load Fabrics and Branches
  useEffect(() => {
    if (!tenantId) return;

    const loadData = async () => {
      setLoading(true);
      try {
        // Fetch Fabrics only (category = 'fabric')
        const { data: rawItems, error: itemsError } = await supabase
          .from('inventory_items')
          .select('id, name, sku, unit, conversion_rate, category, min_threshold')
          .eq('tenant_id', tenantId)
          .eq('category', 'fabric');

        if (itemsError) throw itemsError;

        const mappedItems: FabricItem[] = (rawItems || []).map((item: any) => ({
          id: item.id,
          name: item.name,
          sku: item.sku || '',
          unit: item.unit || 'roll',
          baseUnit: item.unit || 'meter',
          conversionRate: Number(item.conversion_rate) || 1,
          category: item.category,
          minThreshold: Number(item.min_threshold) || 0,
        }));

        setItems(mappedItems);

        // Fetch Branch Stock
        const { data: rawStock, error: stockError } = await supabase
          .from('branch_inventory')
          .select('id, branch_id, item_id, quantity')
          .eq('tenant_id', tenantId);

        if (stockError) throw stockError;

        setBranchStocks((rawStock || []).map((s: any) => ({
          id: s.id,
          branchId: s.branch_id,
          itemId: s.item_id,
          quantity: Number(s.quantity) || 0,
        })));

        // Fetch Branches
        const { data: rawBranches, error: branchesError } = await supabase
          .from('branches')
          .select('id, name')
          .eq('tenant_id', tenantId);

        if (branchesError) throw branchesError;

        setBranches(rawBranches || []);

        // Load manual conversion logs
        const { data: rawLogs, error: logsError } = await supabase
          .from('uom_conversion_logs')
          .select('*')
          .eq('tenant_id', tenantId)
          .order('created_at', { ascending: false })
          .limit(50);

        if (!logsError && rawLogs) {
          const logsWithItemNames = rawLogs.map((log: any) => {
            const item = mappedItems.find(i => i.id === log.item_id);
            return {
              id: log.id,
              created_at: log.created_at,
              staff_name: log.staff_name,
              from_unit: log.from_unit,
              to_unit: log.to_unit,
              converted_qty: Number(log.converted_qty),
              resulting_qty: Number(log.resulting_qty),
              conversion_rate: Number(log.conversion_rate),
              notes: log.notes || '',
              itemName: item ? item.name : t('inventory.unknown_item'),
            };
          });
          setConversionLogs(logsWithItemNames);
        }

      } catch (err: any) {
        console.error('Error loading fabric UOM conversion data:', err);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [tenantId, refreshCounter]);

  // Helper: Get Branch Stock for an item
  const getItemStockForBranch = (itemId: string, branchId: string): number => {
    const found = branchStocks.find(s => s.itemId === itemId && s.branchId === branchId);
    return found ? found.quantity : 0;
  };

  // Helper: Get Total Stock for an item
  const getItemTotalStock = (itemId: string): number => {
    return branchStocks
      .filter(s => s.itemId === itemId)
      .reduce((sum, s) => sum + s.quantity, 0);
  };

  // Filtered Items for Search
  const filteredItems = items.filter(item => 
    item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    item.sku.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Manual Conversion Submit Handler (فك أو لف القماش يدوياً)
  const handleManualConversion = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage('');
    setSuccessMessage('');
    if (processing) return;                   // double-click guard

    if (!selectedItemId || !selectedBranchId || !inputQty || Number(inputQty) <= 0) {
      setErrorMessage(t('errors.all_fields_required'));
      return;
    }

    if (!canEditConversion) {
      // The permission was only checked when saving *settings*; the conversion itself
      // was open to anyone who could open this tab.
      setErrorMessage(t('errors.unauthorized_action'));
      return;
    }

    setProcessing(true);

    try {
      /* ------------------------------------------------------------------
         This screen used to write only log rows: it read the branch balance
         into `currentBaseQty`, then never used it for anything but the
         ledger's `previous_quantity`. There was no stock check at all, so a
         branch holding 60 m could log "unrolled 1000 rolls" (25,000 m) and
         show a success message.

         Both entry points now call the same server-side function, which
         validates the rate and the available stock, writes the conversion log
         and a net-zero ledger entry in one transaction, and is idempotent.
         ------------------------------------------------------------------ */
      const operationId =
        (globalThis.crypto?.randomUUID?.() as string | undefined) ??
        `${Date.now()}-${Math.random().toString(36).slice(2)}`;

      const { error: rpcError } = await supabase.rpc('record_uom_conversion', {
        p_operation_id: operationId,
        p_branch_id: selectedBranchId,
        p_item_id: selectedItemId,
        p_direction: conversionAction,
        p_qty: Number(inputQty),
        p_notes: conversionNotes || null,
      });

      if (rpcError) throw rpcError;

      setSuccessMessage(t('inventory.conversion_success'));
      setInputQty('');
      setConversionNotes('');
      setRefreshCounter(prev => prev + 1);
    } catch (err: any) {
      console.error('Error performing conversion:', err);
      setErrorMessage(err.message || t('errors.system_error'));
    } finally {
      setProcessing(false);
    }
  };

  const handleUpdateSettings = async (itemId: string) => {
    if (!canEditConversion) {
      setErrorMessage(t('errors.unauthorized_action', 'عذراً، ليس لديك الصلاحية لتحديث معامل التحويل.'));
      return;
    }

    try {
      setProcessing(true);
      
      // Update item in database
      const { error: itemError } = await supabase
        .from('inventory_items')
        .update({
          unit: settingLargeUnit,
          conversion_rate: settingRate,
          updated_at: new Date().toISOString()
        })
        .eq('id', itemId);

      if (itemError) throw itemError;

      // Upsert in the item_uom_conversions table
      const { error: convError } = await supabase
        .from('item_uom_conversions')
        .upsert({
          tenant_id: tenantId,
          item_id: itemId,
          from_unit: settingLargeUnit,
          to_unit: settingBaseUnit,
          conversion_rate: settingRate,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'tenant_id,item_id,from_unit,to_unit'
        });

      if (convError) {
        console.warn('Conversions table upsert warning:', convError);
      }

      setSuccessMessage(t('inventory.settings_saved', 'تم حفظ إعدادات الوحدة ومعامل التحويل الجديد بنجاح.'));
      setEditingItemId(null);
      setRefreshCounter(prev => prev + 1);
    } catch (err: any) {
      console.error('Error updating UOM settings:', err);
      setErrorMessage(err.message || t('errors.system_error'));
    } finally {
      setProcessing(false);
    }
  };

  // Start editing a fabric item's settings
  const startEditing = (item: FabricItem) => {
    setEditingItemId(item.id);
    setSettingLargeUnit(item.unit);
    setSettingBaseUnit(item.baseUnit);
    setSettingRate(item.conversionRate);
    setSuccessMessage('');
    setErrorMessage('');
  };

  return (
    <div className="space-y-6">
      {/* Upper Navigation & Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border pb-4">
        <div>
          <h2 className="text-xl font-black text-content flex items-center gap-2">
            <Scale className="text-brand" size={24} />
            <span>{t('inventory.uom_conversion_title', 'إدارة وتحويل وحدات قياس الأقمشة')}</span>
          </h2>
          <p className="text-xs font-bold text-content-muted mt-1">
            {t('inventory.uom_conversion_desc', 'إدارة مخزون الأقمشة بالوحدات الكبرى والأساسية (طاقة، متر، ياردة) بدقة متناهية.')}
          </p>
        </div>

        {/* Sub tabs */}
        <div className="flex items-center gap-1.5 bg-surface-muted p-1 rounded-2xl w-fit self-end sm:self-auto">
          <button
            onClick={() => setActiveSubTab('display')}
            className={cn(
              "px-4 py-2 rounded-xl text-xs font-black transition-all",
              activeSubTab === 'display' ? "bg-surface shadow-sm text-brand" : "text-content-muted hover:text-content"
            )}
          >
            {t('inventory.tab_stock_view', 'عرض المخزون الذكي')}
          </button>
          <button
            onClick={() => setActiveSubTab('convert')}
            className={cn(
              "px-4 py-2 rounded-xl text-xs font-black transition-all",
              activeSubTab === 'convert' ? "bg-surface shadow-sm text-brand" : "text-content-muted hover:text-content"
            )}
          >
            {t('inventory.tab_manual_convert', 'فك/تحويل يدوي')}
          </button>
          <button
            onClick={() => setActiveSubTab('settings')}
            className={cn(
              "px-4 py-2 rounded-xl text-xs font-black transition-all",
              activeSubTab === 'settings' ? "bg-surface shadow-sm text-brand" : "text-content-muted hover:text-content"
            )}
          >
            {t('inventory.tab_uom_settings', 'إعدادات الوحدات')}
          </button>
          <button
            onClick={() => setActiveSubTab('logs')}
            className={cn(
              "px-4 py-2 rounded-xl text-xs font-black transition-all",
              activeSubTab === 'logs' ? "bg-surface shadow-sm text-brand" : "text-content-muted hover:text-content"
            )}
          >
            {t('inventory.tab_conversion_history', 'سجل العمليات')}
          </button>
        </div>
      </div>

      {/* Alerts */}
      <AnimatePresence mode="wait">
        {successMessage && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-4 bg-success/10 text-success rounded-2xl border border-success/20 flex items-center gap-2 text-sm font-bold"
          >
            <CheckCircle2 size={18} />
            <span>{successMessage}</span>
          </motion.div>
        )}
        {errorMessage && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="p-4 bg-danger/10 text-danger rounded-2xl border border-danger/20 flex items-center gap-2 text-sm font-bold"
          >
            <AlertTriangle size={18} />
            <span>{errorMessage}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Loading state */}
      {loading ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="animate-spin text-brand" size={32} />
          <p className="text-sm font-bold text-content-muted">{t('common.loading', 'جاري التحميل...')}</p>
        </div>
      ) : (
        <div className="space-y-6">
          
          {/* TAB 1: Smart Stock Display */}
          {activeSubTab === 'display' && (
            <div className="space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="flex-1 max-w-md flex items-center overflow-hidden border border-border rounded-2xl bg-surface transition-all focus-within:ring-2 focus-within:border-brand shadow-xs">
                  <div className="flex items-center justify-center px-4 py-3 border-e border-border bg-surface/50 text-content-muted shrink-0">
                    <Search size={18} />
                  </div>
                  <input
                    type="text"
                    placeholder={t('inventory.search_fabrics_placeholder', 'البحث في أقمشة المخزن بالاسم أو الـ SKU...')}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full px-4 py-2.5 bg-transparent font-bold text-sm text-right outline-none border-none focus:ring-0 focus:outline-none"
                  />
                </div>
                <button 
                  onClick={() => setRefreshCounter(prev => prev + 1)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-surface border border-border rounded-xl text-xs font-bold text-content hover:bg-surface-muted/50 self-end md:self-auto"
                >
                  <RefreshCw size={14} />
                  <span>{t('common.refresh', 'تحديث')}</span>
                </button>
              </div>

              {/* Grid of smart cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredItems.map(item => {
                  const totalInBase = getItemTotalStock(item.id);
                  const isLow = totalInBase <= item.minThreshold;
                  const displayStr = formatSmartStockDisplay(
                    totalInBase, 
                    item.unit, 
                    item.baseUnit, 
                    item.conversionRate);

                  return (
                    <motion.div
                      key={item.id}
                      layout
                      className="bg-surface border border-border rounded-3xl p-5 hover:shadow-md transition-all flex flex-col justify-between"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="space-y-1">
                            <h3 className="font-black text-content text-lg leading-tight">{item.name}</h3>
                            <span className="text-[10px] font-bold text-content-muted uppercase tracking-wider block">
                              SKU: {item.sku || 'N/A'}
                            </span>
                          </div>
                          <span className={cn(
                            "px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider",
                            isLow ? "bg-danger/10 text-danger" : "bg-success/10 text-success"
                          )}>
                            {isLow ? t('inventory.stock_low', 'منخفض') : t('inventory.stock_good', 'متوفر')}
                          </span>
                        </div>

                        {/* Conversions details */}
                        <div className="bg-surface-muted/50 p-3 rounded-2xl space-y-2 mb-4 text-right">
                          <div className="flex justify-between items-center text-xs">
                            <span className="font-bold text-content-muted">{t('inventory.conversion_rate', 'معامل التحويل')}:</span>
                            <span className="font-black text-brand">
                              1 {getUnitLabel(item.unit)} = {item.conversionRate} {getUnitLabel(item.baseUnit)}
                            </span>
                          </div>
                          <div className="flex justify-between items-center text-xs border-t border-border/40 pt-2">
                            <span className="font-bold text-content-muted">{t('inventory.total_base_qty', 'الكمية الإجمالية مفردة')}:</span>
                            <span className="font-black text-content">
                              {totalInBase} {getUnitLabel(item.baseUnit)}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Smart Large Display Box */}
                      <div className="bg-gradient-to-br from-brand/5 to-brand/10 border border-brand/10 p-4 rounded-2xl text-center">
                        <span className="text-[10px] font-black text-brand uppercase tracking-widest block mb-1">
                          {t('inventory.smart_stock_display', 'الرصيد الذكي والمجزأ')}
                        </span>
                        <p className="text-base font-black text-content leading-tight">
                          {displayStr}
                        </p>
                      </div>
                    </motion.div>
                  );
                })}

                {filteredItems.length === 0 && (
                  <div className="col-span-full py-16 text-center text-content-muted font-bold space-y-2">
                    <Package className="mx-auto text-content-muted opacity-40" size={48} />
                    <p className="text-sm">{t('inventory.no_fabrics_found', 'لم يتم العثور على أقمشة مطابقة لبحثك.')}</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: Manual Conversion & Unrolling */}
          {activeSubTab === 'convert' && (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
              {/* Manual conversion form */}
              <div className="lg:col-span-7 bg-surface border border-border rounded-3xl p-6">
                <div className="border-b border-border pb-4 mb-6">
                  <h3 className="text-base font-black text-content flex items-center gap-2">
                    <ArrowRightLeft className="text-brand" size={18} />
                    <span>{t('inventory.manual_split_unroll', 'فك وتحويل الأقمشة يدوياً')}</span>
                  </h3>
                  <p className="text-xs font-medium text-content-muted mt-1">
                    {t('inventory.manual_split_desc', 'قم بفك الطاقة أو اللفة لتحويلها إلى أمتار في فروع المعمل أو المحل.')}
                  </p>
                </div>

                <form onSubmit={handleManualConversion} className="space-y-5 text-right">
                  {/* Select Fabric */}
                  <div className="space-y-2">
                    <label className="text-xs font-black text-content-muted uppercase tracking-wider block mx-1">
                      {t('inventory.select_fabric_item', 'اختر قماشاً')}
                    </label>
                    <select
                      value={selectedItemId}
                      onChange={(e) => setSelectedItemId(e.target.value)}
                      required
                      className="w-full px-4 py-3 bg-surface-muted rounded-2xl border-none focus:ring-2 focus:ring-brand font-bold text-sm text-right"
                    >
                      <option value="">{t('inventory.select_fabric_placeholder', 'اختر قماشاً...')}</option>
                      {items.map(item => (
                        <option key={item.id} value={item.id}>
                          {item.name} (1 {getUnitLabel(item.unit)} = {item.conversionRate} متر)
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Select Branch */}
                  <div className="space-y-2">
                    <label className="text-xs font-black text-content-muted uppercase tracking-wider block mx-1">
                      {t('inventory.select_branch', 'الفرع / المخزن المستهدف')}
                    </label>
                    <select
                      value={selectedBranchId}
                      onChange={(e) => setSelectedBranchId(e.target.value)}
                      required
                      className="w-full px-4 py-3 bg-surface-muted rounded-2xl border-none focus:ring-2 focus:ring-brand font-bold text-sm text-right"
                    >
                      <option value="">{t('inventory.select_branch_placeholder', 'اختر الفرع للعملية...')}</option>
                      {branches.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  </div>

                  {/* Action Mode */}
                  <div className="space-y-2">
                    <label className="text-xs font-black text-content-muted uppercase tracking-wider block mx-1">
                      {t('inventory.conversion_direction', 'اتجاه ونوع العملية')}
                    </label>
                    <div className="grid grid-cols-2 gap-3">
                      <button
                        type="button"
                        onClick={() => setConversionAction('unroll')}
                        className={cn(
                          "py-3 rounded-2xl border font-bold text-xs transition-all text-center",
                          conversionAction === 'unroll' 
                            ? "bg-brand/10 border-brand text-brand" 
                            : "bg-surface border-border text-content-muted hover:bg-surface-muted/50"
                        )}
                      >
                        {t('inventory.action_unroll_fabric', 'فك طاقة (طاقة ➜ أمتار)')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setConversionAction('bundle')}
                        className={cn(
                          "py-3 rounded-2xl border font-bold text-xs transition-all text-center",
                          conversionAction === 'bundle' 
                            ? "bg-brand/10 border-brand text-brand" 
                            : "bg-surface border-border text-content-muted hover:bg-surface-muted/50"
                        )}
                      >
                        {t('inventory.action_bundle_fabric', 'لف وتعبئة أمتار (أمتار ➜ طاقة)')}
                      </button>
                    </div>
                  </div>

                  {/* Quantity and Real-time Calculations */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-black text-content-muted uppercase tracking-wider block mx-1">
                        {t('inventory.input_qty', 'الكمية المراد فكها/تحويلها')}
                      </label>
                      <input
                        type="number"
                        step="0.01"
                        required
                        value={inputQty}
                        onChange={(e) => setInputQty(e.target.value === '' ? '' : Number(e.target.value))}
                        className="w-full px-4 py-3 bg-surface-muted rounded-2xl border-none focus:ring-2 focus:ring-brand font-bold text-sm text-right"
                        placeholder="0.00"
                      />
                    </div>

                    {/* Calculated Output Preview */}
                    <div className="space-y-2">
                      <label className="text-xs font-black text-content-muted uppercase tracking-wider block mx-1">
                        {t('inventory.resulting_output', 'الناتج الفعلي بعد التحويل')}
                      </label>
                      <div className="w-full px-4 py-3.5 bg-surface-muted/50 rounded-2xl border border-border/60 font-black text-sm text-right text-brand flex items-center justify-between">
                        <span>
                          {selectedItemId && inputQty !== '' ? (
                            (() => {
                              const item = items.find(i => i.id === selectedItemId);
                              if (!item) return '0';
                              const res = conversionAction === 'unroll'
                                ? convertToBaseUnit(Number(inputQty), item.conversionRate)
                                : convertFromBaseUnit(Number(inputQty), item.conversionRate);
                              return `${res} ${getUnitLabel(conversionAction === 'unroll' ? item.baseUnit : item.unit)}`;
                            })()
                          ) : '0'}
                        </span>
                        <span className="text-[10px] font-bold text-content-muted">
                          {t('inventory.live_calculation', 'حساب تلقائي دقيق')}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Notes */}
                  <div className="space-y-2">
                    <label className="text-xs font-black text-content-muted uppercase tracking-wider block mx-1">
                      {t('common.notes', 'ملاحظات العملية')}
                    </label>
                    <textarea
                      rows={2}
                      value={conversionNotes}
                      onChange={(e) => setConversionNotes(e.target.value)}
                      placeholder={t('inventory.conversion_notes_placeholder', 'اكتب سبباً أو تفاصيل إضافية... (مثال: جرد سنوي، فرز مخزني)')}
                      className="w-full px-4 py-3 bg-surface-muted rounded-2xl border-none focus:ring-2 focus:ring-brand font-medium text-xs text-right"
                    />
                  </div>

                  {/* Submit Button */}
                  <button
                    type="submit"
                    disabled={processing || !selectedItemId || !selectedBranchId || inputQty === ''}
                    className="w-full py-3.5 bg-brand text-white rounded-2xl font-black text-sm shadow-md hover:bg-brand-hover disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {processing ? (
                      <Loader2 className="animate-spin" size={18} />
                    ) : (
                      <ArrowRightLeft size={18} />
                    )}
                    <span>{t('inventory.confirm_conversion', 'اعتماد عملية التحويل والفك')}</span>
                  </button>
                </form>
              </div>

              {/* Sidebar Guide */}
              <div className="lg:col-span-5 space-y-4">
                <div className="bg-surface border border-border rounded-3xl p-5 space-y-4 text-right">
                  <h4 className="font-black text-content text-sm border-b border-border pb-2">
                    {t('inventory.uom_guide_title', 'ملاحظات المعايرة والجرد')}
                  </h4>
                  <ul className="space-y-3 text-xs text-content-muted leading-relaxed">
                    <li className="flex items-start gap-2">
                      <span className="h-1.5 w-1.5 bg-brand rounded-full mt-1.5 shrink-0" />
                      <span>{t('inventory.uom_guide_1', 'يتم دمج مخزون القماش الأساسي ليكون بالوحدة الصغرى (المتر أو الياردة) دائماً في الخلفية لضمان تماسك البيانات الحسابية.')}</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="h-1.5 w-1.5 bg-brand rounded-full mt-1.5 shrink-0" />
                      <span>{t('inventory.uom_guide_2', 'عند تفعيل خيار فك طاقة، يسجل النظام التفكيك والكسور بدقة، ويسهل جرد الأمتار على الكاشير بدون فقدان الرؤية.')}</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <span className="h-1.5 w-1.5 bg-brand rounded-full mt-1.5 shrink-0" />
                      <span>{t('inventory.uom_guide_3', 'تخضع معاملات التحويل لقانون الجرد Perpetuality، ويتم ترحيل جميع عمليات الفك والتفكيك مباشرة إلى سجل التدقيق المالي.')}</span>
                    </li>
                  </ul>
                </div>

                {/* Selected fabric metrics */}
                {selectedItemId && selectedBranchId && (
                  <div className="bg-brand/5 border border-brand/10 rounded-3xl p-5 text-right space-y-3">
                    <h4 className="font-black text-brand text-sm">
                      {t('inventory.current_branch_stock_title', 'موقف المخزون في الفرع المختار')}
                    </h4>
                    {(() => {
                      const item = items.find(i => i.id === selectedItemId);
                      if (!item) return null;
                      const qty = getItemStockForBranch(item.id, selectedBranchId);
                      const display = formatSmartStockDisplay(qty, item.unit, item.baseUnit, item.conversionRate);
                      return (
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs">
                            <span className="text-content-muted">{t('inventory.total_in_meters', 'الرصيد الفعلي بالأمتار')}:</span>
                            <span className="font-black text-content">{qty} متر</span>
                          </div>
                          <div className="flex justify-between text-xs border-t border-brand/10 pt-2">
                            <span className="text-content-muted">{t('inventory.fractional_display', 'عرض مجزأ')}:</span>
                            <span className="font-black text-brand">{display}</span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 3: UOM Settings & Product Conversion Config */}
          {activeSubTab === 'settings' && (
            <div className="bg-surface border border-border rounded-3xl overflow-hidden">
              <div className="p-6 border-b border-border bg-surface-muted/30 flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <h3 className="text-base font-black text-content flex items-center gap-2">
                    <Settings className="text-brand" size={18} />
                    <span>{t('inventory.uom_conversions_config', 'ضبط الوحدات ومعاملات التحويل')}</span>
                  </h3>
                  <p className="text-xs font-medium text-content-muted mt-1">
                    {t('inventory.uom_conversions_desc', 'قم بتعديل قيم ونسب التحويل لكل قماش على حدة. معامل التحويل يحدد كم متر في الطاقة الواحدة.')}
                  </p>
                </div>

                {/* Role Status badge */}
                <div className="flex items-center gap-1.5 self-start md:self-auto">
                  {canEditConversion ? (
                    <span className="flex items-center gap-1 px-3 py-1 bg-success/10 text-success border border-success/20 rounded-full text-[10px] font-black">
                      <ShieldCheck size={12} />
                      <span>{t('permissions.full_edit_access', 'صلاحية تعديل كاملة')}</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 px-3 py-1 bg-amber-500/10 text-amber-600 border border-amber-500/20 rounded-full text-[10px] font-black">
                      <Lock size={12} />
                      <span>{t('permissions.readonly_access', 'عرض فقط')}</span>
                    </span>
                  )}
                </div>
              </div>

              {/* Settings Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-right border-collapse">
                  <thead>
                    <tr className="bg-surface-muted/50 border-b border-border">
                      <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">{t('inventory.item_name', 'اسم القماش')}</th>
                      <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">{t('inventory.base_unit', 'الوحدة الأساسية (الصغرى)')}</th>
                      <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">{t('inventory.large_unit', 'الوحدة الكبرى')}</th>
                      <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">{t('inventory.conversion_rate_title', 'معامل التحويل (كمية الأساسية لكل كبرى)')}</th>
                      <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest text-center">{t('common.actions', 'العمليات')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {items.map(item => {
                      const isEditing = editingItemId === item.id;

                      return (
                        <tr key={item.id} className="hover:bg-surface-muted/20 transition-colors">
                          <td className="px-6 py-4">
                            <p className="font-bold text-content text-sm">{item.name}</p>
                            <span className="text-[10px] text-content-muted">SKU: {item.sku || 'N/A'}</span>
                          </td>
                          <td className="px-6 py-4">
                            {isEditing ? (
                              <select
                                value={settingBaseUnit}
                                onChange={(e) => setSettingBaseUnit(e.target.value)}
                                className="px-2 py-1.5 bg-surface border border-border rounded-xl font-bold text-xs text-right"
                              >
                                {DEFAULT_FABRIC_UNITS.filter(u => u.isBase).map(u => (
                                  <option key={u.id} value={u.id}>{u.name}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="px-2.5 py-1 bg-surface-muted text-content-muted rounded-full text-xs font-bold">
                                {getUnitLabel(item.baseUnit)}
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            {isEditing ? (
                              <select
                                value={settingLargeUnit}
                                onChange={(e) => setSettingLargeUnit(e.target.value)}
                                className="px-2 py-1.5 bg-surface border border-border rounded-xl font-bold text-xs text-right"
                              >
                                {DEFAULT_FABRIC_UNITS.filter(u => !u.isBase).map(u => (
                                  <option key={u.id} value={u.id}>{u.name}</option>
                                ))}
                              </select>
                            ) : (
                              <span className="px-2.5 py-1 bg-surface-muted text-content-muted rounded-full text-xs font-bold">
                                {getUnitLabel(item.unit)}
                              </span>
                            )}
                          </td>
                          <td className="px-6 py-4">
                            {isEditing ? (
                              <div className="flex items-center gap-2">
                                <span className="text-xs text-content-muted">1 {getUnitLabel(settingLargeUnit)} =</span>
                                <input
                                  type="number"
                                  step="0.01"
                                  value={settingRate}
                                  onChange={(e) => setSettingRate(Number(e.target.value))}
                                  className="w-20 px-2 py-1 bg-surface border border-border rounded-lg text-xs font-bold text-center"
                                />
                                <span className="text-xs text-content-muted">{getUnitLabel(settingBaseUnit)}</span>
                              </div>
                            ) : (
                              <p className="font-bold text-sm text-content">
                                1 {getUnitLabel(item.unit)} = {item.conversionRate} {getUnitLabel(item.baseUnit)}
                              </p>
                            )}
                          </td>
                          <td className="px-6 py-4 text-center">
                            {isEditing ? (
                              <div className="flex items-center justify-center gap-2">
                                <button
                                  onClick={() => handleUpdateSettings(item.id)}
                                  className="px-3 py-1.5 bg-brand text-white rounded-lg text-xs font-black shadow hover:bg-brand-hover"
                                >
                                  {t('common.save', 'حفظ')}
                                </button>
                                <button
                                  onClick={() => setEditingItemId(null)}
                                  className="px-3 py-1.5 bg-surface border border-border rounded-lg text-xs font-bold text-content hover:bg-surface-muted"
                                >
                                  {t('common.cancel', 'إلغاء')}
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => startEditing(item)}
                                disabled={!canEditConversion}
                                className={cn(
                                  "px-4 py-1.5 rounded-xl text-xs font-bold transition-all border",
                                  canEditConversion 
                                    ? "bg-surface hover:bg-brand/5 border-border hover:border-brand/40 text-brand" 
                                    : "bg-surface-muted/50 border-border text-content-muted cursor-not-allowed"
                                )}
                              >
                                {t('common.edit', 'تعديل')}
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* TAB 4: Logs */}
          {activeSubTab === 'logs' && (
            <div className="bg-surface border border-border rounded-3xl overflow-hidden">
              <div className="p-6 border-b border-border bg-surface-muted/30">
                <h3 className="text-base font-black text-content flex items-center gap-2">
                  <FileText className="text-brand" size={18} />
                  <span>{t('inventory.conversion_logs_title', 'سجل فك وتحويل وحدات الأقمشة')}</span>
                </h3>
                <p className="text-xs font-medium text-content-muted mt-1">
                  {t('inventory.conversion_logs_desc', 'جميع عمليات التفكيك والتعبئة اليدوية للمطابقة والرقابة الدورية للمخزون.')}
                </p>
              </div>

              {/* Logs Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-right border-collapse">
                  <thead>
                    <tr className="bg-surface-muted/50 border-b border-border">
                      <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">{t('common.date', 'التاريخ والوقت')}</th>
                      <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">{t('inventory.item_name', 'الصنف')}</th>
                      <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">{t('inventory.process_type', 'نوع العملية')}</th>
                      <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">{t('inventory.converted_amounts', 'الكمية المحولة')}</th>
                      <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">{t('inventory.by_staff', 'بواسطة الموظف')}</th>
                      <th className="px-6 py-4 text-xs font-black text-content-muted uppercase tracking-widest">{t('common.notes', 'ملاحظات')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {conversionLogs.map(log => {
                      const isUnrolled = log.to_unit.toLowerCase() === 'meter' || log.to_unit.toLowerCase() === 'yard';

                      return (
                        <tr key={log.id} className="hover:bg-surface-muted/20 transition-colors">
                          <td className="px-6 py-4 text-xs font-bold text-content-muted">
                            {new Date(log.created_at).toLocaleString(localeOf(i18n.language))}
                          </td>
                          <td className="px-6 py-4 font-bold text-sm text-content">
                            {log.itemName}
                          </td>
                          <td className="px-6 py-4">
                            <span className={cn(
                              "px-2.5 py-1 rounded-full text-[10px] font-black",
                              isUnrolled ? "bg-blue-500/10 text-blue-600" : "bg-purple-500/10 text-purple-600"
                            )}>
                              {isUnrolled ? t('inventory.unrolling_tag', 'فك طاقة الأقمشة') : t('inventory.bundling_tag', 'لف وتجميع')}
                            </span>
                          </td>
                          <td className="px-6 py-4">
                            <div className="flex items-center gap-1.5 font-black text-sm text-content">
                              <span>{log.converted_qty} {getUnitLabel(log.from_unit)}</span>
                              <span className="text-content-muted">➜</span>
                              <span className="text-brand">{log.resulting_qty} {getUnitLabel(log.to_unit)}</span>
                            </div>
                          </td>
                          <td className="px-6 py-4 text-xs font-bold text-content">
                            {log.staff_name}
                          </td>
                          <td className="px-6 py-4 text-xs text-content-muted font-medium max-w-xs truncate">
                            {log.notes}
                          </td>
                        </tr>
                      );
                    })}

                    {conversionLogs.length === 0 && (
                      <tr>
                        <td colSpan={6} className="py-12 text-center text-content-muted font-bold">
                          {t('inventory.no_conversion_logs', 'لا توجد عمليات تحويل مسجلة حالياً.')}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

        </div>
      )}
    </div>
  );
};

export default FabricUomConversion;
