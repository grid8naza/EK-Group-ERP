'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, PackageOpen, Upload, Image as ImageIcon, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { mediaUrl } from '@/lib/login-screen';
import { useFetch, useLookupValues } from '@/lib/hooks';
import { useToast } from '@/providers/ToastProvider';
import { useConfirm } from '@/providers/ConfirmProvider';
import { useAuth } from '@/providers/AuthProvider';
import { useLock } from '@/lib/useLock';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable, type Column } from '@/components/ui/DataTable';
import { LockButton } from '@/components/ui/LockButton';
import { StatusToggle } from '@/components/ui/StatusToggle';
import { Drawer, DrawerFooter, CloseFooter, type SaveMode } from '@/components/ui/Drawer';
import { ReadOnlyFieldset } from '@/components/ui/ReadOnlyFieldset';
import { Input, Select, Textarea, Checkbox } from '@/components/ui/Field';
import { Badge } from '@/components/ui/Badge';
import {
  DiscountMatrix,
  discountFormFrom,
  discountPayload,
  type DiscountForm,
} from '@/components/inventory/DiscountMatrix';
import { PRODUCT_SOURCE_LABEL, PRODUCT_SOURCE_OPTIONS } from '@/lib/types';
import type {
  Product,
  ProductSource,
  Category,
  CategoryKind,
  Group,
  Unit,
  HsnCode,
  Company,
  Branch,
  Store,
  Rack,
} from '@/lib/types';

const ROUTE = '/inventory/products-unpacked';

// The category KIND this screen owns. The listing, the group filters and the
// drawer are all scoped to categories of this kind, so a product's category —
// not its group — is what decides which screen lists it. That is what lets
// "Bakery" be one shared group serving both this screen and Products - Packed
// instead of being entered twice. Binding to the kind rather than to a named
// category means renaming a category never strands the screen.
const SCREEN_KIND: CategoryKind = 'SEMI_FINISHED';

// Per-branch stocking parameters, kept as strings while editing (like every
// other numeric field on this form). Keyed by branchId in the form state.
type BranchStockForm = {
  minStock: string;
  maxStock: string;
  reorderLevel: string;
  leadTimeDays: string;
  defaultStoreId: string;
  defaultRackId: string;
};
const EMPTY_BS: BranchStockForm = {
  minStock: '',
  maxStock: '',
  reorderLevel: '',
  leadTimeDays: '',
  defaultStoreId: '',
  defaultRackId: '',
};

const empty = {
  code: '',
  name: '',
  description: '',
  imageUrl: '',
  categoryId: '',
  groupId: '',
  unitId: '',
  // Unpacked screen: every product here is unpacked and never packed.
  unpacked: true,
  packed: false,
  canSell: true,
  costPrice: '0',
  wholesalePrice: '0',
  wholesaleProfitPct: '',
  intercompanyPrice: '0',
  intercompanyProfitPct: '',
  retailPrice: '0',
  retailProfitPct: '',
  boxQty: '0',
  boxUnitId: '',
  hsnCodeId: '',
  shelfLife: '0',
  // Max discount % per authority level, keyed by DISCOUNT_LEVEL LookupValue id.
  discounts: {} as DiscountForm,
  // In-house by default on this screen; switch to Purchased for resale stock.
  source: 'MANUFACTURED' as ProductSource,
  // Defaults for a new semi-finished product: made from a recipe, not packed.
  // Both are editable in the drawer.
  hasRecipe: true,
  hasPacking: false,
  isIngredient: false,
  allCompanies: true,
  companyIds: [] as number[],
  // Per-branch stock levels, keyed by branchId (built from the product's saved
  // rows; branches with no saved row start blank).
  branchStocks: {} as Record<number, BranchStockForm>,
  isActive: true,
};

// Profit % is a markup over cost: pct = (price - cost) / cost * 100, and the
// inverse price = cost * (1 + pct/100). Both are stored; the form keeps the
// matching price/% pair in sync as either side is edited.
const round2 = (v: number) => Math.round(v * 100) / 100;
const toN = (s: string) => Number(s) || 0;
const pctFromPrice = (price: number, cost: number) =>
  cost > 0 ? round2(((price - cost) / cost) * 100) : 0;
const priceFromPct = (pct: number, cost: number) =>
  cost > 0 ? round2(cost * (1 + pct / 100)) : 0;

// Percentage shown for a price: blank when the price is null/empty/0 (no sale
// price → no margin to show) or when the margin would be negative (below cost);
// otherwise the margin over cost. When cost is 0 the margin can't be derived,
// so the current value is kept.
const pctDisplay = (priceStr: string, cost: number, current = '') => {
  const price = toN(priceStr);
  if (priceStr === '' || price === 0) return '';
  if (cost <= 0) return current;
  const pct = pctFromPrice(price, cost);
  return pct < 0 ? '' : String(pct);
};

