import React, { useState, useEffect } from "react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from "recharts";
import * as XLSX from "xlsx";
import {
  Package,
  Plus,
  Search,
  Filter,
  Trash2,
  Edit2,
  ArrowRightLeft,
  History,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Warehouse,
  Store,
  Barcode,
  Tag,
  TrendingUp,
  Layers,
  MoreVertical,
  Download,
  CheckCircle2,
  Clock,
  AlertTriangle,
  X,
  Shirt,
  Maximize2,
  Archive,
  Layout as LayoutIcon,
} from "lucide-react";
import { supabase } from "../../lib/supabase/client";
import { auth, handleFirestoreError, OperationType } from "../../lib/firebase";
import {
  InventoryItem,
  InventoryVariant,
  Branch,
  BranchInventory,
  StockTransfer,
  StockLedger,
  PermissionKey,
} from "../../types";
import ProductImageUploader from "./ProductImageUploader";
import { usePermissions } from "../../hooks/usePermissions";
import { useStaff } from "../../contexts/StaffContext";
import { useTranslation } from "react-i18next";
import { motion, AnimatePresence } from "motion/react";
import { cn } from "../../lib/utils";
import Branding from "../Branding";
import Select, { SmartSelect } from "../ui/SmartSelect";
import { useToast } from "../../contexts/ToastContext";
import { decodeInventoryDescription, encodeInventoryDescription } from "../../utils/b2bHelper";
import { Menu, Transition } from "@headlessui/react";
import { Fragment } from "react";
import { useRealtimeSync } from "../../hooks/useRealtimeSync";
import { useCallback } from "react";
import { useRouter, useRefreshCounter } from "../../hooks/useRouter";

import StockTransferWorkflow from "./StockTransferWorkflow";

const generateSKU = (name?: string) => {
  const random = Math.floor(10000000 + Math.random() * 90000000);
  return random.toString();
};

interface InventoryManagerProps {
  tenantId: string;
}

