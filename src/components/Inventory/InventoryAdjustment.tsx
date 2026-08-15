import React, { useState, useMemo, useEffect } from "react";
import {
  Search,
  Filter,
  CheckCircle2,
  AlertTriangle,
  RotateCcw,
  ClipboardList,
  ChevronDown,
  Trash2,
  Plus,
  Minus,
  Save,
  HelpCircle,
  Shield,
  FileText,
  Database,
  Lock,
  Check,
  X,
  Clock,
  ArrowUpRight,
  ArrowDownRight,
  Eye,
  Copy,
} from "lucide-react";
import { supabase } from "../../lib/supabase/client";
import { useTranslation } from "react-i18next";
import { useDirection } from "../../lib/direction";
import { useStaff } from "../../contexts/StaffContext";
import { useToast } from "../../contexts/ToastContext";
import { cn } from "../../lib/utils";
import { Branch, InventoryItem, BranchInventory, UserRole } from "../../types";
import { motion, AnimatePresence } from "motion/react";

// Dynamic types representing the database schemas for proper TypeScript validation
export interface InventoryAdjustmentHeader {
  id: string;
  tenant_id: string;
  branch_id: string;
  reference_number: string;
  status: "Draft" | "Approved" | "Cancelled";
  adjustment_type: "Physical Count" | "Damage" | "Loss" | "Internal Use";
  created_by: string;
  created_by_name: string;
  approved_by?: string;
  approved_by_name?: string;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface AdjustmentItemDetail {
  id: string;
  tenant_id: string;
  adjustment_id: string;
  product_id: string;
  product_name: string;
  system_qty: number;
  physical_qty: number;
  variance_qty: number;
  unit_cost: number;
  total_variance_cost: number;
  reason?: string;
}

interface InventoryAdjustmentProps {
  tenantId: string;
  items: InventoryItem[];
  branches: Branch[];
  branchStock: Record<string, BranchInventory[]>;
  onRefresh: () => void;
}

export const InventoryAdjustment: React.FC<InventoryAdjustmentProps> = ({
  tenantId,
  items,
  branches,
  branchStock,
  onRefresh,
}) => {
  const { t } = useTranslation();
  const { isRtl } = useDirection();
  const { currentStaff } = useStaff();
  const { error: toastError, success: toastSuccess, handleError } = useToast();

  // Active sub-section within the reconciliation module
  const [activeSubTab, setActiveSubTab] = useState<"new_adjustment" | "adjustment_history">("new_adjustment");

  // State for active reconciliation session
  const [selectedBranchId, setSelectedBranchId] = useState<string>("");
  const [adjustmentType, setAdjustmentType] = useState<"Physical Count" | "Damage" | "Loss" | "Internal Use">("Physical Count");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  
  // Custom states for draft entries
  const [actualCounts, setActualCounts] = useState<Record<string, number>>({});
  const [unitCosts, setUnitCosts] = useState<Record<string, number>>({});
  const [itemReasons, setItemReasons] = useState<Record<string, string>>({});
  const [touchedItems, setTouchedItems] = useState<Record<string, boolean>>({});
  
  const [globalNotes, setGlobalNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [isApprovedState, setIsApprovedState] = useState<boolean>(true); // Toggle Draft vs Direct Approval
  const [isSchemaMissing, setIsSchemaMissing] = useState<boolean>(false);

  // Historical state
  const [history, setHistory] = useState<any[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<any | null>(null);
  const [historyItemDetails, setHistoryItemDetails] = useState<any[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);

  // Generate unique Reference Number for the reconciliation operation
  const computedReferenceNumber = useMemo(() => {
    const timestamp = Date.now().toString().slice(-6);
    const random = Math.floor(1000 + Math.random() * 9000);
    const prefix = "ADJ";
    return `${prefix}-${timestamp}-${random}`;
  }, [selectedBranchId, touchedItems]);

  // Schema liveness check for inventory_adjustments table
  useEffect(() => {
    if (!tenantId) return;
    const checkTableSchema = async () => {
      const { error } = await supabase
        .from("inventory_adjustments")
        .select("id")
        .limit(1);
      
      if (error && (
        error.message?.includes("public.inventory_adjustments") || 
        error.message?.includes("relation \"inventory_adjustments\" does not exist") || 
        error.code === "PGRST116" || 
        error.code === "42P01"
      )) {
        setIsSchemaMissing(true);
      } else {
        setIsSchemaMissing(false);
      }
    };
    checkTableSchema();
  }, [tenantId]);

  // Check RBAC Permissions
  // Admins, Owners, Tenant Admins, Managers and Warehouse Managers can Approve
  // Cashiers and Tailors can only save as Draft
  const hasApprovePermission = useMemo(() => {
    if (!currentStaff) return false;
    const adminRoles: UserRole[] = ["super_admin", "tenant_admin", "owner", "admin", "manager", "warehouse_manager"];
    return adminRoles.includes(currentStaff.role);
  }, [currentStaff]);

  // Categories list
  const categories = useMemo(() => {
    const list = new Set<string>();
    items.forEach((item) => {
      if (item.category) list.add(item.category);
    });
    return Array.from(list);
  }, [items]);

  // Reset the temporary session when changing branch
  const handleBranchChange = (branchId: string) => {
    setSelectedBranchId(branchId);
    setActualCounts({});
    setUnitCosts({});
    setItemReasons({});
    setTouchedItems({});
    setGlobalNotes("");
  };

  // Get current book stock for an item in a specific branch
  const getBookStock = (itemId: string): number => {
    if (!selectedBranchId) return 0;
    const stocks = branchStock[itemId] || [];
    const bInventory = stocks.find((bi) => bi.branchId === selectedBranchId);
    return bInventory ? bInventory.quantity : 0;
  };

  // Get default unit cost (cost price) for WAC calculations
  const getUnitCost = (item: InventoryItem): number => {
    return item.pricePerUnit || 0;
  };

  // Handles modifying physical quantity inside smart table
  const handleActualStockChange = (itemId: string, valStr: string) => {
    const val = valStr === "" ? 0 : parseFloat(valStr);
    if (isNaN(val)) return;

    setActualCounts((prev) => ({ ...prev, [itemId]: Math.max(0, val) }));
    setTouchedItems((prev) => ({ ...prev, [itemId]: true }));
  };

  // Adjust count by increments
  const handleAdjustCount = (itemId: string, increment: boolean) => {
    const currentActual = touchedItems[itemId]
      ? actualCounts[itemId] ?? 0
      : getBookStock(itemId);

    const step = 1;
    const nextVal = Math.max(0, currentActual + (increment ? step : -step));
    setActualCounts((prev) => ({ ...prev, [itemId]: nextVal }));
    setTouchedItems((prev) => ({ ...prev, [itemId]: true }));
  };

  // Modifying cost price at reconciliation
  const handleCostChange = (itemId: string, costStr: string) => {
    const cost = costStr === "" ? 0 : parseFloat(costStr);
    if (isNaN(cost)) return;

    setUnitCosts((prev) => ({ ...prev, [itemId]: Math.max(0, cost) }));
  };

  // Row specific reason change
  const handleItemReasonChange = (itemId: string, reason: string) => {
    setItemReasons((prev) => ({ ...prev, [itemId]: reason }));
  };

  // Copy book stock to actual for item
  const handleCopyBookStock = (item: InventoryItem) => {
    const book = getBookStock(item.id);
    const cost = getUnitCost(item);

    setActualCounts((prev) => ({ ...prev, [item.id]: book }));
    setUnitCosts((prev) => ({ ...prev, [item.id]: cost }));
    setTouchedItems((prev) => ({ ...prev, [item.id]: true }));
  };

  // Match all items in search view to book quantity
  const handleSetAllToBook = () => {
    const newCounts = { ...actualCounts };
    const newCosts = { ...unitCosts };
    const newTouched = { ...touchedItems };

    filteredItems.forEach((item) => {
      newCounts[item.id] = getBookStock(item.id);
      newCosts[item.id] = getUnitCost(item);
      newTouched[item.id] = true;
    });

    setActualCounts(newCounts);
    setUnitCosts(newCosts);
    setTouchedItems(newTouched);
    toastSuccess(t("inventory.all_matched_book", "تم استيراد الرصيد الدفتري لكافة المواد المعروضة في القائمة."));
  };

  // Reset current session
  const handleReset = () => {
    setActualCounts({});
    setUnitCosts({});
    setItemReasons({});
    setTouchedItems({});
    setGlobalNotes("");
    toastSuccess(t("inventory.reset_success", "تم إلغاء التعديلات بنجاح."));
  };

  // Filter items based on search and selected category
  const filteredItems = useMemo(() => {
    if (!selectedBranchId) return [];

    return items.filter((item) => {
      const matchesSearch =
        item.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item.nameEn && item.nameEn.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (item.sku && item.sku.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (item.barcode && item.barcode.includes(searchTerm));

      if (!matchesSearch) return false;

      if (selectedCategory !== "all" && item.category !== selectedCategory) {
        return false;
      }

      return true;
    });
  }, [items, selectedBranchId, searchTerm, selectedCategory]);

  // Compute stats dynamically in real-time
  const sessionStats = useMemo(() => {
    let touchedCount = 0;
    let netFinancialImpact = 0;
    let totalItemsWithDeficit = 0;
    let totalItemsWithSurplus = 0;

    Object.keys(touchedItems).forEach((itemId) => {
      if (touchedItems[itemId]) {
        touchedCount++;
        const item = items.find((i) => i.id === itemId);
        if (!item) return;

        const book = getBookStock(itemId);
        const actual = actualCounts[itemId] ?? 0;
        const diff = actual - book;
        const cost = unitCosts[itemId] ?? getUnitCost(item);
        const impact = diff * cost;

        netFinancialImpact += impact;

        if (diff < 0) {
          totalItemsWithDeficit++;
        } else if (diff > 0) {
          totalItemsWithSurplus++;
        }
      }
    });

    return {
      touchedCount,
      netFinancialImpact,
      totalItemsWithDeficit,
      totalItemsWithSurplus,
    };
  }, [touchedItems, actualCounts, unitCosts, selectedBranchId, items, branchStock]);

  // Fetch past reconciliation history
  const fetchAdjustmentHistory = async () => {
    setHistoryLoading(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("No user authorization token found");

      const response = await fetch("/api/inventory-adjustments", {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errJson = await response.json();
        if (
          errJson.error?.includes("public.inventory_adjustments") || 
          errJson.error?.includes("relation \"inventory_adjustments\" does not exist")
        ) {
          setIsSchemaMissing(true);
          setHistory([]);
          return;
        }
        throw new Error(errJson.error || "Failed to load history");
      }

      const data = await response.json();
      setHistory(data || []);
      setIsSchemaMissing(false);
    } catch (err: any) {
      console.error("Error fetching adjustment history:", err);
      if (
        err.message?.includes("public.inventory_adjustments") || 
        err.message?.includes("relation \"inventory_adjustments\" does not exist")
      ) {
        setIsSchemaMissing(true);
        setHistory([]);
      } else {
        handleError(err as any, t("inventory.fetch_history_failed", "فشل جلب سجلات الجرد والتسوية"));
      }
    } finally {
      setHistoryLoading(false);
    }
  };

  // Fetch detailed items for a historical adjustment row
  const fetchAdjustmentDetails = async (adjustment: any) => {
    setSelectedHistoryItem(adjustment);
    setDetailsLoading(true);
    setHistoryItemDetails([]);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("No user authorization token found");

      const response = await fetch(`/api/inventory-adjustments/${adjustment.id}/items`, {
        headers: {
          Authorization: `Bearer ${token}`
        }
      });

      if (!response.ok) {
        const errJson = await response.json();
        throw new Error(errJson.error || "Failed to load details");
      }

      const data = await response.json();
      setHistoryItemDetails(data || []);
    } catch (err) {
      console.error("Error fetching adjustment details:", err);
      handleError(err as any, t("inventory.fetch_details_failed", "فشل جلب تفاصيل مستند التسوية"));
    } finally {
      setDetailsLoading(false);
    }
  };

  useEffect(() => {
    if (activeSubTab === "adjustment_history" && tenantId) {
      fetchAdjustmentHistory();
    }
  }, [activeSubTab, tenantId]);

  // Execute full atomic ACID transaction (simulation / database writes)
  const handleCommitReconciliation = async () => {
    if (!selectedBranchId) return;

    if (isSchemaMissing) {
      toastError(t("inventory.schema_missing_save_blocked", "لا يمكن حفظ المستند لعدم تفعيل الجداول في قاعدة البيانات الخاصة بك. يرجى تفعيلها أولاً."));
      return;
    }

    const itemsToAdjust = Object.keys(touchedItems).filter(
      (itemId) => touchedItems[itemId]
    );

    if (itemsToAdjust.length === 0) {
      toastError(t("inventory.no_items_adjusted", "يرجى تعديل كمية مادة واحدة على الأقل قبل حفظ المستند."));
      return;
    }

    setSubmitting(true);
    try {
      // 1. Create adjustment header payload
      const finalStatus = isApprovedState && hasApprovePermission ? "Approved" : "Draft";
      
      const headerPayload = {
        branch_id: selectedBranchId,
        reference_number: computedReferenceNumber,
        status: finalStatus,
        adjustment_type: adjustmentType,
        created_by: currentStaff?.id || "unknown",
        created_by_name: currentStaff?.name || "Anonymous",
        approved_by: finalStatus === "Approved" ? currentStaff?.id : null,
        approved_by_name: finalStatus === "Approved" ? currentStaff?.name : null,
        notes: globalNotes || `Reconciliation for ${branches.find((b) => b.id === selectedBranchId)?.name}`,
      };

      const detailsPayloads: any[] = [];
      const branchInventoryUpdates: any[] = [];
      const ledgerPayloads: any[] = [];

      // 2. Loop & populate detail lines and optional stock changes
      for (const itemId of itemsToAdjust) {
        const itemObj = items.find((i) => i.id === itemId);
        if (!itemObj) continue;

        const bookQty = getBookStock(itemId);
        const actualQty = actualCounts[itemId] ?? 0;
        const varianceQty = actualQty - bookQty;
        const costPrice = unitCosts[itemId] ?? getUnitCost(itemObj);
        const totalVarianceCost = varianceQty * costPrice;
        const rowReason = itemReasons[itemId] || "";

        detailsPayloads.push({
          product_id: itemId,
          product_name: itemObj.name,
          system_qty: bookQty,
          physical_qty: actualQty,
          variance_qty: varianceQty,
          unit_cost: costPrice,
          total_variance_cost: totalVarianceCost,
          reason: rowReason || null,
        });

        if (finalStatus === "Approved") {
          const stocks = branchStock[itemId] || [];
          const existingInventory = stocks.find((bi) => bi.branchId === selectedBranchId);

          branchInventoryUpdates.push({
            item_id: itemId,
            branch_id: selectedBranchId,
            quantity: actualQty,
            has_existing: !!existingInventory,
          });

          ledgerPayloads.push({
            item_id: itemId,
            branch_id: selectedBranchId,
            type: "adjustment",
            previous_quantity: bookQty,
            new_quantity: actualQty,
            change: varianceQty,
            staff_id: currentStaff?.id || "unknown",
            staff_name: currentStaff?.name || "System",
          });
        }
      }

      // Send to server API proxy to execute safely bypassing RLS
      const { data: { session } } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error("No user authorization token found");

      const response = await fetch("/api/inventory-adjustments", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          header: headerPayload,
          details: detailsPayloads,
          branchInventoryUpdates,
          ledgerPayloads,
        }),
      });

      if (!response.ok) {
        const errJson = await response.json();
        throw new Error(errJson.error || "Failed to commit adjustment");
      }

      toastSuccess(
        finalStatus === "Approved"
          ? t("inventory.reconcile_approve_success", "تم اعتماد مستند جرد وتسوية المخزون وتحديث الأرصدة بنجاح!")
          : t("inventory.reconcile_draft_success", "تم حفظ مستند الجرد كمسودة معلقة للمراجعة والموافقة.")
      );

      // Clean up session states
      setActualCounts({});
      setUnitCosts({});
      setItemReasons({});
      setTouchedItems({});
      setGlobalNotes("");
      setShowConfirmModal(false);
      onRefresh(); // Trigger parent data refresh
    } catch (err: any) {
      console.error("Error committing inventory adjustment transaction:", err);
      handleError(err, t("inventory.reconcile_failed", "فشلت عملية حفظ مستند تسوية المخزون."));
    } finally {
      setSubmitting(false);
    }
  };

  // Format currencies beautifully
  const formatCurrency = (val: number) => {
    return new Intl.NumberFormat(isRtl ? "ar-SA" : "en-US", {
      style: "currency",
      currency: isRtl ? "SAR" : "USD",
      minimumFractionDigits: 2,
    }).format(val);
  };

  return (
    <div className="space-y-6 max-w-7xl mx-auto" id="inventory-reconciliation-module">
      
      {/* Tab Selectors - Optimized, sleek layout with layoutId animations */}
      <div className="flex items-center gap-1 bg-surface-muted p-1 rounded-2xl border border-border/60 w-fit">
        <button
          onClick={() => setActiveSubTab("new_adjustment")}
          className={cn(
            "relative px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 cursor-pointer z-10",
            activeSubTab === "new_adjustment"
              ? "text-white font-bold"
              : "text-content-muted hover:text-content"
          )}
        >
          {activeSubTab === "new_adjustment" && (
            <motion.div
              layoutId="activeSubTabIndicator"
              className="absolute inset-0 bg-brand rounded-xl -z-10 shadow-sm"
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
            />
          )}
          <ClipboardList size={15} />
          {t("inventory.tab_new_adjustment", "عملية جرد جديدة")}
        </button>
        <button
          onClick={() => setActiveSubTab("adjustment_history")}
          className={cn(
            "relative px-4 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all flex items-center gap-2 cursor-pointer z-10",
            activeSubTab === "adjustment_history"
              ? "text-white font-bold"
              : "text-content-muted hover:text-content"
          )}
        >
          {activeSubTab === "adjustment_history" && (
            <motion.div
              layoutId="activeSubTabIndicator"
              className="absolute inset-0 bg-brand rounded-xl -z-10 shadow-sm"
              transition={{ type: "spring", stiffness: 380, damping: 30 }}
            />
          )}
          <Clock size={15} />
          {t("inventory.tab_adjustment_history", "تاريخ حركات الجرد")}
        </button>
      </div>

      {activeSubTab === "new_adjustment" && (
        <div className="space-y-6">
          {isSchemaMissing && (
            <div className="bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 p-5 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm" id="schema-missing-banner-new">
              <div className="flex gap-3">
                <Database className="text-amber-600 shrink-0 mt-0.5" size={20} />
                <div className="space-y-1">
                  <h4 className="font-black text-sm text-amber-800 dark:text-amber-300">
                    {t("inventory.schema_missing_title", "تنبيه: ميزة جرد وتسوية المخزون بحاجة لتفعيل")}
                  </h4>
                  <p className="text-xs text-amber-700/80 dark:text-amber-400/80 leading-relaxed max-w-2xl">
                    {t("inventory.schema_missing_desc_merchant", "ميزة جرد وتسوية المخزون بحاجة إلى تفعيل من قبل فريق الإدارة أو الدعم الفني للربط مع قاعدة البيانات الخاصة بمتجرك.")}
                  </p>
                </div>
              </div>
            </div>
          )}
          {/* Header Configuration Panel - Sophisticated Layout */}
          <div className="bg-surface p-5 sm:p-6 rounded-2xl border border-border/80 shadow-xs space-y-6">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-brand/10 text-brand rounded-xl">
                    <Shield size={20} />
                  </div>
                  <div>
                    <h3 className="text-lg font-black text-content">
                      {t("inventory.reconciliation_title", "وحدة تسوية وجرد المخزون")}
                    </h3>
                    <p className="text-xs text-content-muted">
                      {t(
                        "inventory.reconciliation_subtitle",
                        "متوافقة تماماً مع معايير IFRS للمحاسبة. اختر الفرع ونوع الجرد ثم قم بمطابقة الكميات الدفترية مع الكميات الفعلية."
                      )}
                    </p>
                  </div>
                </div>
              </div>

              {/* RBAC Info Indicator - Elegant compact badge style */}
              <div className="flex items-center gap-2.5 bg-surface-muted/60 p-3 rounded-xl border border-border/40 text-xs max-w-md">
                <Lock className="text-brand shrink-0" size={15} />
                <div className="space-y-0.5">
                  <p className="font-bold text-content">
                    {t("inventory.user_role_label", "الدور الحالي:")}{" "}
                    <span className="text-brand font-extrabold bg-brand/10 px-1.5 py-0.5 rounded-md">
                      {String(t(`roles.${currentStaff?.role || "cashier"}`, currentStaff?.role || "Cashier"))}
                    </span>
                  </p>
                  <p className="text-content-muted text-[11px] leading-tight font-medium">
                    {hasApprovePermission
                      ? t("inventory.has_full_reconcile_rights", "لديك صلاحية الاعتماد المباشر وتحديث المخزون.")
                      : t("inventory.cashier_draft_only", "يمكنك فقط حفظ الجرد كمسودة ليقوم مدير النظام باعتمادها.")}
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5 pt-5 border-t border-border/60">
              {/* Branch Selector */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-content-muted uppercase tracking-wider">
                  {t("inventory.select_branch_label", "1. حدد فرع الجرد المستهدف")}
                </label>
                <div className="relative">
                  <select
                    value={selectedBranchId}
                    onChange={(e) => handleBranchChange(e.target.value)}
                    className="w-full bg-surface-muted text-content border border-border/80 px-3.5 py-2.5 rounded-xl font-bold text-sm focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand appearance-none cursor-pointer transition-all"
                  >
                    <option value="">{t("inventory.choose_branch_option", "اختر مستودع أو فرع للتسوية...")}</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name} ({b.type === "warehouse" ? t("inventory.type_warehouse", "مستودع") : t("inventory.type_store", "معرض")})
                      </option>
                    ))}
                  </select>
                  <ChevronDown
                    size={16}
                    className={cn(
                      "absolute top-1/2 -translate-y-1/2 text-content-muted pointer-events-none",
                      isRtl ? "left-3.5" : "right-3.5"
                    )}
                  />
                </div>
              </div>

              {/* Adjustment Reason Type */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-content-muted uppercase tracking-wider">
                  {t("inventory.adjustment_type_label", "2. غرض التسوية والجرد")}
                </label>
                <div className="relative">
                  <select
                    value={adjustmentType}
                    onChange={(e) => setAdjustmentType(e.target.value as any)}
                    className="w-full bg-surface-muted text-content border border-border/80 px-3.5 py-2.5 rounded-xl font-bold text-sm focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand appearance-none cursor-pointer transition-all"
                  >
                    <option value="Physical Count">{t("inventory.adjustment_type_count", "جرد فعلي دوري - Physical Count")}</option>
                    <option value="Damage">{t("inventory.adjustment_type_damage", "شطب وإتلاف مخزون تالف - Damage")}</option>
                    <option value="Loss">{t("inventory.adjustment_type_loss", "تسجيل فقدان وعجز - Loss")}</option>
                    <option value="Internal Use">{t("inventory.adjustment_type_internal", "استهلاك واستخدام داخلي - Internal Use")}</option>
                  </select>
                  <ChevronDown
                    size={16}
                    className={cn(
                      "absolute top-1/2 -translate-y-1/2 text-content-muted pointer-events-none",
                      isRtl ? "left-3.5" : "right-3.5"
                    )}
                  />
                </div>
              </div>

              {/* Unique Reference Number Display */}
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-content-muted uppercase tracking-wider">
                  {t("inventory.reference_number_label", "الرقم المرجعي التلقائي (IFRS)")}
                </label>
                <div className="bg-surface-muted/80 border border-border/80 text-content font-mono px-3.5 py-2.5 rounded-xl font-bold text-sm select-all flex items-center justify-between">
                  <span className="text-brand font-semibold tracking-wider">{computedReferenceNumber}</span>
                  <span className="text-[10px] bg-brand/15 text-brand px-2 py-0.5 rounded-md font-bold uppercase tracking-widest">
                    {t("inventory.reference_auto", "تلقائي")}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {!selectedBranchId ? (
            <div className="flex flex-col items-center justify-center py-16 bg-surface rounded-2xl border border-dashed border-border text-center space-y-4">
              <div className="p-4 bg-brand/5 rounded-full text-brand animate-pulse">
                <ClipboardList size={36} />
              </div>
              <div className="space-y-1">
                <h4 className="text-base font-black text-content">
                  {t("inventory.ready_to_reconcile_title", "بانتظار تحديد الفرع")}
                </h4>
                <p className="text-xs text-content-muted max-w-xs mx-auto leading-relaxed">
                  {t(
                    "inventory.ready_to_reconcile_desc",
                    "يرجى تحديد المستودع أو المعرض الذي ترغب في جرد ومطابقة مخزونه الفعلي للبدء."
                  )}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Financial & Count Stats Cards - Elegant flat cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-surface p-5 rounded-2xl border border-border/80 shadow-xs flex flex-col justify-between">
                  <p className="text-[11px] font-bold text-content-muted uppercase tracking-wider">
                    {t("inventory.items_modified_in_take", "الأصناف المجرودة حالياً")}
                  </p>
                  <div className="flex items-baseline gap-1.5 mt-2">
                    <span className="text-xl font-black text-content">
                      {sessionStats.touchedCount}
                    </span>
                    <span className="text-xs text-content-muted font-bold">
                      / {items.length} {t("common.products_count", "منتج")}
                    </span>
                  </div>
                </div>

                <div className="bg-surface p-5 rounded-2xl border border-border/80 shadow-xs flex flex-col justify-between">
                  <p className="text-[11px] font-bold text-content-muted uppercase tracking-wider">
                    {t("inventory.impact_financial_title", "الأثر المالي الصافي (WAC)")}
                  </p>
                  <div
                    className={cn(
                      "flex items-center gap-1 mt-2 font-black text-xl",
                      sessionStats.netFinancialImpact > 0
                        ? "text-success"
                        : sessionStats.netFinancialImpact < 0
                        ? "text-danger"
                        : "text-content-muted"
                    )}
                  >
                    {sessionStats.netFinancialImpact > 0 && <ArrowUpRight size={18} className="shrink-0" />}
                    {sessionStats.netFinancialImpact < 0 && <ArrowDownRight size={18} className="shrink-0" />}
                    <span>{formatCurrency(sessionStats.netFinancialImpact)}</span>
                  </div>
                </div>

                <div className="bg-surface p-5 rounded-2xl border border-border/80 shadow-xs flex flex-col justify-between">
                  <p className="text-[11px] font-bold text-danger uppercase tracking-wider">
                    {t("inventory.reconcile_deficits", "عدد الأصناف بالعجز")}
                  </p>
                  <div className="flex items-center gap-1.5 mt-2 text-danger">
                    <Minus size={15} />
                    <span className="text-xl font-black">{sessionStats.totalItemsWithDeficit}</span>
                  </div>
                </div>

                <div className="bg-surface p-5 rounded-2xl border border-border/80 shadow-xs flex flex-col justify-between">
                  <p className="text-[11px] font-bold text-success uppercase tracking-wider">
                    {t("inventory.reconcile_surpluses", "عدد الأصناف بالزيادة")}
                  </p>
                  <div className="flex items-center gap-1.5 mt-2 text-success">
                    <Plus size={15} />
                    <span className="text-xl font-black">{sessionStats.totalItemsWithSurplus}</span>
                  </div>
                </div>
              </div>

              {/* Filters / Search Bar - Pristine Layout */}
              <div className="bg-surface p-4 rounded-2xl border border-border/80 shadow-xs flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
                  {/* Search Input */}
                  <div className="relative flex-1">
                    <Search
                      size={15}
                      className={cn(
                        "absolute top-1/2 -translate-y-1/2 text-content-muted",
                        isRtl ? "right-3.5" : "left-3.5"
                      )}
                    />
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      placeholder={t("inventory.search_barcode_sku_placeholder", "البحث باسم الصنف، الباركود، أو رمز الـ SKU...")}
                      className={cn(
                        "w-full bg-surface-muted text-content border border-border py-2 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand focus:bg-surface transition-all",
                        isRtl ? "pr-10 pl-3.5" : "pl-10 pr-3.5"
                      )}
                    />
                  </div>

                  {/* Category select filter */}
                  <div className="relative w-full sm:w-44">
                    <select
                      value={selectedCategory}
                      onChange={(e) => setSelectedCategory(e.target.value)}
                      className="w-full bg-surface-muted text-content border border-border px-3 py-2 rounded-xl font-bold text-xs sm:text-sm appearance-none focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand cursor-pointer transition-all"
                    >
                      <option value="all">{t("inventory.all_categories", "كل الفئات")}</option>
                      {categories.map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                    <ChevronDown
                      size={14}
                      className={cn(
                        "absolute top-1/2 -translate-y-1/2 text-content-muted pointer-events-none",
                        isRtl ? "left-3" : "right-3"
                      )}
                    />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleSetAllToBook}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20 transition-all cursor-pointer"
                  >
                    <CheckCircle2 size={13} />
                    {t("inventory.import_all_current", "تعبئة الدفتري للكل")}
                  </button>
                  {sessionStats.touchedCount > 0 && (
                    <button
                      onClick={handleReset}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold bg-danger/10 text-danger border border-danger/20 hover:bg-danger/20 transition-all cursor-pointer"
                    >
                      <RotateCcw size={13} />
                      {t("inventory.reset_all", "تفريغ المسودة")}
                    </button>
                  )}
                </div>
              </div>

              {/* SMART TABLE FOR PHYSICAL COUNT */}
              <div className="bg-surface rounded-2xl border border-border/80 shadow-xs overflow-hidden">
                {filteredItems.length === 0 ? (
                  <div className="text-center py-12 space-y-2">
                    <AlertTriangle className="text-warning mx-auto" size={32} />
                    <h4 className="text-sm font-black text-content">
                      {t("inventory.no_results_filters", "لم نجد نتائج مطابقة لخيارات الفلترة")}
                    </h4>
                    <p className="text-xs text-content-muted max-w-xs mx-auto">
                      {t("inventory.no_results_filters_desc", "جرب إزالة كلمات البحث أو تغيير فئة الفلتر الحالية.")}
                    </p>
                  </div>
                ) : (
                  <div className="overflow-x-auto whitespace-nowrap scrollbar-hide">
                    <table className="w-full text-right min-w-max border-collapse">
                      <thead className="bg-surface-muted text-content-muted text-[10px] font-extrabold uppercase tracking-widest border-b border-border/60">
                        <tr>
                          <th className="px-5 py-3 text-start">{t("inventory.table_item_name", "المادة / الصنف")}</th>
                          <th className="px-5 py-3 text-start">{t("inventory.table_sku_barcode", "SKU / باركود")}</th>
                          <th className="px-5 py-3 text-center">{t("inventory.table_system_qty", "الكمية الدفترية")}</th>
                          <th className="px-5 py-3 text-center w-48">{t("inventory.table_physical_qty", "الكمية الفعلية (العدّ)")}</th>
                          <th className="px-5 py-3 text-center">{t("inventory.table_variance", "العجز والزيادة")}</th>
                          <th className="px-5 py-3 text-center w-32">{t("inventory.table_unit_cost", "تكلفة الوحدة (WAC)")}</th>
                          <th className="px-5 py-3 text-center">{t("inventory.table_total_variance_cost", "إجمالي التكلفة المهدرة")}</th>
                          <th className="px-5 py-3 w-44">{t("inventory.table_reason", "السبب المباشر")}</th>
                          <th className="px-5 py-3"></th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border/40">
                        {filteredItems.map((item) => {
                          const bookQty = getBookStock(item.id);
                          const isTouched = touchedItems[item.id];
                          const actualQty = isTouched ? actualCounts[item.id] : bookQty;
                          const varianceQty = actualQty - bookQty;
                          const unitCostVal = unitCosts[item.id] ?? getUnitCost(item);
                          const totalVarianceCost = varianceQty * unitCostVal;
                          const reasonVal = itemReasons[item.id] || "";

                          return (
                            <tr
                              key={item.id}
                              className={cn(
                                "hover:bg-surface-muted/40 transition-all relative",
                                isTouched && "bg-brand/[0.02]"
                              )}
                            >
                              {/* Product Info */}
                              <td className="px-5 py-3.5 text-start">
                                <div className="flex items-center gap-3">
                                  {item.mainImage ? (
                                    <img
                                      src={item.mainImage}
                                      alt={item.name}
                                      referrerPolicy="no-referrer"
                                      className="w-9 h-9 rounded-lg object-cover border border-border/80 shrink-0"
                                    />
                                  ) : (
                                    <div className="w-9 h-9 bg-brand/10 text-brand rounded-lg flex items-center justify-center shrink-0 font-extrabold text-xs">
                                      {item.name.charAt(0)}
                                    </div>
                                  )}
                                  <div className="space-y-0.5">
                                    <p className="font-bold text-content text-xs sm:text-sm leading-tight">{item.name}</p>
                                    <p className="text-[10px] text-content-muted font-semibold uppercase tracking-wider">
                                      {t(`category.${item.category}`, item.category)}
                                    </p>
                                  </div>
                                </div>
                              </td>

                              {/* SKU & Barcode */}
                              <td className="px-5 py-3.5 text-start">
                                <p className="text-xs font-mono font-semibold text-content">{item.sku || "—"}</p>
                                {item.barcode && (
                                  <p className="text-[10px] font-mono text-content-muted font-medium mt-0.5">{item.barcode}</p>
                                )}
                              </td>

                              {/* System Book Stock */}
                              <td className="px-5 py-3.5 text-center text-xs sm:text-sm font-bold text-content-muted">
                                {bookQty}{" "}
                                <span className="text-[10px] font-medium opacity-80">
                                  {t(`units.${item.baseUnit || "piece"}`, item.baseUnit || "Pcs")}
                                </span>
                              </td>

                              {/* Actual physical counts */}
                              <td className="px-5 py-3.5 text-center w-48">
                                <div className="flex items-center justify-center gap-1 mx-auto max-w-[125px]">
                                  <button
                                    type="button"
                                    onClick={() => handleAdjustCount(item.id, false)}
                                    className="p-1 bg-surface hover:bg-surface-muted text-content-muted border border-border rounded-lg transition-all"
                                  >
                                    <Minus size={11} />
                                  </button>
                                  <input
                                    type="text"
                                    value={isTouched ? actualCounts[item.id] : ""}
                                    onChange={(e) => handleActualStockChange(item.id, e.target.value)}
                                    placeholder={bookQty.toString()}
                                    className="w-12 bg-surface-muted text-center text-content border border-border py-1 rounded-lg font-bold text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand focus:bg-surface transition-all"
                                  />
                                  <button
                                    type="button"
                                    onClick={() => handleAdjustCount(item.id, true)}
                                    className="p-1 bg-surface hover:bg-surface-muted text-content-muted border border-border rounded-lg transition-all"
                                  >
                                    <Plus size={11} />
                                  </button>
                                </div>
                              </td>

                              {/* Dynamic Variance calculation */}
                              <td className="px-5 py-3.5 text-center">
                                <span
                                  className={cn(
                                    "inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold",
                                    varianceQty > 0
                                      ? "text-emerald-700 bg-emerald-50 dark:bg-emerald-950/30 dark:text-emerald-300"
                                      : varianceQty < 0
                                      ? "text-rose-700 bg-rose-50 dark:bg-rose-950/30 dark:text-rose-300"
                                      : "text-content-muted bg-surface-muted"
                                  )}
                                >
                                  {varianceQty > 0 ? `+${varianceQty}` : varianceQty}
                                </span>
                              </td>

                              {/* Unit Cost input (WAC) */}
                              <td className="px-5 py-3.5 text-center w-32">
                                <div className="relative">
                                  <input
                                    type="text"
                                    value={unitCosts[item.id] !== undefined ? unitCosts[item.id] : ""}
                                    onChange={(e) => handleCostChange(item.id, e.target.value)}
                                    placeholder={getUnitCost(item).toString()}
                                    className="w-full bg-surface-muted text-center text-content border border-border py-1 rounded-lg text-xs font-bold focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand focus:bg-surface transition-all"
                                  />
                                </div>
                              </td>

                              {/* Total Variance Cost */}
                              <td className="px-5 py-3.5 text-center font-bold text-xs sm:text-sm">
                                <span
                                  className={cn(
                                    varianceQty > 0
                                      ? "text-emerald-600 dark:text-emerald-400"
                                      : varianceQty < 0
                                      ? "text-rose-600 dark:text-rose-400"
                                      : "text-content-muted"
                                  )}
                                >
                                  {formatCurrency(totalVarianceCost)}
                                </span>
                              </td>

                              {/* Row specific reason */}
                              <td className="px-5 py-3.5 w-44">
                                <input
                                  type="text"
                                  value={reasonVal}
                                  onChange={(e) => handleItemReasonChange(item.id, e.target.value)}
                                  placeholder={t("inventory.reason_placeholder", "إتلاف، كسر، فقد...")}
                                  className="w-full bg-surface-muted text-content border border-border px-2.5 py-1 rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand focus:bg-surface transition-all"
                                />
                              </td>

                              {/* Fast match button */}
                              <td className="px-5 py-3.5 text-end">
                                {!isTouched && (
                                  <button
                                    type="button"
                                    onClick={() => handleCopyBookStock(item)}
                                    className="text-xs font-bold text-brand hover:underline cursor-pointer"
                                  >
                                    {t("inventory.start_take_btn", "بدء العدّ")}
                                  </button>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Notes & Submission Panel */}
              {sessionStats.touchedCount > 0 && (
                <div className="bg-surface p-5 sm:p-6 rounded-2xl border border-border/80 shadow-xs space-y-5">
                  <div className="space-y-1.5">
                    <h4 className="text-sm font-black text-content">
                      {t("inventory.global_notes_label", "ملاحظات وتبرير عام للمستند")}
                    </h4>
                    <textarea
                      value={globalNotes}
                      onChange={(e) => setGlobalNotes(e.target.value)}
                      placeholder={t(
                        "inventory.global_notes_placeholder",
                        "اكتب هنا تفاصيل الجرد، مثلاً: جرد ربع سنوي لشهر أغسطس، تم استبعاد الأقمشة التالفة وتسوية الرصيد تلقائياً."
                      )}
                      rows={2.5}
                      className="w-full bg-surface-muted text-content border border-border p-3 rounded-xl text-xs sm:text-sm focus:outline-none focus:ring-1 focus:ring-brand focus:border-brand focus:bg-surface transition-all"
                    />
                  </div>

                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-5 pt-4 border-t border-border/60">
                    <div className="space-y-0.5">
                      <p className="text-xs sm:text-sm font-bold text-content flex items-center gap-1.5">
                        <Check size={16} className="text-emerald-500" />
                        {t("inventory.ready_to_commit_take", "مستند الجرد جاهز للتأكيد والاعتماد")}
                      </p>
                      <p className="text-xs text-content-muted leading-relaxed max-w-xl font-medium">
                        {hasApprovePermission
                          ? t("inventory.admin_submit_hint", "بصفتك مديراً، يمكنك اعتماد الجرد لتحديث كمية المستودعات ومستندات الأرصدة فوراً.")
                          : t("inventory.cashier_submit_hint", "بصفتك صرافاً، سيتم حفظ هذه كمسودة معلقة للمراجعة والموافقة من قبل الإدارة.")}
                      </p>
                    </div>

                    <div className="flex flex-col sm:flex-row items-center gap-3 w-full md:w-auto shrink-0">
                      {/* Admin Toggle for Draft vs Direct Approval */}
                      {hasApprovePermission && (
                        <div className="flex items-center gap-3 bg-surface-muted px-3 py-1.5 rounded-xl border border-border/80 w-full sm:w-auto justify-between">
                          <span className="text-xs font-bold text-content whitespace-nowrap">
                            {t("inventory.approve_immediately", "اعتماد فوري")}
                          </span>
                          <button
                            type="button"
                            onClick={() => setIsApprovedState(!isApprovedState)}
                            className={cn(
                              "w-11 h-6 rounded-full p-0.5 transition-all duration-300 relative focus:outline-none cursor-pointer",
                              isApprovedState ? "bg-brand" : "bg-neutral-300 dark:bg-neutral-700"
                            )}
                          >
                            <div
                              className={cn(
                                "w-5 h-5 rounded-full bg-white shadow-sm transition-all duration-300 absolute top-0.5",
                                isApprovedState ? (isRtl ? "right-5.5" : "left-5.5") : (isRtl ? "right-0.5" : "left-0.5")
                              )}
                            />
                          </button>
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => setShowConfirmModal(true)}
                        className="w-full sm:w-auto flex items-center justify-center gap-2 bg-brand text-white px-6 py-2.5 rounded-xl font-bold text-xs sm:text-sm hover:opacity-90 transition-all cursor-pointer shadow-sm shadow-brand/10 shrink-0"
                      >
                        <Save size={15} />
                        {isApprovedState && hasApprovePermission
                          ? t("inventory.submit_reconciliation_approve", "اعتماد وإقفال الجرد")
                          : t("inventory.submit_reconciliation_draft", "حفظ المسودة")}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeSubTab === "adjustment_history" && (
        <div className="space-y-6">
          {isSchemaMissing && (
            <div className="bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400 p-5 rounded-2xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4 shadow-sm" id="schema-missing-banner-history">
              <div className="flex gap-3">
                <Database className="text-amber-600 shrink-0 mt-0.5" size={20} />
                <div className="space-y-1">
                  <h4 className="font-black text-sm text-amber-800 dark:text-amber-300">
                    {t("inventory.schema_missing_title", "تنبيه: ميزة جرد وتسوية المخزون بحاجة لتفعيل")}
                  </h4>
                  <p className="text-xs text-amber-700/80 dark:text-amber-400/80 leading-relaxed max-w-2xl">
                    {t("inventory.schema_missing_desc_merchant", "ميزة جرد وتسوية المخزون بحاجة إلى تفعيل من قبل فريق الإدارة أو الدعم الفني للربط مع قاعدة البيانات الخاصة بمتجرك.")}
                  </p>
                </div>
              </div>
            </div>
          )}
          
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          
          {/* History List Header & Table - Structured cleanly */}
          <div className="lg:col-span-7 bg-surface p-5 sm:p-6 rounded-2xl border border-border/80 shadow-xs space-y-4">
            <h3 className="text-base font-black text-content flex items-center gap-2">
              <Clock className="text-brand" size={18} />
              {t("inventory.past_reconciles_list", "سجل مستندات جرد المخزون")}
            </h3>

            {historyLoading ? (
              <div className="flex items-center justify-center py-16">
                <Clock className="animate-spin text-brand" size={24} />
              </div>
            ) : history.length === 0 ? (
              <div className="text-center py-12 space-y-2">
                <FileText className="text-content-muted mx-auto" size={28} />
                <h4 className="text-sm font-black text-content">
                  {t("inventory.no_history_records", "لا توجد مستندات جرد مسجلة بعد")}
                </h4>
                <p className="text-xs text-content-muted max-w-xs mx-auto">
                  {t("inventory.no_history_records_desc", "ستظهر هنا كافة حركات الجرد والمسودات بمجرد إنشائها.")}
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto whitespace-nowrap scrollbar-hide">
                <table className="w-full text-right min-w-max border-collapse">
                  <thead className="bg-surface-muted text-content-muted text-[10px] font-extrabold uppercase tracking-widest border-b border-border/60">
                    <tr>
                      <th className="px-4 py-2.5 text-start">{t("inventory.history_ref", "الرقم المرجعي")}</th>
                      <th className="px-4 py-2.5 text-start">{t("inventory.history_branch", "الفرع / المستودع")}</th>
                      <th className="px-4 py-2.5 text-start">{t("inventory.history_type", "نوع الحركة")}</th>
                      <th className="px-4 py-2.5 text-center">{t("inventory.history_status", "الحالة")}</th>
                      <th className="px-4 py-2.5 text-start">{t("inventory.history_date", "التاريخ والوقت")}</th>
                      <th className="px-4 py-2.5"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/40">
                    {history.map((record) => {
                      const branch = branches.find((b) => b.id === record.branch_id);
                      return (
                        <tr
                          key={record.id}
                          className={cn(
                            "hover:bg-surface-muted/40 transition-colors group cursor-pointer",
                            selectedHistoryItem?.id === record.id && "bg-brand/[0.03]"
                          )}
                          onClick={() => fetchAdjustmentDetails(record)}
                        >
                          <td className="px-4 py-3 text-start font-mono font-bold text-xs text-brand">
                            {record.reference_number}
                          </td>
                          <td className="px-4 py-3 text-start text-xs font-semibold text-content">
                            {branch?.name || t("common.unknown")}
                          </td>
                          <td className="px-4 py-3 text-start text-xs font-medium text-content-muted">
                            {String(t(`inventory_adj_type.${record.adjustment_type}`, record.adjustment_type))}
                          </td>
                          <td className="px-4 py-3 text-center">
                            <span
                              className={cn(
                                "inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-bold",
                                record.status === "Approved"
                                  ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                  : record.status === "Draft"
                                  ? "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                  : "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                              )}
                            >
                              {record.status === "Approved"
                                ? t("inventory.status_approved", "معتمد")
                                : record.status === "Draft"
                                ? t("inventory.status_draft", "مسودة")
                                : t("inventory.status_cancelled", "ملغي")}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-start text-xs text-content-muted">
                            {new Date(record.created_at).toLocaleString(isRtl ? "ar-EG" : "en-US", {
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </td>
                          <td className="px-4 py-3 text-end">
                            <Eye size={13} className="text-content-muted group-hover:text-brand transition-colors" />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Details / Audit Viewer - Styled like an elegant statement */}
          <div className="lg:col-span-5 bg-surface p-5 sm:p-6 rounded-2xl border border-border/80 shadow-xs space-y-4">
            <h3 className="text-base font-black text-content flex items-center gap-2">
              <FileText className="text-brand" size={18} />
              {t("inventory.audit_details_title", "تفاصيل مستند المراجعة")}
            </h3>

            {!selectedHistoryItem ? (
              <div className="text-center py-20 border border-dashed border-border/80 rounded-xl bg-surface-muted/40 flex flex-col items-center justify-center p-5 space-y-3">
                <div className="p-3 bg-brand/5 rounded-full text-brand/80">
                  <ClipboardList size={24} />
                </div>
                <div className="space-y-1">
                  <h4 className="text-xs sm:text-sm font-black text-content">
                    {t("inventory.select_record_to_view", "بانتظار تحديد مستند")}
                  </h4>
                  <p className="text-xs text-content-muted max-w-[200px] mx-auto leading-relaxed">
                    {t("inventory.select_record_desc", "اضغط على أي مستند تسوية من القائمة المقابلة لعرض تفاصيل المواد والتحقق المالي.")}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                
                {/* Header Metadata - Receipt Style */}
                <div className="bg-surface-muted/60 p-4 rounded-xl border border-border/60 text-xs space-y-2.5">
                  <div className="flex justify-between items-center">
                    <span className="text-content-muted">{t("inventory.history_ref_label", "الرقم المرجعي:")}</span>
                    <span className="font-mono font-bold text-brand bg-brand/10 px-2 py-0.5 rounded-md">{selectedHistoryItem.reference_number}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-content-muted">{t("inventory.history_status_label", "حالة المستند:")}</span>
                    <span
                      className={cn(
                        "font-extrabold px-1.5 py-0.5 rounded-md text-[11px]",
                        selectedHistoryItem.status === "Approved"
                          ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                          : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                      )}
                    >
                      {selectedHistoryItem.status}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-content-muted">{t("inventory.history_creator", "مسؤول الجرد:")}</span>
                    <span className="font-bold text-content">{selectedHistoryItem.created_by_name || "—"}</span>
                  </div>
                  {selectedHistoryItem.approved_by_name && (
                    <div className="flex justify-between items-center">
                      <span className="text-content-muted">{t("inventory.history_approver", "المشرف المعتمد:")}</span>
                      <span className="font-bold text-emerald-600 dark:text-emerald-400">{selectedHistoryItem.approved_by_name}</span>
                    </div>
                  )}
                  {selectedHistoryItem.notes && (
                    <div className="pt-2 border-t border-border/40">
                      <span className="text-content-muted block mb-1 font-semibold">{t("common.notes", "الملاحظات:")}</span>
                      <p className="text-content font-medium italic">"{selectedHistoryItem.notes}"</p>
                    </div>
                  )}
                </div>

                {/* Details Table */}
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-content-muted uppercase tracking-wider">
                    {t("inventory.adjusted_items_table_title", "الأصناف والتسويات المدرجة")}
                  </h4>

                  {detailsLoading ? (
                    <div className="flex items-center justify-center py-8">
                      <Clock className="animate-spin text-brand" size={20} />
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto pr-1 scrollbar-hide">
                      {historyItemDetails.map((detail) => {
                        const isLoss = detail.variance_qty < 0;
                        return (
                          <div
                            key={detail.id}
                            className="bg-surface border border-border/80 p-3 rounded-xl flex items-center justify-between gap-3 shadow-xs"
                          >
                            <div className="space-y-0.5">
                              <p className="text-xs font-extrabold text-content">{detail.product_name}</p>
                              <div className="flex items-center gap-1.5 text-[10px] text-content-muted font-semibold">
                                <span>{t("inventory.details_book_prefix", "دفتري:")} {detail.system_qty}</span>
                                <span>•</span>
                                <span>{t("inventory.details_actual_prefix", "فعلي:")} {detail.physical_qty}</span>
                              </div>
                              {detail.reason && (
                                <p className="text-[10px] text-brand font-medium mt-1">
                                  {t("common.reason", "السبب:")} {detail.reason}
                                </p>
                              )}
                            </div>

                            <div className="text-end space-y-0.5 shrink-0">
                              <span
                                className={cn(
                                  "inline-flex px-1.5 py-0.5 rounded-md text-[9px] font-bold",
                                  isLoss ? "bg-rose-500/10 text-rose-600 dark:text-rose-400" : "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                )}
                              >
                                {detail.variance_qty > 0 ? `+${detail.variance_qty}` : detail.variance_qty}
                              </span>
                              <p className="text-xs font-bold text-content">
                                {formatCurrency(detail.total_variance_cost)}
                              </p>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {/* CONFIRMATION DIALOG MODAL */}
      <AnimatePresence>
        {showConfirmModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setShowConfirmModal(false)}
              className="absolute inset-0 bg-neutral-900/40 backdrop-blur-xs"
            />

            {/* Modal Box */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="bg-surface w-full max-w-md p-5 sm:p-6 rounded-2xl border border-border shadow-xl space-y-5 z-10 relative"
            >
              <div className="flex items-start justify-between">
                <div className="space-y-0.5">
                  <h3 className="text-base font-black text-content">
                    {t("inventory.confirm_title", "تأكيد مستند الجرد والتسوية")}
                  </h3>
                  <p className="text-xs text-content-muted">
                    {t("inventory.confirm_desc", "متوافق مع معايير IFRS. يرجى المراجعة بعناية قبل المتابعة.")}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setShowConfirmModal(false)}
                  className="p-1.5 bg-surface-muted hover:bg-border/60 rounded-lg text-content-muted"
                >
                  <X size={15} />
                </button>
              </div>

              <div className="bg-surface-muted/60 p-4 rounded-xl border border-border/60 space-y-2.5 text-xs sm:text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-content-muted">{t("inventory.confirm_branch", "الفرع المستهدف:")}</span>
                  <span className="font-bold text-content">
                    {branches.find((b) => b.id === selectedBranchId)?.name}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-content-muted">{t("inventory.confirm_type", "نوع الحركة:")}</span>
                  <span className="font-bold text-content">
                    {String(t(`inventory_adj_type.${adjustmentType}`, adjustmentType))}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-content-muted">{t("inventory.confirm_items_count", "عدد المواد المعدلة:")}</span>
                  <span className="font-bold text-content">{sessionStats.touchedCount}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-content-muted">{t("inventory.confirm_impact", "الأثر المالي المالي الصافي:")}</span>
                  <span
                    className={cn(
                      "font-black",
                      sessionStats.netFinancialImpact >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"
                    )}
                  >
                    {formatCurrency(sessionStats.netFinancialImpact)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-content-muted">{t("inventory.confirm_status", "حالة الحفظ المستهدفة:")}</span>
                  <span
                    className={cn(
                      "font-bold px-1.5 py-0.5 rounded-md text-xs",
                      isApprovedState && hasApprovePermission
                        ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                        : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                    )}
                  >
                    {isApprovedState && hasApprovePermission ? t("inventory.confirm_status_approved") : t("inventory.confirm_status_draft")}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setShowConfirmModal(false)}
                  disabled={submitting}
                  className="flex-1 bg-surface-muted hover:bg-border/60 text-content-muted py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all cursor-pointer"
                >
                  {t("common.cancel", "إلغاء")}
                </button>
                <button
                  type="button"
                  onClick={handleCommitReconciliation}
                  disabled={submitting}
                  className="flex-1 bg-brand hover:opacity-90 text-white py-2.5 rounded-xl font-bold text-xs sm:text-sm transition-all flex items-center justify-center gap-1.5 shadow-sm shadow-brand/10 cursor-pointer disabled:opacity-50"
                >
                  {submitting ? (
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  ) : (
                    <CheckCircle2 size={15} />
                  )}
                  {isApprovedState && hasApprovePermission
                    ? t("inventory.confirm_and_close", "اعتماد وتطبيق فوري")
                    : t("inventory.confirm_and_draft", "تأكيد كمسودة")}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </div>
  );
};