export default function ProductsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<Product[]>('/products');
  const { data: groups } = useFetch<Group[]>('/groups');
  const { data: categories } = useFetch<Category[]>('/categories');
  // Discount authority levels, maintained in Inventory > Lookups.
  const discountLevels = useLookupValues('DISCOUNT_LEVEL');
  const { data: units } = useFetch<Unit[]>('/units');
  const { data: hsnCodes } = useFetch<HsnCode[]>('/hsn-codes');
  const { data: companies } = useFetch<Company[]>('/companies');
  const { data: branches } = useFetch<Branch[]>('/branches');
  // All stores/racks across companies — the per-branch default location pickers
  // span every company the product is available in, so they can't be scoped to
  // the active branch.
  const { data: stores } = useFetch<Store[]>('/stores?all=true');
  const { data: racks } = useFetch<Rack[]>('/racks?all=true');
  const { canLock, canUnlock, toggleLock, guardEdit, guardDelete, bulkLock } = useLock<Product>({
    endpoint: '/products',
    route: ROUTE,
    noun: 'product',
    nameOf: (p) => p.name,
    reload: refetch,
  });

  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [view, setView] = useState(false);
  const [form, setForm] = useState({ ...empty });
  const [saving, setSaving] = useState(false);
  // Drawer group cascade: parent group → leaf group (the saved `groupId`). The
  // category is fixed to Products and the primary group to this screen's, so
  // neither is picked.
  const [drawerParent, setDrawerParent] = useState('');
  const imageInput = useRef<HTMLInputElement>(null);
  const [imageUploading, setImageUploading] = useState(false);

  const uploadImage = async (file: File) => {
    setImageUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    try {
      const res = await api.post<{ url: string }>('/products/image', fd);
      setForm((f) => ({ ...f, imageUrl: res.url }));
      toast.success('Picture uploaded.');
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Upload failed.');
    } finally {
      setImageUploading(false);
    }
  };
  const [parentFilter, setParentFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState(''); // '' | ProductSource
  const [sellFilter, setSellFilter] = useState(''); // '' | 'yes' | 'no'
  const [status, setStatus] = useState(''); // '' | 'active' | 'inactive'
  const codeRef = useRef<HTMLInputElement>(null);

  const canAdd = can(ROUTE, 'add');
  const canEdit = can(ROUTE, 'edit');
  const canDelete = can(ROUTE, 'delete');
  const canView = can(ROUTE, 'view');

  const companyList = companies ?? [];
  const unitList = units ?? [];

  // The categories this screen owns. Usually exactly one, in which case the
  // drawer shows it fixed rather than asking; more than one and it becomes a
  // pick, limited to this kind either way.
  const screenCategories = useMemo(
    () => (categories ?? []).filter((c) => c.kind === SCREEN_KIND),
    [categories],
  );
  const screenCategoryIds = useMemo(
    () => new Set(screenCategories.map((c) => c.id)),
    [screenCategories],
  );
  const soleCategory =
    screenCategories.length === 1 ? screenCategories[0] : undefined;

  // Groups usable here: those serving one of this screen's categories.
  const productGroups = useMemo(
    () =>
      (groups ?? []).filter((g) =>
        g.categoryIds.some((id) => screenCategoryIds.has(id)),
      ),
    [groups, screenCategoryIds],
  );

  // Group lookups for the primary/parent list filters (each product attaches to
  // a leaf group via r.groupId; resolve it to apply the same subtree/child
  // predicates as the Group Master).
  const groupById = useMemo(
    () => new Map((groups ?? []).map((g) => [g.id, g])),
    [groups],
  );
  const primaryGroups = useMemo(
    () => productGroups.filter((g) => g.level === 1),
    [productGroups],
  );
  const parentCandidates = useMemo(
    () => productGroups.filter((g) => g.subGroupApplicable && g.level < 5),
    [productGroups],
  );
  // The category the drawer is filing under: the sole one when there is only
  // one, otherwise whatever the user picked. It narrows the group cascade, so
  // only groups actually serving that category can be chosen.
  const drawerCategoryId = soleCategory
    ? soleCategory.id
    : form.categoryId
      ? Number(form.categoryId)
      : undefined;
  const inDrawerCategory = (g: Group) =>
    drawerCategoryId == null || g.categoryIds.includes(drawerCategoryId);

  // Drawer cascade: parent → leaf, both within the drawer's category. Parent
  // options include the primaries (Bakery, Pastry …), since those are now the
  // top of the shared tree rather than a fixed per-screen group.
  const drawerParentOptions = parentCandidates.filter(inDrawerCategory);
  // Products attach to LEAF groups only (no sub-groups), scoped by the chosen
  // parent (or, failing that, the drawer's category).
  const drawerLeafOptions = productGroups.filter((g) => {
    if (g.subGroupApplicable || !g.isActive) return false;
    if (drawerParent) return String(g.parentGroupId) === drawerParent;
    return inDrawerCategory(g);
  });
  // Resolve a leaf group's primary (level-1) + immediate parent names, for the
  // read-only classification shown when editing.
  const groupAncestry = (leafId: number | null | undefined) => {
    const leaf = leafId != null ? groupById.get(leafId) : undefined;
    if (!leaf) return { primary: '-', parent: '-', leaf: '-' };
    const parent = leaf.parentGroupId
      ? groupById.get(leaf.parentGroupId)
      : undefined;
    let node = leaf;
    while (node.level > 1 && node.parentGroupId) {
      const up = groupById.get(node.parentGroupId);
      if (!up) break;
      node = up;
    }
    return {
      primary: node.level === 1 ? node.name : '-',
      parent: parent?.name ?? '-',
      leaf: leaf.name,
    };
  };

  const editAncestry = editing ? groupAncestry(editing.groupId) : null;

  const closeDrawer = () => {
    setOpen(false);
    setView(false);
  };

  const formFrom = (p: Product) => ({
    code: p.code,
    name: p.name,
    description: p.description ?? '',
    imageUrl: p.imageUrl ?? '',
    categoryId: p.categoryId != null ? String(p.categoryId) : '',
    groupId: p.groupId != null ? String(p.groupId) : '',
    unitId: String(p.unitId),
    // Forced invariants for the Unpacked screen (see `empty`).
    unpacked: true,
    packed: false,
    canSell: p.canSell ?? true,
    costPrice: String(p.costPrice ?? 0),
    wholesalePrice: String(p.wholesalePrice ?? 0),
    wholesaleProfitPct: pctDisplay(
      String(p.wholesalePrice ?? 0),
      p.costPrice ?? 0,
    ),
    intercompanyPrice: String(p.intercompanyPrice ?? 0),
    intercompanyProfitPct: pctDisplay(
      String(p.intercompanyPrice ?? 0),
      p.costPrice ?? 0,
    ),
    retailPrice: String(p.retailPrice ?? 0),
    retailProfitPct: pctDisplay(String(p.retailPrice ?? 0), p.costPrice ?? 0),
    boxQty: String(p.boxQty ?? 0),
    boxUnitId: p.boxUnitId != null ? String(p.boxUnitId) : '',
    hsnCodeId: p.hsnCodeId != null ? String(p.hsnCodeId) : '',
    shelfLife: String(p.shelfLife ?? 0),
    // Editable in the drawer; `empty` holds this screen's default for new rows.
    discounts: discountFormFrom(p.discounts),
    source: (p.source ?? 'MANUFACTURED') as ProductSource,
    hasRecipe: p.hasRecipe ?? true,
    hasPacking: p.hasPacking ?? false,
    isIngredient: p.isIngredient ?? false,
    allCompanies: p.allCompanies,
    companyIds: p.companyIds ?? [],
    branchStocks: Object.fromEntries(
      (p.branchStocks ?? []).map((bs) => [
        bs.branchId,
        {
          minStock: bs.minStock ? String(bs.minStock) : '',
          maxStock: bs.maxStock ? String(bs.maxStock) : '',
          reorderLevel: bs.reorderLevel ? String(bs.reorderLevel) : '',
          leadTimeDays: bs.leadTimeDays ? String(bs.leadTimeDays) : '',
          defaultStoreId: bs.defaultStoreId ? String(bs.defaultStoreId) : '',
          defaultRackId: bs.defaultRackId ? String(bs.defaultRackId) : '',
        },
      ]),
    ) as Record<number, BranchStockForm>,
    isActive: p.isActive,
  });

  const openAdd = () => {
    setEditing(null);
    setView(false);
    setForm({ ...empty });
    setDrawerParent('');
    setOpen(true);
  };
  const openEdit = (p: Product) => {
    setEditing(p);
    setView(false);
    setForm(formFrom(p));
    setOpen(true);
  };
  const openView = (p: Product) => {
    setEditing(p);
    setView(true);
    setForm(formFrom(p));
    setOpen(true);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey && e.key.toLowerCase() === 'a' && canAdd && !open) {
        e.preventDefault();
        openAdd();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAdd, open]);

  const toggleCompany = (id: number) =>
    setForm((f) => ({
      ...f,
      companyIds: f.companyIds.includes(id)
        ? f.companyIds.filter((x) => x !== id)
        : [...f.companyIds, id],
    }));

  // Branches the product can be stocked at: every active branch of each company
  // the product is available in (all companies, or the chosen set), grouped by
  // company. New branches appear automatically because this reads the live
  // branch list rather than the product's saved rows.
  const availableCompanyIds = form.allCompanies
    ? companyList.map((c) => c.id)
    : form.companyIds;
  const branchGroups = companyList
    .filter((c) => availableCompanyIds.includes(c.id))
    .map((c) => ({
      company: c,
      branches: (branches ?? []).filter(
        (b) => b.companyId === c.id && b.isActive,
      ),
    }))
    .filter((g) => g.branches.length > 0);

  const setBranchStock = (
    branchId: number,
    field: keyof BranchStockForm,
    value: string,
  ) =>
    setForm((f) => ({
      ...f,
      branchStocks: {
        ...f.branchStocks,
        [branchId]: { ...(f.branchStocks[branchId] ?? EMPTY_BS), [field]: value },
      },
    }));

  // Setting a branch's default store clears any rack chosen from the old store.
  const setBranchStore = (branchId: number, storeId: string) =>
    setForm((f) => ({
      ...f,
      branchStocks: {
        ...f.branchStocks,
        [branchId]: {
          ...(f.branchStocks[branchId] ?? EMPTY_BS),
          defaultStoreId: storeId,
          defaultRackId: '',
        },
      },
    }));

  // Stores for a company+branch (branchless stores show for every branch); racks
  // within the chosen store. A currently-selected id is always kept as an option
  // so an inactive/hidden store or rack still displays instead of vanishing.
  const storeOptions = (companyId: number, branchId: number, current: string) =>
    (stores ?? [])
      .filter(
        (s) =>
          s.companyId === companyId &&
          (s.branchId === branchId || s.branchId == null) &&
          (s.isActive || String(s.id) === current),
      )
      .map((s) => ({ value: String(s.id), label: s.name }));
  const rackOptions = (storeId: string, current: string) =>
    !storeId
      ? []
      : (racks ?? [])
          .filter(
            (r) =>
              String(r.storeId) === storeId &&
              (r.isActive || String(r.id) === current),
          )
          .map((r) => ({ value: String(r.id), label: r.name }));

  const save = async (mode: SaveMode = 'saveClose') => {
    if (!form.name.trim()) {
      toast.error('Name is required.');
      return;
    }
    if (drawerCategoryId == null) {
      toast.error('Select a category.');
      return;
    }
    if (!form.groupId) {
      toast.error('Select a group — every product belongs to a leaf group.');
      return;
    }
    if (!form.unitId) {
      toast.error('Select a unit.');
      return;
    }
    if (!form.allCompanies && form.companyIds.length === 0) {
      toast.error('Select at least one company, or choose "All companies".');
      return;
    }

    const num = (s: string) => Number(s) || 0;
    const idOrNull = (s: string) => (s ? Number(s) : null);
    // One row per displayed branch (available companies only). Branches removed
    // from availability are dropped; the backend also drops all-zero rows.
    const branchStocks = branchGroups
      .flatMap((g) => g.branches)
      .map((b) => {
        const v = form.branchStocks[b.id] ?? EMPTY_BS;
        return {
          branchId: b.id,
          minStock: num(v.minStock),
          maxStock: num(v.maxStock),
          reorderLevel: num(v.reorderLevel),
          leadTimeDays: num(v.leadTimeDays),
          defaultStoreId: idOrNull(v.defaultStoreId),
          defaultRackId: idOrNull(v.defaultRackId),
        };
      });
    // Note: recipe/packing are intentionally omitted — the BOM is edited under
    // Production, and omitting them leaves the saved BOM untouched.
    const payload = {
      // The code is derived server-side from the category (CC) + group (levels).
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      // Picture is a sellable-product attribute; cleared when not sellable.
      imageUrl: form.canSell ? form.imageUrl || null : null,
      categoryId: drawerCategoryId,
      groupId: Number(form.groupId),
      unitId: Number(form.unitId),
      unpacked: form.unpacked,
      packed: form.packed,
      canSell: form.canSell,
      costPrice: num(form.costPrice),
      wholesalePrice: num(form.wholesalePrice),
      wholesaleProfitPct: num(form.wholesaleProfitPct),
      intercompanyPrice: num(form.intercompanyPrice),
      intercompanyProfitPct: num(form.intercompanyProfitPct),
      retailPrice: num(form.retailPrice),
      retailProfitPct: num(form.retailProfitPct),
      boxQty: num(form.boxQty),
      boxUnitId: idOrNull(form.boxUnitId),
      hsnCodeId: idOrNull(form.hsnCodeId),
      shelfLife: num(form.shelfLife),
      // Sent whole; the server drops the zeros and clears it when not sellable.
      discounts: discountPayload(discountLevels, form.discounts),
      source: form.source,
      hasRecipe: form.hasRecipe,
      hasPacking: form.hasPacking,
      isIngredient: form.isIngredient,
      allCompanies: form.allCompanies,
      companyIds: form.allCompanies ? [] : form.companyIds,
      // Branch stock levels are a sellable-product attribute; cleared when not
      // sellable. Only sent when the branch list has loaded, so a failed/empty
      // fetch can't silently wipe saved rows (backend leaves them intact when
      // omitted).
      ...(branches ? { branchStocks: form.canSell ? branchStocks : [] } : {}),
      isActive: form.isActive,
    };

    setSaving(true);
    try {
      let saved: Product;
      if (editing) {
        saved = await api.patch<Product>(`/products/${editing.id}`, payload);
        toast.success('Product updated.');
      } else {
        saved = await api.post<Product>('/products', payload);
        toast.success('Product created.');
      }
      await refetch();
      if (mode === 'saveNew') {
        setEditing(null);
        setForm((f) => ({ ...f, name: '', description: '' }));
        setTimeout(() => codeRef.current?.focus(), 0);
      } else if (mode === 'save') {
        setEditing(saved);
        setForm(formFrom(saved));
      } else {
        closeDrawer();
      }
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const remove = async (p: Product) => {
    const ok = await confirm({
      title: 'Delete product',
      message: `Delete "${p.name}"?`,
      danger: true,
      confirmText: 'Delete',
    });
    if (!ok) return;
    try {
      await api.delete(`/products/${p.id}`);
      toast.success('Product deleted.');
      refetch();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to delete.');
    }
  };

  // Retire/restore without deleting — keeps the code, leaves no gap.
  const toggleActive = (p: Product) =>
    guardEdit(p, async () => {
      try {
        await api.patch(`/products/${p.id}`, { isActive: !p.isActive });
        toast.success(
          p.isActive ? 'Product set inactive.' : 'Product set active.',
        );
        refetch();
      } catch (e) {
        toast.error(e instanceof ApiError ? e.message : 'Failed to update.');
      }
    });

  const visibleRows = useMemo(() => {
    let rows = [...(data ?? [])];
    // Scoped by CATEGORY, not by group: a product's category is what assigns it
    // to this screen, which is how one shared group can feed both.
    rows = rows.filter((r) => screenCategoryIds.has(r.categoryId));
    if (parentFilter) {
      // The parent-group filter lists leaf groups (what products attach to), so
      // match the product's own leaf group.
      rows = rows.filter((r) => String(r.groupId ?? '') === parentFilter);
    }
    // This screen lists unpacked products only.
    rows = rows.filter((r) => r.unpacked);
    if (sourceFilter) rows = rows.filter((r) => r.source === sourceFilter);
    if (sellFilter === 'yes') rows = rows.filter((r) => r.canSell);
    else if (sellFilter === 'no') rows = rows.filter((r) => !r.canSell);
    if (status === 'active') rows = rows.filter((r) => r.isActive);
    else if (status === 'inactive') rows = rows.filter((r) => !r.isActive);
    return rows.sort((a, b) => a.code.localeCompare(b.code));
  }, [data, sellFilter, sourceFilter, status, screenCategoryIds, parentFilter]);

  const columns: Column<Product>[] = [
    { key: 'code', header: 'Code', accessor: (r) => r.code },
    { key: 'category', header: 'Category', accessor: (r) => r.category?.name ?? '-' },
    { key: 'group', header: 'Group', accessor: (r) => r.group?.name ?? '-' },
    {
      key: 'name',
      header: 'Product',
      sortAccessor: (r) => r.name,
      render: (r) => (
        <span className="font-medium text-slate-800 dark:text-slate-100">
          {r.name}
        </span>
      ),
    },
    { key: 'unit', header: 'Unit', accessor: (r) => r.unit?.symbol ?? r.unit?.code ?? '-' },
    {
      key: 'source',
      header: 'Source',
      sortAccessor: (r) => PRODUCT_SOURCE_LABEL[r.source] ?? '',
      render: (r) => (
        <Badge color={r.source === 'PURCHASED' ? 'amber' : 'blue'}>
          {PRODUCT_SOURCE_LABEL[r.source] ?? '-'}
        </Badge>
      ),
    },
    {
      key: 'intercompanyPrice',
      header: 'Inter-Co',
      accessor: (r) => (r.intercompanyPrice ?? 0).toLocaleString(),
      sortAccessor: (r) => r.intercompanyPrice ?? 0,
    },
    {
      key: 'wholesalePrice',
      header: 'Wholesale',
      accessor: (r) => (r.wholesalePrice ?? 0).toLocaleString(),
      sortAccessor: (r) => r.wholesalePrice ?? 0,
    },
    {
      key: 'retailPrice',
      header: 'Retail',
      accessor: (r) => (r.retailPrice ?? 0).toLocaleString(),
      sortAccessor: (r) => r.retailPrice ?? 0,
    },
    { key: 'hsn', header: 'HSN', accessor: (r) => r.hsnCode?.code ?? '-' },
    {
      key: 'isActive',
      header: 'Status',
      sortAccessor: (r) => (r.isActive ? 'Active' : 'Inactive'),
      render: (r) => (
        <Badge color={r.isActive ? 'green' : 'slate'}>
          {r.isActive ? 'Active' : 'Inactive'}
        </Badge>
      ),
    },
  ];

  const title = view ? 'View Product' : editing ? 'Edit Product' : 'New Product';

  return (
    <div className="mx-auto flex h-full max-w-7xl flex-col">
      <PageHeader
        title="Products - Semifinished"
        description="Semi-finished products — recipes are set under Production → Recipe Master"
        icon={<PackageOpen className="h-5 w-5" />}
        actions={
          canAdd && (
            <button className="btn-primary" onClick={openAdd}>
              <Plus className="h-4 w-4" /> Add New
              <span className="ml-1 hidden text-[10px] opacity-70 sm:inline">
                Alt+A
              </span>
            </button>
          )
        }
      />

      <DataTable
        columns={columns}
        rows={visibleRows}
        defaultSort={{ key: 'code', dir: 'asc' }}
        key={`${parentFilter}|${sellFilter}|${status}`}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search products..."
        toolbar={
          <div className="flex flex-nowrap items-center gap-2">
            {/* No category filter: the screen is fixed to SCREEN_KIND. */}
            <Select
              value={parentFilter}
              onChange={(e) => setParentFilter(e.target.value)}
              wrapClassName="w-36"
              placeholder="Any parent group"
              options={productGroups
                .filter((g) => !g.subGroupApplicable && g.isActive)
                .map((g) => ({ value: String(g.id), label: g.name }))}
            />
            <Select
              value={sourceFilter}
              onChange={(e) => setSourceFilter(e.target.value)}
              wrapClassName="w-40"
              placeholder="Source: All"
              options={PRODUCT_SOURCE_OPTIONS.map((o) => ({
                value: o.value,
                label: PRODUCT_SOURCE_LABEL[o.value],
              }))}
            />
            <Select
              value={sellFilter}
              onChange={(e) => setSellFilter(e.target.value)}
              wrapClassName="w-32"
              placeholder="Can sell: All"
              options={[
                { value: 'yes', label: 'Can sell' },
                { value: 'no', label: 'Cannot sell' },
              ]}
            />
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              wrapClassName="w-32"
              placeholder="All statuses"
              options={[
                { value: 'active', label: 'Active' },
                { value: 'inactive', label: 'Inactive' },
              ]}
            />
          </div>
        }
        onView={openView}
        onEdit={(r) => guardEdit(r, () => openEdit(r))}
        onDelete={(r) => guardDelete(r, () => remove(r))}
        canView={canView}
        canEdit={canEdit}
        canDelete={canDelete}
        rowActions={(r) => (
          <StatusToggle
            active={r.isActive}
            canEdit={canEdit}
            onToggle={() => toggleActive(r)}
          />
        )}
        bulkLock={bulkLock}
        renderLock={(r) => (
          <LockButton
            locked={r.isLocked}
            canLock={canLock}
            canUnlock={canUnlock}
            onToggle={() => toggleLock(r)}
          />
        )}
        emptyMessage="No products found"
      />

      <Drawer
        open={open}
        onClose={closeDrawer}
        title={title}
        subtitle="Product details"
        icon={<PackageOpen className="h-5 w-5" />}
        width="lg"
        footer={
          view ? (
            <CloseFooter onClose={closeDrawer} />
          ) : (
            <DrawerFooter
              onCancel={closeDrawer}
              onSave={save}
              saving={saving}
              dataEntry
            />
          )
        }
      >
        <ReadOnlyFieldset readOnly={view}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Input
              label="Code (auto)"
              value={editing ? editing.code : 'Generated from the group'}
              disabled
            />
            <Input
              ref={codeRef}
              label="Name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Butter Bun"
            />
            <Textarea
              label="Description"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              wrapClassName="sm:col-span-2"
            />

            {/* Classification — immutable after creation (the code encodes it),
                so it's read-only when editing. To move a product, inactivate it
                and create a new one under the right group. */}
            {editing ? (
              <>
                <Input
                  label="Category"
                  value={editing.category?.name ?? '-'}
                  disabled
                />
                <Input
                  label="Primary Group"
                  value={editAncestry?.primary ?? '-'}
                  disabled
                />
                <Input
                  label="Parent Group"
                  value={editAncestry?.parent ?? '-'}
                  disabled
                />
                <Input
                  label="Group"
                  value={editing.group?.name ?? editAncestry?.leaf ?? '-'}
                  disabled
                  wrapClassName="sm:col-span-2"
                />
              </>
            ) : (
              <>
                {/* Category — shown but fixed: this screen owns one kind, so a
                    product filed elsewhere would vanish from the very listing
                    that created it. It becomes a pick only if a second category
                    of this kind is ever added. */}
                {soleCategory ? (
                  <Input
                    label="Category"
                    value={soleCategory.name}
                    disabled
                    wrapClassName="sm:col-span-2"
                  />
                ) : (
                  <Select
                    label="Category"
                    required
                    value={form.categoryId}
                    onChange={(e) => {
                      // A different category invalidates the group cascade.
                      setDrawerParent('');
                      setForm({
                        ...form,
                        categoryId: e.target.value,
                        groupId: '',
                      });
                    }}
                    placeholder={
                      screenCategories.length
                        ? '— Select —'
                        : 'No Semifinished Products category yet'
                    }
                    wrapClassName="sm:col-span-2"
                    options={screenCategories.map((c) => ({
                      value: c.id,
                      label: c.name,
                    }))}
                  />
                )}
                <Select
                  label="Parent Group"
                  value={drawerParent}
                  onChange={(e) => {
                    setDrawerParent(e.target.value);
                    setForm({ ...form, groupId: '' });
                  }}
                  placeholder="— None —"
                  options={drawerParentOptions.map((g) => ({
                    value: String(g.id),
                    label: `${'· '.repeat(g.level - 1)}${g.name}`,
                  }))}
                />
                <Select
                  label="Group"
                  required
                  value={form.groupId}
                  onChange={(e) => setForm({ ...form, groupId: e.target.value })}
                  placeholder="Select a leaf group"
                  options={drawerLeafOptions.map((g) => ({
                    value: g.id,
                    label: g.name,
                  }))}
                />
              </>
            )}

            <Select
              label="Unit"
              required
              value={form.unitId}
              onChange={(e) => setForm({ ...form, unitId: e.target.value })}
              placeholder="Select a unit"
              options={unitList.map((u) => ({
                value: u.id,
                label: u.name,
              }))}
            />
            {/* Cost — the base for every profit %. Always editable, even for
                non-sellable products (e.g. ingredients). */}
            <Input
              label="Cost Price"
              type="number"
              min={0}
              step="any"
              value={form.costPrice}
              onChange={(e) =>
                setForm((f) => {
                  const cost = toN(e.target.value);
                  // Keep the entered prices; refresh each margin against the
                  // new cost (blank when the price is 0 or below cost).
                  return {
                    ...f,
                    costPrice: e.target.value,
                    intercompanyProfitPct: pctDisplay(
                      f.intercompanyPrice,
                      cost,
                      f.intercompanyProfitPct,
                    ),
                    wholesaleProfitPct: pctDisplay(
                      f.wholesalePrice,
                      cost,
                      f.wholesaleProfitPct,
                    ),
                    retailProfitPct: pctDisplay(
                      f.retailPrice,
                      cost,
                      f.retailProfitPct,
                    ),
                  };
                })
              }
            />

            {/* Form factor is fixed on the Unpacked screen (always unpacked,
                never packed), so the toggles are hidden and forced — see
                `empty` / `formFrom`. */}

            {/* Source — in-house production vs resale/traded goods. Declared,
                not inferred from a missing recipe, and it governs the two BOM
                capabilities below: resale stock is bought ready-made, so
                choosing Purchased clears and locks them. */}
            <div className="flex flex-col gap-1 sm:col-span-2">
              <Select
                label="Source"
                required
                value={form.source}
                onChange={(e) => {
                  const source = e.target.value as ProductSource;
                  // Resale stock carries no BOM — clear both rather than let
                  // the server reject the save.
                  setForm((f) =>
                    source === 'PURCHASED'
                      ? { ...f, source, hasRecipe: false, hasPacking: false }
                      : { ...f, source },
                  );
                }}
                options={PRODUCT_SOURCE_OPTIONS}
              />
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {form.source === 'PURCHASED'
                  ? 'Resale / traded goods — bought ready-made, so it carries no recipe or packing BOM and stays off the production screens.'
                  : 'Made in-house — it can carry a recipe and packing BOM and appears on the production screens.'}
              </p>
            </div>

            {/* Capabilities — what may be built for this product and how it may
                be used. Has Recipe puts it on Production → Recipe Master and Has
                Packing on Packing Master; both are defaulted per screen (recipe
                on here) but editable, and both are unavailable to a Purchased
                product. Can Sell gates the selling prices, profit %, picture and
                branch stock levels, so the group sits above them. Kept together
                in one block ahead of the fields they govern. */}
            <div className="flex flex-col gap-2 sm:col-span-2">
              <span className="label !mb-0">Capabilities</span>
              <div className="flex flex-wrap gap-x-8 gap-y-2">
                <Checkbox
                  label="Has Recipe"
                  checked={form.hasRecipe}
                  disabled={form.source === 'PURCHASED'}
                  onChange={(e) =>
                    setForm({ ...form, hasRecipe: e.target.checked })
                  }
                />
                <Checkbox
                  label="Has Packing"
                  checked={form.hasPacking}
                  disabled={form.source === 'PURCHASED'}
                  onChange={(e) =>
                    setForm({ ...form, hasPacking: e.target.checked })
                  }
                />
                <Checkbox
                  label="Can be Ingredient"
                  checked={form.isIngredient}
                  onChange={(e) =>
                    setForm({ ...form, isIngredient: e.target.checked })
                  }
                />
                <Checkbox
                  label="Can Sell"
                  checked={form.canSell}
                  onChange={(e) => {
                    const canSell = e.target.checked;
                    // Unchecking clears the now-disabled selling fields.
                    setForm((f) =>
                      canSell
                        ? { ...f, canSell }
                        : {
                            ...f,
                            canSell,
                            imageUrl: '',
                            intercompanyPrice: '',
                            intercompanyProfitPct: '',
                            wholesalePrice: '',
                            wholesaleProfitPct: '',
                            retailPrice: '',
                            retailProfitPct: '',
                            boxQty: '',
                            boxUnitId: '',
                          },
                    );
                  }}
                />
              </div>
            </div>

            {/* Product picture — only for sellable products. */}
            {form.canSell && (
              <div className="sm:col-span-2">
                <span className="label !mb-1 block">Product Picture</span>
                <div className="flex items-center gap-3">
                  <div className="flex h-20 w-20 flex-none items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
                    {form.imageUrl ? (
                      <img
                        src={mediaUrl(form.imageUrl)}
                        alt="Product"
                        className="h-full w-full object-contain"
                      />
                    ) : (
                      <ImageIcon className="h-6 w-6 text-slate-300" />
                    )}
                  </div>
                  {!view && (
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn-secondary inline-flex items-center gap-2"
                        onClick={() => imageInput.current?.click()}
                        disabled={imageUploading}
                      >
                        <Upload className="h-4 w-4" />
                        {imageUploading ? 'Uploading…' : 'Upload'}
                      </button>
                      {form.imageUrl && (
                        <button
                          type="button"
                          className="btn-secondary inline-flex items-center gap-2 text-rose-600"
                          onClick={() => setForm({ ...form, imageUrl: '' })}
                        >
                          <Trash2 className="h-4 w-4" /> Remove
                        </button>
                      )}
                      <input
                        ref={imageInput}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif"
                        className="hidden"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void uploadImage(f);
                          e.target.value = '';
                        }}
                      />
                    </div>
                  )}
                </div>
                <p className="mt-1 text-xs text-slate-400">
                  PNG, JPG, WEBP or GIF — up to 5 MB.
                </p>
              </div>
            )}

            <Input
              label="Intercompany Price"
              type="number"
              min={0}
              step="any"
              disabled={!form.canSell}
              value={form.intercompanyPrice}
              onChange={(e) =>
                setForm((f) => {
                  const cost = toN(f.costPrice);
                  return {
                    ...f,
                    intercompanyPrice: e.target.value,
                    intercompanyProfitPct: pctDisplay(
                      e.target.value,
                      cost,
                      f.intercompanyProfitPct,
                    ),
                  };
                })
              }
            />
            <Input
              label="Intercompany Profit %"
              type="number"
              step="any"
              disabled={!form.canSell}
              value={form.intercompanyProfitPct}
              onChange={(e) =>
                setForm((f) => {
                  const cost = toN(f.costPrice);
                  return {
                    ...f,
                    intercompanyProfitPct: e.target.value,
                    intercompanyPrice:
                      e.target.value !== '' && cost > 0
                        ? String(priceFromPct(toN(e.target.value), cost))
                        : f.intercompanyPrice,
                  };
                })
              }
            />
            <Input
              label="Wholesale Price"
              type="number"
              min={0}
              step="any"
              disabled={!form.canSell}
              value={form.wholesalePrice}
              onChange={(e) =>
                setForm((f) => {
                  const cost = toN(f.costPrice);
                  return {
                    ...f,
                    wholesalePrice: e.target.value,
                    wholesaleProfitPct: pctDisplay(
                      e.target.value,
                      cost,
                      f.wholesaleProfitPct,
                    ),
                  };
                })
              }
            />
            <Input
              label="Wholesale Profit %"
              type="number"
              step="any"
              disabled={!form.canSell}
              value={form.wholesaleProfitPct}
              onChange={(e) =>
                setForm((f) => {
                  const cost = toN(f.costPrice);
                  return {
                    ...f,
                    wholesaleProfitPct: e.target.value,
                    wholesalePrice:
                      e.target.value !== '' && cost > 0
                        ? String(priceFromPct(toN(e.target.value), cost))
                        : f.wholesalePrice,
                  };
                })
              }
            />
            <Input
              label="Retail Price"
              type="number"
              min={0}
              step="any"
              disabled={!form.canSell}
              value={form.retailPrice}
              onChange={(e) =>
                setForm((f) => {
                  const cost = toN(f.costPrice);
                  return {
                    ...f,
                    retailPrice: e.target.value,
                    retailProfitPct: pctDisplay(
                      e.target.value,
                      cost,
                      f.retailProfitPct,
                    ),
                  };
                })
              }
            />
            <Input
              label="Retail Profit %"
              type="number"
              step="any"
              disabled={!form.canSell}
              value={form.retailProfitPct}
              onChange={(e) =>
                setForm((f) => {
                  const cost = toN(f.costPrice);
                  return {
                    ...f,
                    retailProfitPct: e.target.value,
                    retailPrice:
                      e.target.value !== '' && cost > 0
                        ? String(priceFromPct(toN(e.target.value), cost))
                        : f.retailPrice,
                  };
                })
              }
            />

            {/* Pack content */}
            <Input
              label="Box Quantity"
              type="number"
              min={0}
              step="any"
              disabled={!form.canSell}
              value={form.boxQty}
              onChange={(e) => setForm({ ...form, boxQty: e.target.value })}
            />
            <Select
              label="Box Unit"
              disabled={!form.canSell}
              value={form.boxUnitId}
              onChange={(e) => setForm({ ...form, boxUnitId: e.target.value })}
              placeholder="— None —"
              options={unitList.map((u) => ({
                value: u.id,
                label: u.name,
              }))}
            />

            <Select
              label="HSN Code"
              value={form.hsnCodeId}
              onChange={(e) => setForm({ ...form, hsnCodeId: e.target.value })}
              placeholder="— None —"
              options={(hsnCodes ?? []).map((h) => ({
                value: h.id,
                label: `${h.code} — ${h.description} (IGST ${h.igst}%)`,
              }))}
            />
            <Input
              label="Shelf Life (days)"
              type="number"
              min={0}
              value={form.shelfLife}
              onChange={(e) => setForm({ ...form, shelfLife: e.target.value })}
            />

            {/* Capabilities (Has Recipe / Has Packing / Can be Ingredient / Can
                Sell) live in one block higher up, above the selling fields that
                Can Sell gates. */}

            {/* Availability */}
            <div className="flex flex-col gap-2 sm:col-span-2">
              <span className="label !mb-0">Availability</span>
              <Checkbox
                label="All companies (including ones added later)"
                checked={form.allCompanies}
                onChange={(e) =>
                  setForm({ ...form, allCompanies: e.target.checked })
                }
              />
              {!form.allCompanies && (
                <div className="mt-1 max-h-52 space-y-1.5 overflow-y-auto rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                  {companyList.length === 0 ? (
                    <p className="text-sm text-slate-400">No companies found.</p>
                  ) : (
                    companyList.map((co) => (
                      <Checkbox
                        key={co.id}
                        label={`${co.name} (${co.code})`}
                        checked={form.companyIds.includes(co.id)}
                        onChange={() => toggleCompany(co.id)}
                      />
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Discount matrix — sellable products only, for the same reason as
                the branch levels below: a product that isn't sold has nothing
                to discount. */}
            {form.canSell && (
              <DiscountMatrix
                levels={discountLevels}
                value={form.discounts}
                onChange={(levelId, percentage) =>
                  setForm((f) => ({
                    ...f,
                    discounts: { ...f.discounts, [levelId]: percentage },
                  }))
                }
              />
            )}

            {/* Per-branch stock levels — sellable products only. One row per
                active branch of every company this product is available in.
                New branches appear here automatically (rendered from the live
                branch list). */}
            {form.canSell && (
              <div className="flex flex-col gap-2 sm:col-span-2">
                <span className="label !mb-0">Branch Stock Levels</span>
                <p className="text-xs text-slate-400">
                  Minimum / maximum stock, reorder level and lead time (days) per
                  branch. New branches are added here automatically.
                </p>
                {branchGroups.length === 0 ? (
                  <p className="rounded-lg border border-dashed border-slate-200 p-3 text-sm text-slate-400 dark:border-slate-700">
                    No branches to configure. Add branches under the companies
                    this product is available in.
                  </p>
                ) : (
                  <div className="space-y-4 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                    {branchGroups.map((g) => (
                      <div key={g.company.id}>
                        <div className="mb-2 text-sm font-medium text-slate-700 dark:text-slate-200">
                          {g.company.name}
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse text-sm">
                            <thead>
                              <tr className="text-left text-xs text-slate-400">
                                <th className="pb-1 pr-2 font-medium">Branch</th>
                                <th className="pb-1 pr-2 font-medium">Min</th>
                                <th className="pb-1 pr-2 font-medium">Max</th>
                                <th className="pb-1 pr-2 font-medium">Reorder</th>
                                <th className="pb-1 pr-2 font-medium">Lead (days)</th>
                                <th className="pb-1 pr-2 font-medium">Default store</th>
                                <th className="pb-1 font-medium">Default rack</th>
                              </tr>
                            </thead>
                            <tbody>
                              {g.branches.map((b) => {
                                const v = form.branchStocks[b.id] ?? EMPTY_BS;
                                return (
                                  <tr key={b.id}>
                                    <td className="py-1 pr-2 align-middle text-slate-700 dark:text-slate-200">
                                      {b.name}
                                    </td>
                                    <td className="py-1 pr-2">
                                      <input
                                        type="number"
                                        min={0}
                                        step="any"
                                        className="input-base w-24 text-right"
                                        value={v.minStock}
                                        onChange={(e) =>
                                          setBranchStock(
                                            b.id,
                                            'minStock',
                                            e.target.value,
                                          )
                                        }
                                      />
                                    </td>
                                    <td className="py-1 pr-2">
                                      <input
                                        type="number"
                                        min={0}
                                        step="any"
                                        className="input-base w-24 text-right"
                                        value={v.maxStock}
                                        onChange={(e) =>
                                          setBranchStock(
                                            b.id,
                                            'maxStock',
                                            e.target.value,
                                          )
                                        }
                                      />
                                    </td>
                                    <td className="py-1 pr-2">
                                      <input
                                        type="number"
                                        min={0}
                                        step="any"
                                        className="input-base w-24 text-right"
                                        value={v.reorderLevel}
                                        onChange={(e) =>
                                          setBranchStock(
                                            b.id,
                                            'reorderLevel',
                                            e.target.value,
                                          )
                                        }
                                      />
                                    </td>
                                    <td className="py-1 pr-2">
                                      <input
                                        type="number"
                                        min={0}
                                        step={1}
                                        className="input-base w-24 text-right"
                                        value={v.leadTimeDays}
                                        onChange={(e) =>
                                          setBranchStock(
                                            b.id,
                                            'leadTimeDays',
                                            e.target.value,
                                          )
                                        }
                                      />
                                    </td>
                                    <td className="py-1 pr-2">
                                      <Select
                                        value={v.defaultStoreId}
                                        onChange={(e) =>
                                          setBranchStore(b.id, e.target.value)
                                        }
                                        placeholder="—"
                                        wrapClassName="w-40"
                                        options={storeOptions(
                                          g.company.id,
                                          b.id,
                                          v.defaultStoreId,
                                        )}
                                      />
                                    </td>
                                    <td className="py-1">
                                      <Select
                                        value={v.defaultRackId}
                                        onChange={(e) =>
                                          setBranchStock(
                                            b.id,
                                            'defaultRackId',
                                            e.target.value,
                                          )
                                        }
                                        placeholder="—"
                                        wrapClassName="w-36"
                                        disabled={!v.defaultStoreId}
                                        options={rackOptions(
                                          v.defaultStoreId,
                                          v.defaultRackId,
                                        )}
                                      />
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            <div className="sm:col-span-2">
              <Checkbox
                label="Active"
                checked={form.isActive}
                onChange={(e) =>
                  setForm({ ...form, isActive: e.target.checked })
                }
              />
            </div>
          </div>
        </ReadOnlyFieldset>
      </Drawer>
    </div>
  );
}