const InventoryManager: React.FC<InventoryManagerProps> = ({ tenantId }) => {
  const router = useRouter();
  const refreshCounter = useRefreshCounter();
  const { t } = useTranslation();
  const { currentStaff } = useStaff();
  const { hasPermission } = usePermissions(currentStaff);
  const { error: toastError, success: toastSuccess, handleError } = useToast();

  const [items, setItems] = useState<InventoryItem[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchStock, setBranchStock] = useState<
    Record<string, BranchInventory[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [expandedItem, setExpandedItem] = useState<string | null>(null);

  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const [isBulkDeleteConfirm, setIsBulkDeleteConfirm] = useState(false);

  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [selectedItemForAdjustment, setSelectedItemForAdjustment] = useState<{
    item: InventoryItem;
    variant?: InventoryVariant;
    branch: Branch;
  } | null>(null);
  const [showOpeningBalanceModal, setShowOpeningBalanceModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [activeTab, setActiveTab] = useState<
    "inventory" | "reports" | "transfers"
  >("inventory");
  const [lowStockItems, setLowStockItems] = useState<any[]>([]);
  const [isLowStockOnly, setIsLowStockOnly] = useState(false);

  useEffect(() => {
    const lowStock = items.filter((item) => {
      const totalStock = (
        Object.values(branchStock).flat() as BranchInventory[]
      )
        .filter((bi) => bi.itemId === item.id)
        .reduce((sum, bi) => sum + bi.quantity, 0);
      return totalStock <= (item.minThreshold || 0);
    });
    setLowStockItems(lowStock);
  }, [items, branchStock]);

  // Fetch Master Catalog
  const mapInventoryData = useCallback((d: any) => {
    const meta = decodeInventoryDescription(d.description);
    return {
      ...d,
      nameEn: d.name_en,
      minThreshold: d.min_threshold,
      pricePerUnit: d.price_per_unit,
      costPrice: meta.costPrice || 0,
      taxType: meta.taxType || "exclusive",
      productDescription: meta.originalDescription || d.description || "",
      baseUnit: d.base_unit,
      conversionRate: d.conversion_rate,
      mainImage:
        Array.isArray(d.images) && d.images.length > 0
          ? d.images[0]?.url || d.images[0]
          : undefined,
      collarType: d.collar_type,
      cuffType: d.cuff_type,
      pocketType: d.pocket_type,
      chestStyle: d.chest_style,
      showInPos: d.show_in_pos !== false,
      updatedAt: d.updated_at,
    };
  }, []);

  useRealtimeSync("inventory_items", tenantId, (payload) => {
    if (payload.eventType === "INSERT") {
      const newItem = mapInventoryData(payload.new);
      setItems((prev) => [newItem, ...prev]);
    } else if (payload.eventType === "UPDATE") {
      const updatedItem = mapInventoryData(payload.new);
      setItems((prev) => {
        const index = prev.findIndex((i) => i.id === updatedItem.id);
        if (index >= 0) {
          const arr = [...prev];
          arr[index] = updatedItem;
          return arr;
        }
        return [updatedItem, ...prev];
      });
    } else if (payload.eventType === "DELETE") {
      setItems((prev) => prev.filter((i) => i.id !== payload.old.id));
    }
  });

  useEffect(() => {
    if (!tenantId) return;

    const fetchItems = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("inventory_items")
        .select("*")
        .eq("tenant_id", tenantId);

      if (error) {
        handleFirestoreError(error, OperationType.LIST, "inventory");
      } else {
        setItems(data.map(mapInventoryData));
      }
      setLoading(false);
    };

    fetchItems();
  }, [tenantId, mapInventoryData, refreshCounter]);

  // Fetch Branches
  useEffect(() => {
    if (!tenantId) return;

    const fetchBranches = async () => {
      const { data, error } = await supabase
        .from("branches")
        .select("*")
        .eq("tenant_id", tenantId);

      if (error) {
        handleFirestoreError(error, OperationType.LIST, "branches");
      } else {
        setBranches(data as Branch[]);
      }
    };

    fetchBranches();

    const channel = supabase
      .channel("branches-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "branches",
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          fetchBranches();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId]);

  // Fetch Branch Stock
  useEffect(() => {
    if (!tenantId) return;

    const fetchBranchStock = async () => {
      const { data, error } = await supabase
        .from("branch_inventory")
        .select("*")
        .eq("tenant_id", tenantId);

      if (error) {
        handleFirestoreError(error, OperationType.LIST, "branch_inventory");
      } else {
        const stock: Record<string, BranchInventory[]> = {};
        (data as any[]).forEach((item) => {
          const mapped: BranchInventory = {
            id: item.id,
            branchId: item.branch_id,
            itemId: item.item_id,
            quantity: item.quantity,
            tenantId: item.tenant_id,
            updatedAt: item.updated_at,
          };
          if (!stock[mapped.itemId]) stock[mapped.itemId] = [];
          stock[mapped.itemId].push(mapped);
        });
        setBranchStock(stock);
      }
    };

    fetchBranchStock();

    const channel = supabase
      .channel("branch-inventory-changes")
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "branch_inventory",
          filter: `tenant_id=eq.${tenantId}`,
        },
        () => {
          fetchBranchStock();
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId]);

  function getStockForBranch(itemId: string, branchId: string) {
    return (
      branchStock[itemId]?.find((s) => s.branchId === branchId)?.quantity || 0
    );
  }

  function getTotalStock(itemId: string) {
    return branchStock[itemId]?.reduce((sum, s) => sum + s.quantity, 0) || 0;
  }

  const handleDeleteItem = (id: string) => {
    setDeleteConfirmId(id);
    setIsBulkDeleteConfirm(false);
  };

  const confirmDelete = async () => {
    try {
      if (isBulkDeleteConfirm) {
        // Delete related stock_ledger rows
        await supabase
          .from("stock_ledger")
          .delete()
          .in("item_id", selectedItemIds)
          .eq("tenant_id", tenantId);

        // Delete related stock_transfer_items rows
        await supabase
          .from("stock_transfer_items")
          .delete()
          .in("item_id", selectedItemIds)
          .eq("tenant_id", tenantId);

        // Delete related inventory_reconciliations rows
        await supabase
          .from("inventory_reconciliations")
          .delete()
          .in("item_id", selectedItemIds)
          .eq("tenant_id", tenantId);

        const { error } = await supabase
          .from("inventory_items")
          .delete()
          .in("id", selectedItemIds)
          .eq("tenant_id", tenantId);
        if (error) throw error;
        setSelectedItemIds([]);
        setIsBulkDeleteConfirm(false);
        toastSuccess("تم حذف الأصناف المحددة بنجاح");
      } else if (deleteConfirmId) {
        // Delete related stock_ledger rows
        await supabase
          .from("stock_ledger")
          .delete()
          .eq("item_id", deleteConfirmId)
          .eq("tenant_id", tenantId);

        // Delete related stock_transfer_items rows
        await supabase
          .from("stock_transfer_items")
          .delete()
          .eq("item_id", deleteConfirmId)
          .eq("tenant_id", tenantId);

        // Delete related inventory_reconciliations rows
        await supabase
          .from("inventory_reconciliations")
          .delete()
          .eq("item_id", deleteConfirmId)
          .eq("tenant_id", tenantId);

        const { error } = await supabase
          .from("inventory_items")
          .delete()
          .eq("id", deleteConfirmId)
          .eq("tenant_id", tenantId);
        if (error) throw error;
        setDeleteConfirmId(null);
        toastSuccess(t("common.delete_success", "Item deleted successfully"));
      }
      router.refresh();
    } catch (err: any) {
      toastError(err.message || "Failed to delete item(s)");
    }
  };

  const filteredItems = items.filter((item) => {
    const totalStock = getTotalStock(item.id);
    const isLowStock = totalStock <= (item.minThreshold || 0);

    if (isLowStockOnly && !isLowStock) return false;

    const matchesSearch = item.name
      .toLowerCase()
      .includes(searchTerm.toLowerCase());
    const matchesCategory =
      selectedCategory === "all" || item.category === selectedCategory;
    return matchesSearch && matchesCategory;
  });

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-content flex items-center gap-3">
            <Package className="text-brand" size={32} />
            {t("inventory.title")}
          </h1>
          <p className="text-content-muted font-medium mt-1">
            {t("inventory.subtitle")}
          </p>
        </div>

        <div className="flex items-center gap-3">
          {hasPermission("inventory.create") && (
            <button
              onClick={() => setShowOpeningBalanceModal(true)}
              className="flex items-center gap-2 bg-surface border-2 border-border px-5 py-2.5 rounded-2xl font-bold text-content-muted hover:border-success/20 hover:text-success transition-all shadow-sm"
            >
              <Download size={20} />
              {t("inventory.opening_balance")}
            </button>
          )}
          {hasPermission("inventory.transfer") && (
            <button
              onClick={() => setShowTransferModal(true)}
              className="flex items-center gap-2 bg-surface border-2 border-border px-5 py-2.5 rounded-2xl font-bold text-content-muted hover:border-brand/20 hover:text-brand transition-all shadow-sm"
            >
              <ArrowRightLeft size={20} />
              {t("inventory.transfer_stock")}
            </button>
          )}
          {hasPermission("inventory.create") && (
            <button
              onClick={() => setShowAddModal(true)}
              className="flex items-center gap-2 bg-brand text-white px-6 py-2.5 rounded-2xl font-bold hover:bg-brand/90 transition-all shadow-lg shadow-brand/10"
            >
              <Plus size={20} />
              {t("inventory.add_item")}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-4 bg-surface p-1.5 rounded-2xl border border-border w-fit">
        <button
          onClick={() => setActiveTab("inventory")}
          className={cn(
            "px-6 py-2.5 rounded-xl font-bold transition-all",
            activeTab === "inventory"
              ? "bg-brand text-brand-content shadow-lg shadow-brand/10"
              : "text-content-muted hover:bg-surface-muted",
          )}
        >
          {t("inventory.stock_list")}
        </button>
        <button
          onClick={() => setActiveTab("transfers")}
          className={cn(
            "px-6 py-2.5 rounded-xl font-bold transition-all",
            activeTab === "transfers"
              ? "bg-brand text-brand-content shadow-lg shadow-brand/10"
              : "text-content-muted hover:bg-surface-muted",
          )}
        >
          {t("inventory.transfers")}
        </button>
        <button
          onClick={() => setActiveTab("reports")}
          className={cn(
            "px-6 py-2.5 rounded-xl font-bold transition-all",
            activeTab === "reports"
              ? "bg-brand text-brand-content shadow-lg shadow-brand/10"
              : "text-content-muted hover:bg-surface-muted",
          )}
        >
          {t("inventory.reports")}
        </button>
      </div>

      {activeTab === "inventory" && (
        <>
          {/* Stats Overview */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-surface p-6 rounded-[2rem] border border-border shadow-sm">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-brand/10 text-brand rounded-2xl">
                  <Layers size={24} />
                </div>
                <div>
                  <p className="text-xs font-bold text-content-muted uppercase tracking-wider">
                    {t("inventory.total_items")}
                  </p>
                  <p className="text-2xl font-black text-content">
                    {items.length}
                  </p>
                </div>
              </div>
            </div>
            <div className="bg-surface p-6 rounded-[2rem] border border-border shadow-sm">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-success/10 text-success rounded-2xl">
                  <Warehouse size={24} />
                </div>
                <div>
                  <p className="text-xs font-bold text-content-muted uppercase tracking-wider">
                    {t("inventory.warehouses")}
                  </p>
                  <p className="text-2xl font-black text-content">
                    {branches.filter((b) => b.type === "warehouse").length}
                  </p>
                </div>
              </div>
            </div>
            <div className="bg-surface p-6 rounded-[2rem] border border-border shadow-sm">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-warning/10 text-warning rounded-2xl">
                  <Store size={24} />
                </div>
                <div>
                  <p className="text-xs font-bold text-content-muted uppercase tracking-wider">
                    {t("inventory.branches")}
                  </p>
                  <p className="text-2xl font-black text-content">
                    {branches.filter((b) => b.type === "store").length}
                  </p>
                </div>
              </div>
            </div>
            <div className="bg-surface p-6 rounded-[2rem] border border-border shadow-sm">
              <div className="flex items-center gap-4">
                <div className="p-3 bg-danger/10 text-danger rounded-2xl">
                  <AlertCircle size={24} />
                </div>
                <div>
                  <p className="text-xs font-bold text-content-muted uppercase tracking-wider">
                    {t("inventory.low_stock")}
                  </p>
                  <p className="text-2xl font-black text-content">
                    {
                      items.filter(
                        (item) => getTotalStock(item.id) <= item.minThreshold,
                      ).length
                    }
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Filters */}
          <div className="bg-surface p-4 rounded-[2rem] border border-border shadow-sm flex flex-col md:flex-row gap-4">
            <div className="relative flex-1">
              <Search
                className="absolute left-4 top-1/2 -translate-y-1/2 text-content-muted"
                size={20}
              />
              <input
                type="text"
                placeholder={t("inventory.search_placeholder")}
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-12 pr-4 py-3 bg-surface-muted border-none rounded-2xl focus:ring-2 focus:ring-brand font-medium text-content"
              />
            </div>
            <div className="flex items-center gap-2 min-w-[200px]">
              <Select
                value={selectedCategory}
                onChange={(val) => setSelectedCategory(val)}
                options={[
                  { value: "all", label: t("inventory.all_categories") },
                  { value: "fabric", label: t("inventory.category_fabric") },
                  {
                    value: "ready-made",
                    label: t("inventory.category_ready_made"),
                  },
                  { value: "thread", label: t("inventory.category_thread") },
                  { value: "button", label: t("inventory.category_button") },
                  { value: "lining", label: t("inventory.category_lining") },
                  { value: "other", label: t("inventory.category_other") },
                ]}
                className="bg-surface-muted"
              />
            </div>
          </div>

          {/* Master Catalog Table */}
          <AnimatePresence>
            {lowStockItems.length > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="mb-6 overflow-hidden"
              >
                <button
                  onClick={() => setIsLowStockOnly(!isLowStockOnly)}
                  className={cn(
                    "w-full text-right p-4 flex items-center justify-between rounded-3xl border transition-all",
                    isLowStockOnly
                      ? "bg-danger border-danger/60 text-white shadow-lg shadow-danger/20"
                      : "bg-danger/5 border-danger/10 hover:bg-danger/10",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "p-2 rounded-xl",
                        isLowStockOnly ? "bg-white/20" : "bg-danger text-white",
                      )}
                    >
                      <AlertCircle size={20} />
                    </div>
                    <div>
                      <h4
                        className={cn(
                          "text-sm font-black",
                          isLowStockOnly ? "text-white" : "text-danger-content",
                        )}
                      >
                        {isLowStockOnly
                          ? t("inventory.show_all_items")
                          : t("inventory.low_stock_alert")}
                      </h4>
                      <p
                        className={cn(
                          "text-xs font-bold",
                          isLowStockOnly ? "text-white/80" : "text-danger",
                        )}
                      >
                        {isLowStockOnly
                          ? t("inventory.showing_low_stock_only")
                          : t("inventory.low_stock_count", {
                              count: lowStockItems.length,
                            })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex -space-x-2 rtl:space-x-reverse">
                      {lowStockItems.slice(0, 3).map((item, i) => (
                        <div
                          key={i}
                          className="w-8 h-8 rounded-full bg-white border-2 border-danger/5 flex items-center justify-center text-[10px] font-black text-danger shadow-sm"
                        >
                          {item.name.substring(0, 1)}
                        </div>
                      ))}
                      {lowStockItems.length > 3 && (
                        <div className="w-8 h-8 rounded-full bg-danger/10 border-2 border-danger/5 flex items-center justify-center text-[10px] font-black text-danger shadow-sm">
                          +{lowStockItems.length - 3}
                        </div>
                      )}
                    </div>
                    {isLowStockOnly ? (
                      <X size={20} />
                    ) : (
                      <ChevronRight size={20} className="rtl:rotate-180" />
                    )}
                  </div>
                </button>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="bg-surface rounded-[2.5rem] border border-border shadow-xl overflow-hidden">
            {/* Bulk Selection Controls for Mobile */}
            <div className="md:hidden flex items-center justify-between p-4 bg-surface-muted/50 border-b border-border">
              <button
                type="button"
                onClick={() => {
                  if (selectedItemIds.length === filteredItems.length) {
                    setSelectedItemIds([]);
                  } else {
                    setSelectedItemIds(filteredItems.map(item => item.id));
                  }
                }}
                className="text-xs font-black text-brand bg-brand/10 hover:bg-brand/15 px-4 py-2 rounded-xl transition-all"
              >
                {selectedItemIds.length === filteredItems.length ? "إلغاء تحديد الكل" : "تحديد الكل"}
              </button>
              {selectedItemIds.length > 0 && (
                <span className="text-xs font-bold text-content-muted">
                  تم تحديد {selectedItemIds.length} عنصر
                </span>
              )}
            </div>

            {/* Mobile View: Cards */}
            <div className="md:hidden divide-y divide-border">
              {filteredItems.map((item) => {
                const totalStock = getTotalStock(item.id);
                const isLow = totalStock <= item.minThreshold;
                const isExpanded = expandedItem === item.id;

                return (
                  <div key={item.id} className="p-4 space-y-4">
                    <div
                      className="flex items-center justify-between cursor-pointer"
                      onClick={() =>
                        setExpandedItem(isExpanded ? null : item.id)
                      }
                    >
                      <div className="flex items-center gap-3">
                        <div onClick={(e) => e.stopPropagation()} className="flex items-center">
                          <input
                            type="checkbox"
                            checked={selectedItemIds.includes(item.id)}
                            onChange={(e) => {
                              if (e.target.checked) {
                                setSelectedItemIds([...selectedItemIds, item.id]);
                              } else {
                                setSelectedItemIds(selectedItemIds.filter(id => id !== item.id));
                              }
                            }}
                            className="rounded border-border text-brand focus:ring-brand w-5 h-5 cursor-pointer ml-1"
                          />
                        </div>
                        <div className="p-1 bg-surface border border-border rounded-xl w-14 h-14 flex items-center justify-center shrink-0 shadow-sm">
                          {item.mainImage ? (
                            <img
                              src={item.mainImage}
                              alt={item.name}
                              className="w-full h-full object-cover rounded-lg"
                              referrerPolicy="no-referrer"
                            />
                          ) : (
                            <Package className="text-content-muted" size={24} />
                          )}
                        </div>
                        <div>
                          <p className="font-black text-content">{item.name}</p>
                          <p className="text-[10px] font-bold text-content-muted uppercase tracking-tighter">
                            SKU: {item.sku || "N/A"}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        {isLow ? (
                          <span className="bg-danger/10 text-danger p-1.5 rounded-full">
                            <AlertTriangle size={14} />
                          </span>
                        ) : (
                          <span className="bg-success/10 text-success p-1.5 rounded-full">
                            <CheckCircle2 size={14} />
                          </span>
                        )}
                        <ChevronDown
                          size={16}
                          className={cn(
                            "text-content-muted transition-transform",
                            isExpanded && "rotate-180",
                          )}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between bg-surface-muted/50 p-3 rounded-2xl">
                      <div className="flex gap-4">
                        <div className="flex flex-col gap-0.5">
                          <span className="text-[10px] font-black text-content-muted uppercase tracking-widest">
                            {t("inventory.total_stock")}
                          </span>
                          <p className="font-black text-content">
                            {totalStock} {t(`inventory.unit_${item.unit}`)}
                          </p>
                        </div>
                        <div className="flex flex-col gap-0.5 border-l border-border/50 pl-4 rtl:pr-4 rtl:border-l-0 rtl:border-r">
                          <span className="text-[10px] font-black text-content-muted uppercase tracking-widest">
                            {t("inventory.price_per_unit")}
                          </span>
                          <p className="font-black text-content">
                            {item.pricePerUnit}{" "}
                            <span className="text-[10px]">SAR</span>
                          </p>
                        </div>
                        <div className="flex flex-col gap-0.5 border-l border-border/50 pl-4 rtl:pr-4 rtl:border-l-0 rtl:border-r">
                          <span className="text-[10px] font-black text-content-muted uppercase tracking-widest">
                            الظهور في POS
                          </span>
                          <span className={cn(
                            "text-xs font-black",
                            item.showInPos ? "text-success" : "text-content-muted"
                          )}>
                            {item.showInPos ? "ظاهر" : "مخفي"}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditingItem(item);
                            setShowEditModal(true);
                          }}
                          className="p-3 bg-brand/10 text-brand rounded-xl active:scale-95 transition-all"
                        >
                          <Edit2 size={20} />
                        </button>
                        <Menu
                          as="div"
                          className="relative inline-block text-left"
                        >
                          <Menu.Button
                            onClick={(e) => e.stopPropagation()}
                            className="p-3 bg-surface border border-border rounded-xl text-content-muted active:scale-95 transition-all outline-none"
                          >
                            <MoreVertical size={20} />
                          </Menu.Button>
                          <Transition
                            as={Fragment}
                            enter="transition ease-out duration-100"
                            enterFrom="transform opacity-0 scale-95"
                            enterTo="transform opacity-100 scale-100"
                            leave="transition ease-in duration-75"
                            leaveFrom="transform opacity-100 scale-100"
                            leaveTo="transform opacity-0 scale-95"
                          >
                            <Menu.Items
                              anchor="bottom end"
                              className="z-[9999] w-48 mt-2 origin-top-right bg-white rounded-2xl shadow-xl ring-1 ring-black ring-opacity-5 focus:outline-none overflow-hidden"
                            >
                              <div className="p-2">
                                {hasPermission("inventory.delete") && (
                                  <Menu.Item>
                                    {({ active }) => (
                                      <button
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleDeleteItem(item.id);
                                        }}
                                        className={cn(
                                          active
                                            ? "bg-danger/10 text-danger"
                                            : "text-danger",
                                          "flex w-full items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold",
                                        )}
                                      >
                                        <Trash2 size={16} />
                                        {t("common.delete")}
                                      </button>
                                    )}
                                  </Menu.Item>
                                )}
                              </div>
                            </Menu.Items>
                          </Transition>
                        </Menu>
                      </div>
                    </div>

                    {/* Mobile Expanded View */}
                    <AnimatePresence>
                      {isExpanded && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          className="overflow-hidden bg-brand/5 -mx-4 px-4 py-4 space-y-4"
                        >
                          {item.category === "ready-made" &&
                            (item.collarType ||
                              item.cuffType ||
                              item.pocketType ||
                              item.chestStyle) && (
                              <div className="grid grid-cols-2 gap-2">
                                {item.collarType && (
                                  <div className="bg-white border border-border p-3 rounded-xl">
                                    <p className="text-[8px] font-black text-content-muted uppercase">
                                      {t("inventory.collar_type")}
                                    </p>
                                    <p className="text-xs font-black text-content">
                                      {item.collarType}
                                    </p>
                                  </div>
                                )}
                                {item.cuffType && (
                                  <div className="bg-white border border-border p-3 rounded-xl">
                                    <p className="text-[8px] font-black text-content-muted uppercase">
                                      {t("inventory.cuff_type")}
                                    </p>
                                    <p className="text-xs font-black text-content">
                                      {item.cuffType}
                                    </p>
                                  </div>
                                )}
                              </div>
                            )}

                          <div className="space-y-2">
                            <p className="text-[10px] font-black text-content-muted uppercase px-1">
                              {t("inventory.branch_distribution")}
                            </p>
                            <div className="grid grid-cols-1 gap-2">
                              {branches.map((branch) => {
                                const stock = getStockForBranch(
                                  item.id,
                                  branch.id,
                                );
                                return (
                                  <div
                                    key={branch.id}
                                    className="bg-white border border-border p-3 rounded-xl flex items-center justify-between"
                                  >
                                    <div className="flex items-center gap-2">
                                      <div
                                        className={cn(
                                          "p-1.5 rounded-lg",
                                          branch.type === "warehouse"
                                            ? "bg-brand/10 text-brand"
                                            : "bg-amber-500/10 text-amber-500",
                                        )}
                                      >
                                        {branch.type === "warehouse" ? (
                                          <Warehouse size={14} />
                                        ) : (
                                          <Store size={14} />
                                        )}
                                      </div>
                                      <span className="text-xs font-black text-content">
                                        {branch.name}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                      <span className="text-sm font-black text-content">
                                        {stock}
                                      </span>
                                      <button
                                        onClick={() => {
                                          setSelectedItemForAdjustment({
                                            item,
                                            branch,
                                          });
                                          setShowAdjustmentModal(true);
                                        }}
                                        className="p-1.5 bg-brand/5 text-brand rounded-lg"
                                      >
                                        <Edit2 size={12} />
                                      </button>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>

            {/* Desktop View: Table */}
            <div className="hidden md:block overflow-x-auto whitespace-nowrap">
              <table className="w-full text-left border-collapse min-w-max">
                <thead>
                  <tr className="bg-surface-muted/50">
                    <th className="px-4 py-6 w-12 text-center">
                      <input
                        type="checkbox"
                        checked={filteredItems.length > 0 && selectedItemIds.length === filteredItems.length}
                        onChange={(e) => {
                          if (e.target.checked) {
                            setSelectedItemIds(filteredItems.map(item => item.id));
                          } else {
                            setSelectedItemIds([]);
                          }
                        }}
                        className="rounded border-border text-brand focus:ring-brand w-5 h-5 cursor-pointer"
                      />
                    </th>
                    <th className="px-8 py-6 text-xs font-black text-content-muted uppercase tracking-widest">
                      {t("inventory.item_name")}
                    </th>
                    <th className="px-8 py-6 text-xs font-black text-content-muted uppercase tracking-widest">
                      {t("inventory.category")}
                    </th>
                    <th className="px-8 py-6 text-xs font-black text-content-muted uppercase tracking-widest">
                      {t("inventory.total_stock")}
                    </th>
                    <th className="px-8 py-6 text-xs font-black text-content-muted uppercase tracking-widest">
                      {t("inventory.price_per_unit")}
                    </th>
                    <th className="px-8 py-6 text-xs font-black text-content-muted uppercase tracking-widest">
                      الظهور في POS
                    </th>
                    <th className="px-8 py-6 text-xs font-black text-content-muted uppercase tracking-widest">
                      {t("inventory.status")}
                    </th>
                    <th className="px-8 py-6 text-xs font-black text-content-muted uppercase tracking-widest text-right">
                      {t("common.actions")}
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {filteredItems.map((item) => {
                    const totalStock = getTotalStock(item.id);
                    const isLow = totalStock <= item.minThreshold;
                    const isExpanded = expandedItem === item.id;

                    return (
                      <React.Fragment key={item.id}>
                        <tr
                          className={cn(
                            "hover:bg-surface-muted/50 transition-colors group cursor-pointer",
                            isExpanded && "bg-brand/5",
                          )}
                          onClick={() =>
                            setExpandedItem(isExpanded ? null : item.id)
                          }
                        >
                          <td className="px-4 py-6 text-center w-12" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selectedItemIds.includes(item.id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setSelectedItemIds([...selectedItemIds, item.id]);
                                } else {
                                  setSelectedItemIds(selectedItemIds.filter(id => id !== item.id));
                                }
                              }}
                              className="rounded border-border text-brand focus:ring-brand w-5 h-5 cursor-pointer"
                            />
                          </td>
                          <td className="px-8 py-6">
                            <div className="flex items-center gap-4">
                              <div className="p-1 bg-surface border border-border rounded-xl shadow-sm group-hover:scale-110 transition-transform w-12 h-12 flex items-center justify-center shrink-0">
                                {item.mainImage ? (
                                  <img
                                    src={item.mainImage}
                                    alt={item.name}
                                    className="w-full h-full object-cover rounded-lg"
                                    referrerPolicy="no-referrer"
                                  />
                                ) : (
                                  <Package
                                    className="text-content-muted"
                                    size={24}
                                  />
                                )}
                              </div>
                              <div>
                                <p className="font-black text-content text-lg">
                                  {item.name}
                                </p>
                                <p className="text-xs font-bold text-content-muted uppercase tracking-tighter">
                                  SKU: {item.sku || "N/A"}
                                </p>
                              </div>
                            </div>
                          </td>
                          <td className="px-8 py-6">
                            <span className="px-4 py-1.5 bg-surface-muted text-content-muted rounded-full text-xs font-black uppercase tracking-widest">
                              {t(`inventory.category_${item.category}`)}
                            </span>
                          </td>
                          <td className="px-8 py-6">
                            <div className="flex items-center gap-2">
                              <p className="font-black text-content text-lg">
                                {totalStock}
                              </p>
                              <p className="text-xs font-bold text-content-muted uppercase">
                                {t(`inventory.unit_${item.unit}`)}
                              </p>
                            </div>
                          </td>
                          <td className="px-8 py-6">
                            <div className="font-black text-content text-lg">
                              {item.pricePerUnit}{" "}
                              <span className="text-xs text-content-muted">
                                SAR
                              </span>
                            </div>
                          </td>
                          <td className="px-8 py-6">
                            {item.showInPos ? (
                              <div className="flex items-center gap-1.5 text-success bg-success/10 px-3 py-1 rounded-full w-fit">
                                <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse"></span>
                                <span className="text-[10px] font-black">ظاهر</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 text-content-muted bg-neutral-100 dark:bg-neutral-800 px-3 py-1 rounded-full w-fit">
                                <span className="w-1.5 h-1.5 rounded-full bg-neutral-400"></span>
                                <span className="text-[10px] font-black">مخفي</span>
                              </div>
                            )}
                          </td>
                          <td className="px-8 py-6">
                            {isLow ? (
                              <div className="flex items-center gap-2 text-danger bg-danger/10 px-4 py-1.5 rounded-full w-fit">
                                <AlertTriangle size={14} />
                                <span className="text-xs font-black uppercase tracking-widest">
                                  {t("inventory.status_low")}
                                </span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 text-success bg-success/10 px-4 py-1.5 rounded-full w-fit">
                                <CheckCircle2 size={14} />
                                <span className="text-xs font-black uppercase tracking-widest">
                                  {t("inventory.status_good")}
                                </span>
                              </div>
                            )}
                          </td>
                          <td className="px-8 py-6 text-right flex items-center justify-end gap-2">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingItem(item);
                                setShowEditModal(true);
                              }}
                              className="p-2 hover:bg-brand/10 rounded-xl transition-all border border-transparent hover:border-brand/20 text-brand"
                              title={t("common.edit")}
                            >
                              <Edit2 size={20} />
                            </button>
                            <Menu
                              as="div"
                              className="relative inline-block text-left"
                            >
                              <Menu.Button
                                onClick={(e) => e.stopPropagation()}
                                className="p-2 hover:bg-surface rounded-xl transition-all border border-transparent hover:border-border hover:shadow-sm outline-none"
                              >
                                <MoreVertical
                                  size={20}
                                  className="text-content-muted"
                                />
                              </Menu.Button>
                              <Transition
                                as={Fragment}
                                enter="transition ease-out duration-100"
                                enterFrom="transform opacity-0 scale-95"
                                enterTo="transform opacity-100 scale-100"
                                leave="transition ease-in duration-75"
                                leaveFrom="transform opacity-100 scale-100"
                                leaveTo="transform opacity-0 scale-95"
                              >
                                <Menu.Items
                                  anchor="bottom end"
                                  className="z-[9999] w-48 mt-1 origin-top-right bg-white rounded-2xl shadow-xl ring-1 ring-black ring-opacity-5 focus:outline-none overflow-hidden"
                                >
                                  <div className="p-2">
                                    {hasPermission("inventory.delete") && (
                                      <Menu.Item>
                                        {({ active }) => (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleDeleteItem(item.id);
                                            }}
                                            className={cn(
                                              active
                                                ? "bg-danger/10 text-danger"
                                                : "text-danger",
                                              "flex w-full items-center gap-2 rounded-xl px-4 py-3 text-sm font-bold",
                                            )}
                                          >
                                            <Trash2 size={16} />
                                            {t("common.delete")}
                                          </button>
                                        )}
                                      </Menu.Item>
                                    )}
                                  </div>
                                </Menu.Items>
                              </Transition>
                            </Menu>
                          </td>
                        </tr>

                        {/* Expanded Branch View */}
                        <AnimatePresence>
                          {isExpanded && (
                            <tr>
                              <td colSpan={8} className="px-8 py-0">
                                <motion.div
                                  initial={{ height: 0, opacity: 0 }}
                                  animate={{ height: "auto", opacity: 1 }}
                                  exit={{ height: 0, opacity: 0 }}
                                  className="overflow-hidden"
                                >
                                  <div className="py-6 space-y-6">
                                    {/* Product Image and Main Specs */}
                                    <div className="flex flex-col md:flex-row gap-8">
                                      {item.mainImage && (
                                        <div className="w-full md:w-64 lg:w-80 shrink-0">
                                          <div className="aspect-square bg-surface border-2 border-border rounded-[2.5rem] overflow-hidden shadow-xl group relative">
                                            <img
                                              src={item.mainImage}
                                              alt={item.name}
                                              className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110"
                                              referrerPolicy="no-referrer"
                                            />
                                            <div className="absolute inset-0 bg-brand/10 opacity-0 group-hover:opacity-100 transition-opacity" />
                                          </div>
                                        </div>
                                      )}

                                      <div className="flex-1 space-y-8">
                                        {/* Style Details for Ready-made */}
                                        {item.category === "ready-made" &&
                                          (item.collarType ||
                                            item.cuffType ||
                                            item.pocketType ||
                                            item.chestStyle) && (
                                            <div className="bg-surface border border-border rounded-[2.5rem] p-8 shadow-sm">
                                              <div className="flex items-center gap-3 mb-6">
                                                <div className="p-2 bg-brand/10 text-brand rounded-xl">
                                                  <Shirt size={20} />
                                                </div>
                                                <h4 className="text-sm font-black text-content uppercase tracking-widest">
                                                  {t(
                                                    "inventory.ready_made_specs",
                                                  )}
                                                </h4>
                                              </div>
                                              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                                                {item.collarType && (
                                                  <div className="bg-surface-muted rounded-2xl p-4 flex flex-col gap-1 border border-border/50">
                                                    <p className="text-[10px] font-black text-content-muted uppercase tracking-widest">
                                                      {t(
                                                        "inventory.collar_type",
                                                      )}
                                                    </p>
                                                    <p className="text-sm font-black text-content">
                                                      {item.collarType}
                                                    </p>
                                                  </div>
                                                )}
                                                {item.cuffType && (
                                                  <div className="bg-surface-muted rounded-2xl p-4 flex flex-col gap-1 border border-border/50">
                                                    <p className="text-[10px] font-black text-content-muted uppercase tracking-widest">
                                                      {t("inventory.cuff_type")}
                                                    </p>
                                                    <p className="text-sm font-black text-content">
                                                      {item.cuffType}
                                                    </p>
                                                  </div>
                                                )}
                                                {item.pocketType && (
                                                  <div className="bg-surface-muted rounded-2xl p-4 flex flex-col gap-1 border border-border/50">
                                                    <p className="text-[10px] font-black text-content-muted uppercase tracking-widest">
                                                      {t(
                                                        "inventory.pocket_type",
                                                      )}
                                                    </p>
                                                    <p className="text-sm font-black text-content">
                                                      {item.pocketType}
                                                    </p>
                                                  </div>
                                                )}
                                                {item.chestStyle && (
                                                  <div className="bg-surface-muted rounded-2xl p-4 flex flex-col gap-1 border border-border/50">
                                                    <p className="text-[10px] font-black text-content-muted uppercase tracking-widest">
                                                      {t(
                                                        "inventory.chest_style",
                                                      )}
                                                    </p>
                                                    <p className="text-sm font-black text-content">
                                                      {item.chestStyle}
                                                    </p>
                                                  </div>
                                                )}
                                              </div>
                                            </div>
                                          )}

                                        {/* Branch Summary */}
                                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                          {branches.map((branch) => {
                                            const stock = getStockForBranch(
                                              item.id,
                                              branch.id,
                                            );
                                            return (
                                              <div
                                                key={branch.id}
                                                className="bg-surface border border-border p-5 rounded-3xl flex items-center justify-between shadow-sm"
                                              >
                                                <div className="flex items-center gap-3">
                                                  <div
                                                    className={cn(
                                                      "p-2.5 rounded-xl",
                                                      branch.type ===
                                                        "warehouse"
                                                        ? "bg-brand/10 text-brand"
                                                        : "bg-amber-500/10 text-amber-500",
                                                    )}
                                                  >
                                                    {branch.type ===
                                                    "warehouse" ? (
                                                      <Warehouse size={18} />
                                                    ) : (
                                                      <Store size={18} />
                                                    )}
                                                  </div>
                                                  <div>
                                                    <p className="font-black text-content text-sm">
                                                      {branch.name}
                                                    </p>
                                                    <p className="text-[10px] font-bold text-content-muted uppercase tracking-widest">
                                                      {t(
                                                        `inventory.type_${branch.type}`,
                                                      )}
                                                    </p>
                                                  </div>
                                                </div>
                                                <div className="text-right">
                                                  <p className="text-lg font-black text-content">
                                                    {stock}
                                                  </p>
                                                  <p className="text-[10px] font-bold text-content-muted uppercase">
                                                    {t(
                                                      `inventory.unit_${item.unit}`,
                                                    )}
                                                  </p>

                                                  <div className="flex items-center justify-end gap-2 mt-2">
                                                    {hasPermission(
                                                      "inventory.create",
                                                    ) && (
                                                      <button
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          setSelectedItemForAdjustment(
                                                            { item, branch },
                                                          );
                                                          setShowAdjustmentModal(
                                                            true,
                                                          );
                                                        }}
                                                        className="text-[9px] font-black text-emerald-600 hover:underline uppercase tracking-tighter"
                                                      >
                                                        {t(
                                                          "inventory.stock_in",
                                                        )}
                                                      </button>
                                                    )}
                                                    {hasPermission(
                                                      "inventory.reconcile",
                                                    ) && (
                                                      <button
                                                        onClick={(e) => {
                                                          e.stopPropagation();
                                                          setSelectedItemForAdjustment(
                                                            { item, branch },
                                                          );
                                                          setShowAdjustmentModal(
                                                            true,
                                                          );
                                                        }}
                                                        className="text-[9px] font-black text-brand hover:underline uppercase tracking-tighter"
                                                      >
                                                        {t("inventory.adjust")}
                                                      </button>
                                                    )}
                                                  </div>
                                                </div>
                                              </div>
                                            );
                                          })}
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                </motion.div>
                              </td>
                            </tr>
                          )}
                        </AnimatePresence>
                      </React.Fragment>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {activeTab === "transfers" && (
        <div className="bg-surface rounded-[2.5rem] border border-border shadow-sm overflow-hidden">
          <StockTransferWorkflow tenantId={tenantId} />
        </div>
      )}

      {activeTab === "reports" && (
        <InventoryReports
          tenantId={tenantId}
          items={items}
          branches={branches}
          branchStock={branchStock}
        />
      )}

      {/* Modals Placeholder */}
      <AnimatePresence>
        {showAddModal && (
          <AddItemModal
            onClose={() => setShowAddModal(false)}
            tenantId={tenantId}
            branches={branches}
          />
        )}
        {showEditModal && editingItem && (
          <EditItemModal
            onClose={() => {
              setShowEditModal(false);
              setEditingItem(null);
            }}
            tenantId={tenantId}
            item={editingItem}
          />
        )}
        {showOpeningBalanceModal && (
          <OpeningBalanceModal
            onClose={() => setShowOpeningBalanceModal(false)}
            tenantId={tenantId}
            branches={branches}
            items={items}
          />
        )}
        {showTransferModal && (
          <StockTransferModal
            onClose={() => setShowTransferModal(false)}
            tenantId={tenantId}
            branches={branches}
            items={items}
            branchStock={branchStock}
          />
        )}
        {showAdjustmentModal && selectedItemForAdjustment && (
          <StockAdjustmentModal
            onClose={() => {
              setShowAdjustmentModal(false);
              setSelectedItemForAdjustment(null);
            }}
            tenantId={tenantId}
            {...selectedItemForAdjustment}
          />
        )}
        {(deleteConfirmId || isBulkDeleteConfirm) && (
          <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-black/60 backdrop-blur-md"
              onClick={() => {
                setDeleteConfirmId(null);
                setIsBulkDeleteConfirm(false);
              }}
            />
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="bg-surface w-full max-w-md rounded-[2rem] shadow-2xl relative z-10 overflow-hidden border border-border p-8"
            >
              <div className="flex flex-col items-center text-center space-y-6">
                <div className="p-4 bg-danger/10 text-danger rounded-full shadow-lg shadow-danger/5">
                  <AlertTriangle size={32} />
                </div>
                <div className="space-y-2 col-span-1">
                  <h3 className="text-xl font-black text-content">
                    {isBulkDeleteConfirm ? "حذف الأصناف المحددة؟" : "تأكيد حذف الصنف؟"}
                  </h3>
                  <p className="text-sm font-bold text-content-muted leading-relaxed">
                    {isBulkDeleteConfirm
                      ? `هل أنت متأكد من رغبتك في حذف ${selectedItemIds.length} صنف من المخزون؟ هذا الإجراء غير قابل للتراجع وسيتم إزالة كافة السجلات المرتبطة بها.`
                      : "هل أنت متأكد من رغبتك في حذف هذا الصنف من المخزون؟ هذا الإجراء غير قابل للتراجع وسيتم إزالة كافة السجلات المرتبطة به."}
                  </p>
                </div>
                <div className="flex items-center gap-3 w-full">
                  <button
                    type="button"
                    onClick={() => {
                      setDeleteConfirmId(null);
                      setIsBulkDeleteConfirm(false);
                    }}
                    className="flex-1 py-3.5 bg-surface border-2 border-border text-content font-bold rounded-2xl hover:bg-surface-muted transition-all active:scale-[0.98]"
                  >
                    إلغاء
                  </button>
                  <button
                    type="button"
                    onClick={confirmDelete}
                    className="flex-1 py-3.5 bg-danger text-white font-black rounded-2xl hover:bg-danger/90 transition-all active:scale-[0.98] shadow-lg shadow-danger/10 flex items-center justify-center gap-2"
                  >
                    <Trash2 size={18} />
                    نعم، احذف
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Floating Bulk Action Bar */}
      <AnimatePresence>
        {selectedItemIds.length > 0 && (
          <motion.div
            initial={{ y: 100, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 100, opacity: 0 }}
            className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-surface border border-border shadow-2xl rounded-3xl p-4 flex flex-col md:flex-row items-center justify-between gap-4 z-[80] w-[90%] max-w-xl"
          >
            <div className="flex items-center gap-3">
              <div className="bg-brand/10 text-brand px-3 py-1.5 rounded-full text-sm font-black">
                {selectedItemIds.length} محدد
              </div>
              <p className="text-sm font-bold text-content-muted">
                عمليات جماعية للمنتجات المحددة
              </p>
            </div>
            <div className="flex items-center gap-2 w-full md:w-auto">
              <button
                type="button"
                onClick={() => {
                  setIsBulkDeleteConfirm(true);
                  setDeleteConfirmId(null);
                }}
                className="flex-1 md:flex-initial bg-danger hover:bg-danger/90 text-white font-black text-sm px-5 py-2.5 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-danger/20 transition-all active:scale-95"
              >
                <Trash2 size={16} />
                حذف محدد ({selectedItemIds.length})
              </button>
              <button
                type="button"
                onClick={() => setSelectedItemIds([])}
                className="bg-surface-muted text-content font-bold text-sm px-4 py-2.5 rounded-2xl transition-all"
              >
                إلغاء
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

const AddItemModal = ({ onClose, tenantId, branches }: any) => {
  const router = useRouter();
  const { t } = useTranslation();
  const { currentStaff } = useStaff();
  const { error: toastError, success: toastSuccess, handleError } = useToast();
  const [suppliersList, setSuppliersList] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    category: "fabric",
    unit: "meter",
    conversionRate: 1,
    minThreshold: 10,
    pricePerUnit: 0,
    costPrice: 0,
    description: "",
    sku: "",
    barcode: "",
    initialStock: 0,
    collarType: "",
    cuffType: "",
    pocketType: "",
    chestStyle: "",
    taxType: "exclusive" as "inclusive" | "exclusive" | "exempt",
    mainImage: "",
    showInPos: true,
    supplierId: "",
    openingBalance: 0,
  });

  useEffect(() => {
    const fetchSuppliers = async () => {
      const { data } = await supabase
        .from("suppliers")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .order("name", { ascending: true });
      if (data) {
        setSuppliersList(data);
      }
    };
    fetchSuppliers();
  }, [tenantId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const defaultQty = formData.initialStock || formData.openingBalance || 0;
      const sanitizedSku = formData.sku ? formData.sku.replace(/\D/g, '') : generateSKU();
      const itemData: any = {
        name: formData.name,
        category: formData.category,
        unit: formData.unit,
        conversion_rate: formData.conversionRate,
        min_threshold: formData.minThreshold,
        price_per_unit: formData.pricePerUnit,
        description: encodeInventoryDescription(formData.costPrice, formData.taxType, formData.description),
        sku: sanitizedSku,
        barcode: formData.barcode || Math.random().toString().substring(2, 12),
        quantity: defaultQty,
        images: formData.mainImage ? [{ url: formData.mainImage }] : [],
        collar_type:
          formData.category === "ready-made" ? formData.collarType : undefined,
        cuff_type:
          formData.category === "ready-made" ? formData.cuffType : undefined,
        pocket_type:
          formData.category === "ready-made" ? formData.pocketType : undefined,
        chest_style:
          formData.category === "ready-made" ? formData.chestStyle : undefined,
        show_in_pos: formData.showInPos,
        supplier_id: formData.supplierId || null,
        opening_balance: formData.openingBalance || formData.initialStock || 0,
        tenant_id: tenantId,
        updated_at: new Date().toISOString(),
      };

      const { data: item, error: itemError } = await supabase
        .from("inventory_items")
        .insert(itemData)
        .select()
        .single();
      if (itemError) throw itemError;

      const mainBranch = branches.find((b: any) => b.is_main) || branches[0];
      const branchInventoryInserts = branches.map((branch: Branch) => {
        const initialQty =
          branch.id === mainBranch?.id ? defaultQty : 0;
        return {
          branch_id: branch.id,
          item_id: item.id,
          quantity: initialQty,
          tenant_id: tenantId,
          updated_at: new Date().toISOString(),
        };
      });

      const { error: branchError } = await supabase
        .from("branch_inventory")
        .insert(branchInventoryInserts);
      if (branchError) throw branchError;

      // Log initial stock addition if any
      if (defaultQty > 0 && mainBranch) {
        await supabase.from("stock_ledger").insert({
          item_id: item.id,
          branch_id: mainBranch.id,
          type: "addition",
          previous_quantity: 0,
          new_quantity: defaultQty,
          change: defaultQty,
          staff_id: currentStaff?.id || "",
          staff_name: currentStaff?.name || "Staff",
          tenant_id: tenantId,
          created_at: new Date().toISOString(),
        });
      }

      onClose();
      router.refresh();
      toastSuccess("تم إضافة الصنف للمخزون بنجاح");
    } catch (error) {
      setSubmitting(false);
      handleError(error as any, "فشل في إضافة الصنف");
    }
  };

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
        className="bg-surface w-full max-w-3xl rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-8 border-b border-border flex justify-between items-center bg-surface-muted/50">
          <div className="flex items-center gap-4">
            <div className="p-4 bg-brand text-white rounded-2xl shadow-lg shadow-brand/10">
              <Plus size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-content">
                {t("inventory.add_item")}
              </h2>
              <p className="text-xs text-content-muted font-bold uppercase tracking-widest">
                {t("inventory.master_catalog")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-surface rounded-full transition-colors shadow-sm"
          >
            <X size={24} className="text-content-muted" />
          </button>
        </div>

        <form onSubmit={handleAdd} className="p-8 space-y-8 overflow-y-auto">
          {/* Image Uploader */}
          <div className="bg-surface-muted/50 p-6 rounded-[2rem] border border-border">
            <ProductImageUploader
              tenantId={tenantId}
              onUploadComplete={(url: string) =>
                setFormData({ ...formData, mainImage: url })
              }
              initialImageUrl={formData.mainImage}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1">
                {t("inventory.item_name")}
              </label>
              <input
                required
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                className="w-full px-5 py-3 bg-surface-muted border-none rounded-2xl focus:ring-2 focus:ring-brand font-bold text-content"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1">
                {t("inventory.category")}
              </label>
              <SmartSelect
                value={formData.category}
                onChange={(val) =>
                  setFormData({ ...formData, category: val as any })
                }
                options={[
                  { value: "fabric", label: t("inventory.category_fabric") },
                  {
                    value: "ready-made",
                    label: t("inventory.category_ready_made"),
                  },
                  { value: "thread", label: t("inventory.category_thread") },
                  { value: "button", label: t("inventory.category_button") },
                  { value: "lining", label: t("inventory.category_lining") },
                  { value: "accessories", label: "إكسسوارات" },
                  { value: "other", label: t("inventory.category_other") },
                ]}
                className="bg-surface-muted border-none"
              />
            </div>
            <div className="space-y-2 col-span-1 md:col-span-2">
              <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1 animate-pulse">
                الوصف | Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="تفاصيل ووصف إضافي للمنتج..."
                className="w-full px-5 py-3 bg-surface-muted border-none rounded-2xl focus:ring-2 focus:ring-[#1C8FFF] font-bold text-content resize-none h-16"
              />
            </div>
          </div>

          <AnimatePresence>
            {formData.category === "ready-made" && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="bg-brand/5 p-6 rounded-[2rem] border border-brand/10 space-y-6">
                  <div className="flex items-center gap-2 mb-2">
                    <Shirt className="text-brand" size={18} />
                    <h3 className="text-sm font-black text-content uppercase tracking-widest text-brand">
                      تخصيصات الثوب الجاهز
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-content-muted uppercase tracking-widest ml-1">
                        نوع الياقة (Collar)
                      </label>
                      <SmartSelect
                        value={formData.collarType}
                        onChange={(val) =>
                          setFormData({ ...formData, collarType: val })
                        }
                        options={[
                          { value: "", label: "افتراضي" },
                          { value: "qatari", label: "قطري" },
                          { value: "kuwaiti", label: "كويتي" },
                          { value: "saudi", label: "سعودي" },
                          { value: "marini", label: "ماريني" },
                        ]}
                        className="bg-surface border-none"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-content-muted uppercase tracking-widest ml-1">
                        نوع الكبك (Cuff)
                      </label>
                      <SmartSelect
                        value={formData.cuffType}
                        onChange={(val) =>
                          setFormData({ ...formData, cuffType: val })
                        }
                        options={[
                          { value: "", label: "افتراضي" },
                          { value: "regular", label: "عادي" },
                          { value: "double", label: "مزدوج (للأزرار)" },
                          { value: "french", label: "فرنسي" },
                        ]}
                        className="bg-surface border-none"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-content-muted uppercase tracking-widest ml-1">
                        نوع الجيب (Pocket)
                      </label>
                      <SmartSelect
                        value={formData.pocketType}
                        onChange={(val) =>
                          setFormData({ ...formData, pocketType: val })
                        }
                        options={[
                          { value: "", label: "افتراضي" },
                          { value: "hidden", label: "مخفي" },
                          { value: "visible", label: "ظاهري" },
                          { value: "none", label: "بدون جيب" },
                        ]}
                        className="bg-surface border-none"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-content-muted uppercase tracking-widest ml-1">
                        شكل الصدر (Chest)
                      </label>
                      <SmartSelect
                        value={formData.chestStyle}
                        onChange={(val) =>
                          setFormData({ ...formData, chestStyle: val })
                        }
                        options={[
                          { value: "", label: "افتراضي" },
                          { value: "plain", label: "سادة" },
                          { value: "pleated", label: "بكسرات" },
                          { value: "embroided", label: "مطرز" },
                        ]}
                        className="bg-surface border-none"
                      />
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1">
                {t("inventory.unit")}
              </label>
              <SmartSelect
                value={formData.unit}
                onChange={(val) =>
                  setFormData({ ...formData, unit: val as any })
                }
                options={[
                  { value: "meter", label: t("inventory.unit_meter") },
                  { value: "yard", label: t("inventory.unit_yard") },
                  { value: "roll", label: t("inventory.unit_roll") },
                  { value: "bolt", label: "طاقة (Bolt)" },
                  { value: "piece", label: t("inventory.unit_piece") },
                  { value: "box", label: "صندوق (Box)" },
                ]}
                className="bg-surface-muted border-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1">
                معامل التحويل (Conversion Rate)
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={formData.conversionRate}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    conversionRate: Number(e.target.value),
                  })
                }
                className="w-full px-5 py-3 bg-surface-muted border-none rounded-2xl focus:ring-2 focus:ring-brand font-bold text-content"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1">
                {t("inventory.min_threshold")}
              </label>
              <input
                type="number"
                required
                value={formData.minThreshold}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    minThreshold: Number(e.target.value),
                  })
                }
                className="w-full px-5 py-3 bg-surface-muted border-none rounded-2xl focus:ring-2 focus:ring-brand font-bold text-content"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 p-6 bg-surface-muted rounded-[2rem] border border-border">
            <div className="space-y-2 col-span-1">
              <label className="text-xs font-black text-[#6B7280] uppercase tracking-widest ml-1">
                سعر الشراء (التكلفة) | Cost Price
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={formData.costPrice}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    costPrice: Number(e.target.value),
                  })
                }
                placeholder="0.00"
                className="w-full px-5 py-3 bg-surface border-none rounded-2xl focus:ring-2 focus:ring-[#1C8FFF] font-bold text-content"
              />
            </div>

            <div className="space-y-2 col-span-1">
              <label className="text-xs font-black text-[#6B7280] uppercase tracking-widest ml-1">
                سعر البيع | Selling Price
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={formData.pricePerUnit}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    pricePerUnit: Number(e.target.value),
                  })
                }
                placeholder="0.00"
                className="w-full px-5 py-3 bg-surface border-none rounded-2xl focus:ring-2 focus:ring-[#1C8FFF] font-bold text-content"
              />
            </div>

            <div className="space-y-2 col-span-1 md:col-span-2">
              <label className="text-xs font-black text-[#6B7280] uppercase tracking-widest ml-1">
                الحالة الضريبية للمنتج | VAT Status
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  {
                    id: "inclusive",
                    label: "شامل الضريبة",
                    desc: "VAT Inclusive (15%)",
                  },
                  {
                    id: "exclusive",
                    label: "غير شامل",
                    desc: "VAT Exclusive (+15%)",
                  },
                  { id: "exempt", label: "معفى من الضريبة", desc: "VAT Exempt (0%)" },
                ].map((tax) => (
                  <button
                    key={tax.id}
                    type="button"
                    onClick={() =>
                      setFormData({ ...formData, taxType: tax.id as any })
                    }
                    className={cn(
                      "flex flex-col items-center justify-center p-2 rounded-xl border-2 transition-all text-center h-[52px]",
                      formData.taxType === tax.id
                        ? "bg-[#1C8FFF]/10 border-[#1C8FFF] text-[#1C8FFF]"
                        : "bg-surface border-transparent text-content-muted hover:bg-surface-muted",
                    )}
                  >
                    <span className="text-xs font-black leading-tight">{tax.label}</span>
                    <span className="text-[8px] font-bold opacity-70 leading-none">{tax.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-brand/5 p-6 rounded-2xl border border-brand/10">
            <div className="space-y-2">
              <label className="text-xs font-black text-content uppercase tracking-widest ml-1">
                المورد (Supplier)
              </label>
              <SmartSelect
                value={formData.supplierId}
                onChange={(val) => setFormData({ ...formData, supplierId: val })}
                options={[
                  { value: "", label: "اختر مورد..." },
                  ...suppliersList.map((s: any) => ({ value: s.id, label: s.name }))
                ]}
                className="bg-surface border-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-content uppercase tracking-widest ml-1">
                الرصيد الافتتاحي (Opening Balance)
              </label>
              <input
                type="number"
                placeholder="0.00"
                value={formData.openingBalance || ""}
                onChange={(e) => {
                  const val = Number(e.target.value);
                  setFormData({ ...formData, openingBalance: val, initialStock: val });
                }}
                className="w-full px-5 py-3 bg-surface border-none rounded-2xl focus:ring-2 focus:ring-brand font-bold text-content"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1">
                {t("inventory.sku")}
              </label>
              <input
                placeholder="رقمي فقط (توليد آلي إن تُرك فارغاً)"
                value={formData.sku}
                onChange={(e) =>
                  setFormData({ ...formData, sku: e.target.value.replace(/\D/g, "") })
                }
                className="w-full px-5 py-3 bg-surface-muted border-none rounded-2xl focus:ring-2 focus:ring-brand font-bold text-content"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1">
                {t("inventory.barcode")}
              </label>
              <input
                placeholder="Barcode (Auto)"
                value={formData.barcode}
                onChange={(e) =>
                  setFormData({ ...formData, barcode: e.target.value })
                }
                className="w-full px-5 py-3 bg-surface-muted border-none rounded-2xl focus:ring-2 focus:ring-brand font-bold text-content"
              />
            </div>
          </div>

          <div className="flex items-center justify-between p-4 bg-brand/5 rounded-2xl border border-brand/10">
            <div>
              <h4 className="text-sm font-black text-content">إظهار في شاشة البيع (POS)</h4>
              <p className="text-xs text-content-muted">إذا تم تفعيله، سيتمكن الكاشير من بيع هذا المنتج مباشرة من شاشة البيع</p>
            </div>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, showInPos: !formData.showInPos })}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2",
                formData.showInPos ? "bg-brand" : "bg-neutral-300 dark:bg-neutral-700"
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                  formData.showInPos ? "translate-x-5" : "translate-x-0"
                )}
              />
            </button>
          </div>

          <button
            type="submit"
            disabled={submitting}
            className={cn(
              "w-full text-brand-content py-4 rounded-2xl font-black text-lg shadow-xl transition-all mt-4 flex items-center justify-center gap-2",
              submitting ? "bg-brand/50 cursor-not-allowed shadow-none" : "bg-brand shadow-brand/10 hover:bg-brand/90 active:scale-[0.98]"
            )}
          >
            {submitting ? (
              <>
                <svg className="animate-spin h-5 w-5 text-current" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                <span>جاري الحفظ...</span>
              </>
            ) : (
              t("inventory.save_item")
            )}
          </button>
        </form>
      </motion.div>
    </div>
  );
};

const StockTransferModal = ({
  onClose,
  tenantId,
  branches,
  items,
  branchStock,
}: any) => {
  const router = useRouter();
  const { t } = useTranslation();
  const { error: toastError, success: toastSuccess, handleError } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    fromBranchId: "",
    toBranchId: "",
    items: [{ itemId: "", quantity: 0 }],
  });

  const handleCreateTransfer = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    try {
      const transferData: any = {
        from_branch_id: formData.fromBranchId,
        to_branch_id: formData.toBranchId,
        items: formData.items.map((i) => {
          const item = items.find((it: any) => it.id === i.itemId);
          return {
            itemId: i.itemId,
            itemName: item?.name || "",
            requestedQuantity: i.quantity,
          };
        }),
        status: "pending",
        requested_by: auth.currentUser?.uid || "",
        requested_by_name: auth.currentUser?.displayName || "Staff",
        tenant_id: tenantId,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      await supabase.from("stock_transfers").insert(transferData);
      toastSuccess(t("inventory.transfer_created_success"));
      onClose();
      router.refresh();
    } catch (error) {
      handleError(error as any, t("inventory.transfer_create_failed"));
    } finally {
      setSubmitting(false);
    }
  };

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
        className="bg-surface w-full max-w-2xl rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden flex flex-col"
      >
        <div className="p-8 border-b border-border flex justify-between items-center bg-surface-muted/50">
          <div className="flex items-center gap-4">
            <div className="p-4 bg-brand text-brand-content rounded-2xl shadow-lg shadow-brand/10">
              <ArrowRightLeft size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-content">
                {t("inventory.transfer_stock")}
              </h2>
              <p className="text-xs text-content-muted font-bold uppercase tracking-widest">
                {t("inventory.transfer_workflow")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-surface rounded-full transition-colors shadow-sm"
          >
            <X size={24} className="text-content-muted" />
          </button>
        </div>

        <form onSubmit={handleCreateTransfer} className="p-8 space-y-6">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1">
                {t("inventory.from_location")}
              </label>
              <SmartSelect
                disabled={submitting}
                value={formData.fromBranchId}
                onChange={(val) =>
                  setFormData({ ...formData, fromBranchId: val })
                }
                options={[
                  { value: "", label: t("common.select") },
                  ...branches.map((b: Branch) => ({
                    value: b.id,
                    label: `${b.name} (${t(`inventory.type_${b.type}`)})`,
                  })),
                ]}
                className="bg-surface-muted border-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1">
                {t("inventory.to_location")}
              </label>
              <SmartSelect
                disabled={submitting}
                value={formData.toBranchId}
                onChange={(val) =>
                  setFormData({ ...formData, toBranchId: val })
                }
                options={[
                  { value: "", label: t("common.select") },
                  ...branches.map((b: Branch) => ({
                    value: b.id,
                    label: `${b.name} (${t(`inventory.type_${b.type}`)})`,
                  })),
                ]}
                className="bg-surface-muted border-none"
              />
            </div>
          </div>

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-black text-content uppercase tracking-widest">
                {t("inventory.transfer_items")}
              </h3>
              <button
                type="button"
                onClick={() =>
                  setFormData({
                    ...formData,
                    items: [...formData.items, { itemId: "", quantity: 0 }],
                  })
                }
                className="text-xs font-black text-brand hover:text-brand/80 uppercase tracking-widest"
              >
                + {t("inventory.add_item")}
              </button>
            </div>

            {formData.items.map((item, idx) => (
              <div
                key={idx}
                className="p-4 bg-surface-muted rounded-2xl grid grid-cols-12 gap-4 items-end"
              >
                <div className="col-span-9 space-y-1">
                  <label className="text-[10px] font-black text-content-muted uppercase tracking-widest">
                    {t("inventory.item")}
                  </label>
                  <SmartSelect
                    disabled={submitting}
                    value={item.itemId}
                    onChange={(val) => {
                      const newItems = [...formData.items];
                      newItems[idx].itemId = val;
                      setFormData({ ...formData, items: newItems });
                    }}
                    options={[
                      { value: "", label: t("common.select") },
                      ...items.map((it: InventoryItem) => ({
                        value: it.id,
                        label: it.name,
                      })),
                    ]}
                    className="bg-surface border-none"
                  />
                </div>
                <div className="col-span-2 space-y-1">
                  <label className="text-[10px] font-black text-content-muted uppercase tracking-widest">
                    {t("inventory.qty")}
                  </label>
                  <input
                    type="number"
                    required
                    value={item.quantity}
                    onChange={(e) => {
                      const newItems = [...formData.items];
                      newItems[idx].quantity = Number(e.target.value);
                      setFormData({ ...formData, items: newItems });
                    }}
                    disabled={submitting}
                    className="w-full px-3 py-2 bg-surface border-none rounded-xl focus:ring-2 focus:ring-brand font-bold text-sm text-content"
                  />
                </div>
                <div className="col-span-1 flex justify-center pb-2">
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() =>
                      setFormData({
                        ...formData,
                        items: formData.items.filter((_, i) => i !== idx),
                      })
                    }
                    className="text-danger hover:text-danger/80 disabled:opacity-50"
                  >
                    <X size={18} />
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            type="submit"
            disabled={submitting}
            className="w-full bg-brand text-brand-content py-4 rounded-2xl font-black text-lg shadow-xl shadow-brand/10 hover:bg-brand/90 transition-all mt-4 disabled:opacity-50"
          >
            {submitting
              ? t("common.saving") || "Saving..."
              : t("inventory.create_transfer_request")}
          </button>
        </form>
      </motion.div>
    </div>
  );
};

const StockAdjustmentModal = ({ onClose, tenantId, item, branch }: any) => {
  const router = useRouter();
  const { t } = useTranslation();
  const { currentStaff } = useStaff();
  const { error: toastError, success: toastSuccess, handleError } = useToast();
  const [newQuantity, setNewQuantity] = useState(0);
  const [addQuantity, setAddQuantity] = useState(0);
  const [mode, setMode] = useState<"set" | "add">("add");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // Fetch current quantity to pre-fill
    const fetchCurrent = async () => {
      const { data } = await supabase
        .from("branch_inventory")
        .select("quantity")
        .eq("branch_id", branch.id)
        .eq("item_id", item.id)
        .maybeSingle();

      if (data) {
        setNewQuantity(data.quantity);
      }
    };
    fetchCurrent();
  }, [branch.id, item.id]);

  const handleAdjust = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      // Get current quantity for ledger
      const { data: currentStock } = await supabase
        .from("branch_inventory")
        .select("quantity")
        .eq("branch_id", branch.id)
        .eq("item_id", item.id)
        .maybeSingle();

      const currentQty = currentStock?.quantity || 0;
      const finalQuantity =
        mode === "add" ? currentQty + addQuantity : newQuantity;

      // Update Stock (Insert or Update check)
      let upsertError;
      if (currentStock) {
        const { error } = await supabase
          .from("branch_inventory")
          .update({
            quantity: finalQuantity,
            updated_at: new Date().toISOString(),
          })
          .eq("branch_id", branch.id)
          .eq("item_id", item.id);
        upsertError = error;
      } else {
        const { error } = await supabase
          .from("branch_inventory")
          .insert({
            branch_id: branch.id,
            item_id: item.id,
            quantity: finalQuantity,
            tenant_id: tenantId,
            updated_at: new Date().toISOString(),
          });
        upsertError = error;
      }

      if (upsertError) throw upsertError;

      // Create Ledger Entry
      const ledgerEntry: any = {
        item_id: item.id,
        branch_id: branch.id,
        type: mode === "add" ? "addition" : "adjustment",
        previous_quantity: currentQty,
        new_quantity: finalQuantity,
        change: finalQuantity - currentQty,
        staff_id: currentStaff?.id || "",
        staff_name: currentStaff?.name || "Staff",
        tenant_id: tenantId,
        created_at: new Date().toISOString(),
      };

      const { error: ledgerError } = await supabase
        .from("stock_ledger")
        .insert(ledgerEntry);
      if (ledgerError) throw ledgerError;

      toastSuccess(t("inventory.adjustment_success"));
      onClose();
      router.refresh();
    } catch (error) {
      handleError(error as any, t("inventory.adjustment_failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
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
        className="bg-surface w-full max-w-md rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden"
      >
        <div className="p-6 border-b border-border flex justify-between items-center bg-surface-muted/50">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-amber-500 text-white rounded-xl">
              <History size={20} />
            </div>
            <div>
              <h2 className="text-lg font-black text-content">
                {t("inventory.adjust_stock")}
              </h2>
              <p className="text-[10px] text-content-muted font-bold uppercase tracking-widest">
                {branch.name} • {item.name}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-surface rounded-full transition-colors"
          >
            <X size={20} className="text-content-muted" />
          </button>
        </div>

        <form onSubmit={handleAdjust} className="p-6 space-y-6">
          <div className="flex p-1 bg-surface-muted rounded-2xl">
            <button
              type="button"
              onClick={() => setMode("add")}
              className={cn(
                "flex-1 py-2 rounded-xl text-xs font-black transition-all",
                mode === "add"
                  ? "bg-surface text-emerald-600 shadow-sm"
                  : "text-content-muted",
              )}
            >
              {t("inventory.add_stock")}
            </button>
            <button
              type="button"
              onClick={() => setMode("set")}
              className={cn(
                "flex-1 py-2 rounded-xl text-xs font-black transition-all",
                mode === "set"
                  ? "bg-surface text-brand shadow-sm"
                  : "text-content-muted",
              )}
            >
              {t("inventory.set_total")}
            </button>
          </div>

          {mode === "add" ? (
            <div className="space-y-2">
              <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1">
                {t("inventory.quantity_to_add")}
              </label>
              <input
                type="number"
                required
                autoFocus
                value={addQuantity}
                onChange={(e) => setAddQuantity(Number(e.target.value))}
                className="w-full px-4 py-3 bg-surface-muted border-none rounded-2xl focus:ring-2 focus:ring-emerald-500 font-black text-xl text-content"
              />
            </div>
          ) : (
            <div className="space-y-2">
              <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1">
                {t("inventory.new_total_stock")}
              </label>
              <input
                type="number"
                required
                autoFocus
                value={newQuantity}
                onChange={(e) => setNewQuantity(Number(e.target.value))}
                className="w-full px-4 py-3 bg-surface-muted border-none rounded-2xl focus:ring-2 focus:ring-brand font-black text-xl text-content"
              />
            </div>
          )}
          <div className="space-y-2">
            <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1">
              {t("inventory.adjustment_reason")}
            </label>
            <textarea
              required
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Damaged stock, Correction..."
              className="w-full px-4 py-3 bg-surface-muted border-none rounded-2xl focus:ring-2 focus:ring-brand font-bold text-sm text-content min-h-[100px]"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-brand text-brand-content py-4 rounded-2xl font-black text-lg shadow-xl shadow-brand/10 hover:bg-brand/90 transition-all disabled:opacity-50"
          >
            {loading ? t("common.saving") : t("common.save")}
          </button>
        </form>
      </motion.div>
    </div>
  );
};

const OpeningBalanceModal = ({ onClose, tenantId, branches, items }: any) => {
  const router = useRouter();
  const { t } = useTranslation();
  const { currentStaff } = useStaff();
  const { error: toastError, success: toastSuccess, handleError } = useToast();
  const [selectedBranch, setSelectedBranch] = useState("");
  const [stockEntries, setStockEntries] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const bstr = evt.target?.result;
      const wb = XLSX.read(bstr, { type: "binary" });
      const wsname = wb.SheetNames[0];
      const ws = wb.Sheets[wsname];
      const data = XLSX.utils.sheet_to_json(ws);

      // Map Excel data to stock entries
      // Expecting columns: SKU, Quantity
      const entries = data
        .map((row: any) => {
          const item = items.find((it: any) => it.sku === row.SKU);
          return {
            itemId: item?.id,
            sku: row.SKU,
            name: item?.name,
            quantity: Number(row.Quantity) || 0,
          };
        })
        .filter((e) => e.itemId);

      setStockEntries(entries);
    };
    reader.readAsBinaryString(file);
  };

  const handleSave = async () => {
    if (!selectedBranch) return;
    setLoading(true);
    try {
      // 1. Fetch existing entries for the active branch to decide inserts vs updates
      const { data: existingInventory, error: fetchErr } = await supabase
        .from("branch_inventory")
        .select("item_id, quantity")
        .eq("branch_id", selectedBranch);
      
      if (fetchErr) throw fetchErr;

      const existingMap = new Map((existingInventory || []).map(row => [row.item_id, row]));

      const inserts: any[] = [];
      const updates: any[] = [];

      for (const entry of stockEntries) {
        if (existingMap.has(entry.itemId)) {
          updates.push(entry);
        } else {
          inserts.push({
            branch_id: selectedBranch,
            item_id: entry.itemId,
            quantity: entry.quantity,
            tenant_id: tenantId,
            updated_at: new Date().toISOString(),
          });
        }
      }

      // 3. Perform insert and updates
      if (inserts.length > 0) {
        const { error: insertErr } = await supabase
          .from("branch_inventory")
          .insert(inserts);
        if (insertErr) throw insertErr;
      }

      for (const entry of updates) {
        const { error: updateErr } = await supabase
          .from("branch_inventory")
          .update({
            quantity: entry.quantity,
            updated_at: new Date().toISOString(),
          })
          .eq("branch_id", selectedBranch)
          .eq("item_id", entry.itemId);
        if (updateErr) throw updateErr;
      }

      const ledgerEntries = stockEntries.map((entry) => ({
        item_id: entry.itemId,
        branch_id: selectedBranch,
        type: "addition",
        previous_quantity: 0,
        new_quantity: entry.quantity,
        change: entry.quantity,
        staff_id: currentStaff?.id || "",
        staff_name: currentStaff?.name || "Staff",
        tenant_id: tenantId,
        created_at: new Date().toISOString(),
      }));

      const { error: ledgerError } = await supabase
        .from("stock_ledger")
        .insert(ledgerEntries);
      if (ledgerError) throw ledgerError;

      toastSuccess(t("inventory.opening_balance_success"));
      onClose();
      router.refresh();
    } catch (error) {
      handleError(error as any, t("inventory.opening_balance_failed"));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
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
        className="bg-surface w-full max-w-4xl rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-8 border-b border-border flex justify-between items-center bg-surface-muted/50">
          <div className="flex items-center gap-4">
            <div className="p-4 bg-emerald-500 text-white rounded-2xl shadow-lg shadow-emerald-500/10">
              <Download size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-content">
                {t("inventory.opening_balance")}
              </h2>
              <p className="text-xs text-content-muted font-bold uppercase tracking-widest">
                {t("inventory.initial_stock_setup")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-surface rounded-full transition-colors"
          >
            <X size={24} className="text-content-muted" />
          </button>
        </div>

        <div className="p-8 space-y-8 overflow-y-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="space-y-2">
              <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1">
                {t("inventory.target_branch")}
              </label>
              <SmartSelect
                value={selectedBranch}
                onChange={(val) => setSelectedBranch(val)}
                options={[
                  { value: "", label: t("common.select") },
                  ...branches.map((b: any) => ({ value: b.id, label: b.name })),
                ]}
                className="bg-surface-muted border-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1">
                {t("inventory.import_excel")}
              </label>
              <div className="relative">
                <input
                  type="file"
                  accept=".xlsx, .xls"
                  onChange={handleFileUpload}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
                <div className="w-full px-5 py-3 bg-brand/5 border-2 border-dashed border-brand/20 rounded-2xl flex items-center justify-center gap-2 text-brand font-bold">
                  <Download size={20} />
                  {t("inventory.choose_file")}
                </div>
              </div>
            </div>
          </div>

          {stockEntries.length > 0 && (
            <div className="space-y-4">
              <h3 className="text-sm font-black text-content uppercase tracking-widest">
                {t("inventory.preview_entries")} ({stockEntries.length})
              </h3>
              <div className="border border-border rounded-3xl overflow-x-auto whitespace-nowrap">
                <table className="w-full text-left border-collapse min-w-max">
                  <thead className="bg-surface-muted">
                    <tr>
                      <th className="px-6 py-4 text-[10px] font-black text-content-muted uppercase tracking-widest">
                        {t("inventory.item")}
                      </th>
                      <th className="px-6 py-4 text-[10px] font-black text-content-muted uppercase tracking-widest">
                        {t("inventory.sku")}
                      </th>
                      <th className="px-6 py-4 text-[10px] font-black text-content-muted uppercase tracking-widest">
                        {t("inventory.qty")}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {stockEntries.slice(0, 10).map((entry, i) => (
                      <tr key={i}>
                        <td className="px-6 py-4 text-sm font-bold text-content">
                          {entry.name}
                        </td>
                        <td className="px-6 py-4 text-xs font-mono text-content-muted">
                          {entry.sku}
                        </td>
                        <td className="px-6 py-4 text-sm font-black text-content">
                          {entry.quantity}
                        </td>
                      </tr>
                    ))}
                    {stockEntries.length > 10 && (
                      <tr>
                        <td
                          colSpan={3}
                          className="px-6 py-4 text-center text-xs font-bold text-content-muted"
                        >
                          + {stockEntries.length - 10} {t("common.more_items")}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <button
            onClick={handleSave}
            disabled={loading || !selectedBranch || stockEntries.length === 0}
            className="w-full bg-emerald-500 text-white py-4 rounded-2xl font-black text-lg shadow-xl shadow-emerald-500/10 hover:bg-emerald-600 transition-all disabled:opacity-50"
          >
            {loading
              ? t("common.saving")
              : t("inventory.confirm_opening_balance")}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

const InventoryReports = ({ tenantId, items, branches, branchStock }: any) => {
  const { t } = useTranslation();

  const categoryData = [
    {
      name: t("inventory.category_fabric"),
      value: items.filter((i: any) => i.category === "fabric").length,
    },
    {
      name: t("inventory.category_thread"),
      value: items.filter((i: any) => i.category === "thread").length,
    },
    {
      name: t("inventory.category_button"),
      value: items.filter((i: any) => i.category === "button").length,
    },
    {
      name: t("inventory.category_lining"),
      value: items.filter((i: any) => i.category === "lining").length,
    },
    {
      name: t("inventory.category_ready_made"),
      value: items.filter((i: any) => i.category === "ready-made").length,
    },
  ];

  const stockByBranch = branches.map((b: any) => ({
    name: b.name,
    stock: Object.values(branchStock)
      .flat()
      .filter((s: any) => s.branchId === b.id)
      .reduce((sum: number, s: any) => sum + s.quantity, 0),
  }));

  const COLORS = ["#1C8FFF", "#22C55E", "#F59E0B", "#EF4444", "#8B5CF6"];

  return (
    <div className="space-y-8">
      {/* Stock Movement Trend */}
      <div className="bg-surface p-8 rounded-[2.5rem] border border-border shadow-sm">
        <h3 className="text-xl font-black text-content mb-8 flex items-center gap-3">
          <TrendingUp className="text-brand" />
          حركة المخزون (آخر 30 يوم)
        </h3>
        <div className="h-[300px]">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={[
                { date: "2024-01-01", change: 10 },
                { date: "2024-01-02", change: -5 },
                { date: "2024-01-03", change: 15 },
                { date: "2024-01-04", change: -2 },
                { date: "2024-01-05", change: 8 },
              ]}
            >
              <CartesianGrid
                strokeDasharray="3 3"
                vertical={false}
                stroke="#E5E7EB"
              />
              <XAxis
                dataKey="date"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fontWeight: 700 }}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 10, fontWeight: 700 }}
              />
              <Tooltip
                contentStyle={{
                  borderRadius: "1rem",
                  border: "none",
                  boxShadow: "0 10px 15px -3px rgb(0 0 0 / 0.1)",
                }}
              />
              <Line
                type="monotone"
                dataKey="change"
                stroke="#1C8FFF"
                strokeWidth={4}
                dot={{ r: 6, fill: "#1C8FFF" }}
                activeDot={{ r: 8 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Stock by Category */}
        <div className="bg-surface p-8 rounded-[2.5rem] border border-border shadow-sm">
          <h3 className="text-xl font-black text-content mb-8 flex items-center gap-3">
            <Tag className="text-brand" />
            {t("inventory.stock_by_category")}
          </h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={categoryData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {categoryData.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={COLORS[index % COLORS.length]}
                    />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <div className="grid grid-cols-2 gap-4 mt-4">
            {categoryData.map((entry, index) => (
              <div key={entry.name} className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: COLORS[index % COLORS.length] }}
                />
                <span className="text-xs font-bold text-content-muted">
                  {entry.name}: {entry.value}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Stock by Branch */}
        <div className="bg-surface p-8 rounded-[2.5rem] border border-border shadow-sm">
          <h3 className="text-xl font-black text-content mb-8 flex items-center gap-3">
            <Warehouse className="text-brand" />
            {t("inventory.stock_by_location")}
          </h3>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stockByBranch}>
                <CartesianGrid
                  strokeDasharray="3 3"
                  vertical={false}
                  stroke="#E5E7EB"
                />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fontWeight: 700 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fontSize: 12, fontWeight: 700 }}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: "1rem",
                    border: "none",
                    boxShadow: "0 10px 15px -3px rgba(0,0,0,0.1)",
                  }}
                  cursor={{ fill: "rgba(28, 143, 255, 0.05)" }}
                />
                <Bar
                  dataKey="stock"
                  fill="#1C8FFF"
                  radius={[8, 8, 0, 0]}
                  barSize={40}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Audit Trail Placeholder */}
      <div className="bg-surface p-8 rounded-[2.5rem] border border-border shadow-sm">
        <div className="flex items-center justify-between mb-8">
          <h3 className="text-xl font-black text-content flex items-center gap-3">
            <History className="text-brand" />
            {t("inventory.audit_trail")}
          </h3>
          <button className="text-xs font-black text-brand hover:underline uppercase tracking-widest">
            {t("common.view_all")}
          </button>
        </div>
        <div className="space-y-4">
          <p className="text-content-muted font-medium text-center py-12 bg-surface-muted rounded-3xl border-2 border-dashed border-border">
            {t("inventory.audit_trail_coming_soon")}
          </p>
        </div>
      </div>
    </div>
  );
};

const EditItemModal = ({ onClose, tenantId, item }: any) => {
  const router = useRouter();
  const { t } = useTranslation();
  const { error: toastError, success: toastSuccess, handleError } = useToast();
  const [suppliersList, setSuppliersList] = useState<any[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [formData, setFormData] = useState({
    name: item.name || "",
    category: item.category || "fabric",
    unit: item.unit || "meter",
    conversionRate: item.conversion_rate || 1,
    minThreshold: item.min_threshold || 10,
    pricePerUnit: item.price_per_unit || 0,
    costPrice: item.costPrice || 0,
    description: item.productDescription || item.description || "",
    sku: item.sku || "",
    barcode: item.barcode || "",
    collarType: item.collar_type || "",
    cuffType: item.cuff_type || "",
    pocketType: item.pocket_type || "",
    chestStyle: item.chest_style || "",
    taxType: (item.taxType || "exclusive") as "inclusive" | "exclusive" | "exempt",
    mainImage:
      Array.isArray(item.images) && item.images.length > 0
        ? item.images[0]?.url || item.images[0] || ""
        : "",
    showInPos: item.show_in_pos !== false,
    supplierId: item.supplier_id || item.supplierId || "",
    openingBalance: item.opening_balance || item.openingBalance || 0,
  });

  useEffect(() => {
    const fetchSuppliers = async () => {
      const { data } = await supabase
        .from("suppliers")
        .select("id, name")
        .eq("tenant_id", tenantId)
        .order("name", { ascending: true });
      if (data) {
        setSuppliersList(data);
      }
    };
    fetchSuppliers();
  }, [tenantId]);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    try {
      const updateData: any = {
        name: formData.name,
        category: formData.category,
        unit: formData.unit,
        conversion_rate: formData.conversionRate,
        min_threshold: formData.minThreshold,
        price_per_unit: formData.pricePerUnit,
        description: encodeInventoryDescription(formData.costPrice, formData.taxType, formData.description),
        sku: formData.sku ? formData.sku.replace(/\D/g, '') : generateSKU(),
        barcode: formData.barcode,
        images: formData.mainImage ? [{ url: formData.mainImage }] : undefined,
        collar_type:
          formData.category === "ready-made" ? formData.collarType : null,
        cuff_type:
          formData.category === "ready-made" ? formData.cuffType : null,
        pocket_type:
          formData.category === "ready-made" ? formData.pocketType : null,
        chest_style:
          formData.category === "ready-made" ? formData.chestStyle : null,
        show_in_pos: formData.showInPos,
        supplier_id: formData.supplierId || null,
        opening_balance: formData.openingBalance || 0,
        updated_at: new Date().toISOString(),
      };

      const { error } = await supabase
        .from("inventory_items")
        .update(updateData)
        .eq("id", item.id);

      if (error) throw error;

      onClose();
      router.refresh();
      toastSuccess("تم تحديث الصنف بنجاح");
    } catch (error) {
      setSubmitting(false);
      handleError(error as any, "فشل في تحديث الصنف");
    }
  };

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
        className="bg-surface w-full max-w-3xl rounded-[2.5rem] shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh]"
      >
        <div className="p-8 border-b border-border flex justify-between items-center bg-surface-muted/50">
          <div className="flex items-center gap-4">
            <div className="p-4 bg-brand text-white rounded-2xl shadow-lg shadow-brand/10">
              <Plus size={24} />
            </div>
            <div>
              <h2 className="text-2xl font-black text-content">
                {t("common.edit")} : {item.name}
              </h2>
              <p className="text-xs text-content-muted font-bold uppercase tracking-widest">
                {t("inventory.master_catalog")}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-surface rounded-full transition-colors shadow-sm"
          >
            <X size={24} className="text-content-muted" />
          </button>
        </div>

        <form onSubmit={handleUpdate} className="p-8 space-y-8 overflow-y-auto">
          {/* Image Uploader */}
          <div className="bg-surface-muted/50 p-6 rounded-[2rem] border border-border">
            <ProductImageUploader
              tenantId={tenantId}
              onUploadComplete={(url: string) =>
                setFormData({ ...formData, mainImage: url })
              }
              initialImageUrl={formData.mainImage}
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1">
                {t("inventory.item_name")}
              </label>
              <input
                required
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                className="w-full px-5 py-3 bg-surface-muted border-none rounded-2xl focus:ring-2 focus:ring-brand font-bold text-content"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1">
                {t("inventory.category")}
              </label>
              <SmartSelect
                value={formData.category}
                onChange={(val) =>
                  setFormData({ ...formData, category: val as any })
                }
                options={[
                  { value: "fabric", label: t("inventory.category_fabric") },
                  {
                    value: "ready-made",
                    label: t("inventory.category_ready_made"),
                  },
                  { value: "thread", label: t("inventory.category_thread") },
                  { value: "button", label: t("inventory.category_button") },
                  { value: "lining", label: t("inventory.category_lining") },
                  { value: "accessories", label: "إكسسوارات" },
                  { value: "other", label: t("inventory.category_other") },
                ]}
                className="bg-surface-muted border-none"
              />
            </div>
            <div className="space-y-2 col-span-1 md:col-span-2">
              <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1 transition-all">
                الوصف | Description
              </label>
              <textarea
                value={formData.description}
                onChange={(e) =>
                  setFormData({ ...formData, description: e.target.value })
                }
                placeholder="تفاصيل ووصف إضافي للمنتج..."
                className="w-full px-5 py-3 bg-surface-muted border-none rounded-2xl focus:ring-2 focus:ring-[#1C8FFF] font-bold text-content resize-none h-16"
              />
            </div>
          </div>

          <AnimatePresence>
            {formData.category === "ready-made" && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="bg-brand/5 p-6 rounded-[2rem] border border-brand/10 space-y-6">
                  <div className="flex items-center gap-2 mb-2">
                    <Shirt className="text-brand" size={18} />
                    <h3 className="text-sm font-black text-content uppercase tracking-widest text-brand">
                      تخصيصات الثوب الجاهز
                    </h3>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-content-muted uppercase tracking-widest ml-1">
                        نوع الياقة (Collar)
                      </label>
                      <SmartSelect
                        value={formData.collarType}
                        onChange={(val) =>
                          setFormData({ ...formData, collarType: val })
                        }
                        options={[
                          { value: "", label: "افتراضي" },
                          { value: "qatari", label: "قطري" },
                          { value: "kuwaiti", label: "كويتي" },
                          { value: "saudi", label: "سعودي" },
                          { value: "marini", label: "ماريني" },
                        ]}
                        className="bg-surface border-none"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-content-muted uppercase tracking-widest ml-1">
                        نوع الكبك (Cuff)
                      </label>
                      <SmartSelect
                        value={formData.cuffType}
                        onChange={(val) =>
                          setFormData({ ...formData, cuffType: val })
                        }
                        options={[
                          { value: "", label: "افتراضي" },
                          { value: "regular", label: "عادي" },
                          { value: "double", label: "مزدوج (للأزرار)" },
                          { value: "french", label: "فرنسي" },
                        ]}
                        className="bg-surface border-none"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px) font-black text-content-muted uppercase tracking-widest ml-1">
                        نوع الجيب (Pocket)
                      </label>
                      <SmartSelect
                        value={formData.pocketType}
                        onChange={(val) =>
                          setFormData({ ...formData, pocketType: val })
                        }
                        options={[
                          { value: "", label: "افتراضي" },
                          { value: "hidden", label: "مخفي" },
                          { value: "visible", label: "ظاهري" },
                          { value: "none", label: "بدون جيب" },
                        ]}
                        className="bg-surface border-none"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-[10px] font-black text-content-muted uppercase tracking-widest ml-1">
                        شكل الصدر (Chest)
                      </label>
                      <SmartSelect
                        value={formData.chestStyle}
                        onChange={(val) =>
                          setFormData({ ...formData, chestStyle: val })
                        }
                        options={[
                          { value: "", label: "افتراضي" },
                          { value: "plain", label: "سادة" },
                          { value: "pleated", label: "بكسرات" },
                          { value: "embroided", label: "مطرز" },
                        ]}
                        className="bg-surface border-none"
                      />
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1">
                {t("inventory.unit")}
              </label>
              <SmartSelect
                value={formData.unit}
                onChange={(val) =>
                  setFormData({ ...formData, unit: val as any })
                }
                options={[
                  { value: "meter", label: t("inventory.unit_meter") },
                  { value: "yard", label: t("inventory.unit_yard") },
                  { value: "roll", label: t("inventory.unit_roll") },
                  { value: "bolt", label: "طاقة (Bolt)" },
                  { value: "piece", label: t("inventory.unit_piece") },
                  { value: "box", label: "صندوق (Box)" },
                ]}
                className="bg-surface-muted border-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1">
                معامل التحويل (Conversion Rate)
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={formData.conversionRate}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    conversionRate: Number(e.target.value),
                  })
                }
                className="w-full px-5 py-3 bg-surface-muted border-none rounded-2xl focus:ring-2 focus:ring-brand font-bold text-content"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1">
                {t("inventory.min_threshold")}
              </label>
              <input
                type="number"
                required
                value={formData.minThreshold}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    minThreshold: Number(e.target.value),
                  })
                }
                className="w-full px-5 py-3 bg-surface-muted border-none rounded-2xl focus:ring-2 focus:ring-brand font-bold text-content"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 p-6 bg-surface-muted rounded-[2rem] border border-border">
            <div className="space-y-2 col-span-1">
              <label className="text-xs font-black text-[#6B7280] uppercase tracking-widest ml-1">
                سعر الشراء (التكلفة) | Cost Price
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={formData.costPrice}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    costPrice: Number(e.target.value),
                  })
                }
                placeholder="0.00"
                className="w-full px-5 py-3 bg-surface border-none rounded-2xl focus:ring-2 focus:ring-[#1C8FFF] font-bold text-content"
              />
            </div>

            <div className="space-y-2 col-span-1">
              <label className="text-xs font-black text-[#6B7280] uppercase tracking-widest ml-1">
                سعر البيع | Selling Price
              </label>
              <input
                type="number"
                step="0.01"
                required
                value={formData.pricePerUnit}
                onChange={(e) =>
                  setFormData({
                    ...formData,
                    pricePerUnit: Number(e.target.value),
                  })
                }
                placeholder="0.00"
                className="w-full px-5 py-3 bg-surface border-none rounded-2xl focus:ring-2 focus:ring-[#1C8FFF] font-bold text-content"
              />
            </div>

            <div className="space-y-2 col-span-1 md:col-span-2">
              <label className="text-xs font-black text-[#6B7280] uppercase tracking-widest ml-1">
                الحالة الضريبية للمنتج | VAT Status
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  {
                    id: "inclusive",
                    label: "شامل الضريبة",
                    desc: "VAT Inclusive (15%)",
                  },
                  {
                    id: "exclusive",
                    label: "غير شامل",
                    desc: "VAT Exclusive (+15%)",
                  },
                  { id: "exempt", label: "معفى من الضريبة", desc: "VAT Exempt (0%)" },
                ].map((tax) => (
                  <button
                    key={tax.id}
                    type="button"
                    onClick={() =>
                      setFormData({ ...formData, taxType: tax.id as any })
                    }
                    className={cn(
                      "flex flex-col items-center justify-center p-2 rounded-xl border-2 transition-all text-center h-[52px]",
                      formData.taxType === tax.id
                        ? "bg-[#1C8FFF]/10 border-[#1C8FFF] text-[#1C8FFF]"
                        : "bg-surface border-transparent text-content-muted hover:bg-surface-muted",
                    )}
                  >
                    <span className="text-xs font-black leading-tight">{tax.label}</span>
                    <span className="text-[8px] font-bold opacity-70 leading-none">{tax.desc}</span>
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-brand/5 p-6 rounded-2xl border border-brand/10">
            <div className="space-y-2">
              <label className="text-xs font-black text-content uppercase tracking-widest ml-1">
                المورد (Supplier)
              </label>
              <SmartSelect
                value={formData.supplierId}
                onChange={(val) => setFormData({ ...formData, supplierId: val })}
                options={[
                  { value: "", label: "اختر مورد..." },
                  ...suppliersList.map((s: any) => ({ value: s.id, label: s.name }))
                ]}
                className="bg-surface border-none"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-content uppercase tracking-widest ml-1">
                الرصيد الافتتاحي (Opening Balance)
              </label>
              <input
                type="number"
                placeholder="0.00"
                value={formData.openingBalance || ""}
                onChange={(e) => setFormData({ ...formData, openingBalance: Number(e.target.value) })}
                className="w-full px-5 py-3 bg-surface border-none rounded-2xl focus:ring-2 focus:ring-brand font-bold text-content"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1">
                الرقم المرجعي (SKU)
              </label>
              <input
                placeholder="أرقام فقط (مثال: 82749301)"
                value={formData.sku}
                onChange={(e) =>
                  setFormData({ ...formData, sku: e.target.value.replace(/\D/g, "") })
                }
                className="w-full px-5 py-3 bg-surface-muted border-none rounded-2xl focus:ring-2 focus:ring-brand font-bold text-content"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs font-black text-content-muted uppercase tracking-widest ml-1">
                الباركود (Barcode)
              </label>
              <input
                value={formData.barcode}
                onChange={(e) =>
                  setFormData({ ...formData, barcode: e.target.value })
                }
                className="w-full px-5 py-3 bg-surface-muted border-none rounded-2xl focus:ring-2 focus:ring-brand font-bold text-content"
              />
            </div>
          </div>

          <div className="flex items-center justify-between p-4 bg-brand/5 rounded-2xl border border-brand/10">
            <div>
              <h4 className="text-sm font-black text-content">إظهار في شاشة البيع (POS)</h4>
              <p className="text-xs text-content-muted">إذا تم تفعيله، سيتمكن الكاشير من بيع هذا المنتج مباشرة من شاشة البيع</p>
            </div>
            <button
              type="button"
              onClick={() => setFormData({ ...formData, showInPos: !formData.showInPos })}
              className={cn(
                "relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-brand focus:ring-offset-2",
                formData.showInPos ? "bg-brand" : "bg-neutral-300 dark:bg-neutral-700"
              )}
            >
              <span
                className={cn(
                  "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out",
                  formData.showInPos ? "translate-x-5" : "translate-x-0"
                )}
              />
            </button>
          </div>

          <div className="flex justify-end gap-4 pt-6 border-t border-border">
            <button
              type="button"
              onClick={onClose}
              className="px-8 py-3 bg-surface text-content font-bold rounded-2xl border-2 border-border hover:bg-surface-muted transition-colors"
            >
              {t("common.cancel")}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className={cn(
                "px-12 py-3 text-white font-bold rounded-2xl shadow-lg transition-all active:scale-95 flex items-center gap-2",
                submitting ? "bg-brand/50 cursor-not-allowed shadow-none" : "bg-brand shadow-brand/20 hover:bg-brand/90"
              )}
            >
              {submitting ? (
                <>
                  <svg className="animate-spin h-5 w-5 text-current" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  <span>جاري الحفظ...</span>
                </>
              ) : (
                t("common.save_changes")
              )}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};

export default InventoryManager;
