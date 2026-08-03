'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, PackageOpen, Upload, Image as ImageIcon, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { money2, dec2 } from '@/lib/utils';
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
import {
  ProductCompanies,
  companiesFormFrom,
  companiesPayload,
  type CompaniesForm,
} from '@/components/inventory/ProductCompanies';
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
  CostCenter,
  CostObject,
  Branch,
  Lookup,
  LookupValue,
  Store,
  Rack,
} from '@/lib/types';

const ROUTE = '/inventory/products-packed';

// The category KIND this screen owns. The listing, the group filters and the
// drawer are all scoped to categories of this kind, so a product's category —
// not its group — is what decides which screen lists it. That is what lets
// "Bakery" be one shared group serving both this screen and Products - Unpacked
// instead of being entered twice. Binding to the kind rather than to a named
// category means renaming a category never strands the screen.
const SCREEN_KIND: CategoryKind = 'FINISHED';
// Delivery trips are configurable (Inventory > Lookups), so the Delivery
// Schedule offers whatever is defined rather than a hard-coded Trip 1-4.
const DELIVERY_TRIP_LOOKUP_CODE = 'DELIVERY_TRIP';
// Production days are fixed by the calendar, so these stay in code.
const PRODUCTION_DAYS = [
  { key: 'prodSun', label: 'Sun' },
  { key: 'prodMon', label: 'Mon' },
  { key: 'prodTue', label: 'Tue' },
  { key: 'prodWed', label: 'Wed' },
  { key: 'prodThu', label: 'Thu' },
  { key: 'prodFri', label: 'Fri' },
  { key: 'prodSat', label: 'Sat' },
] as const;

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
  // Form factor is derived from hasPacking on save (see the save payload), so
  // these only mirror the `hasPacking: true` default below.
  unpacked: false,
  packed: true,
  canSell: true,
  costPrice: '',
  wholesalePrice: '',
  wholesaleProfitPct: '',
  intercompanyPrice: '',
  intercompanyProfitPct: '',
  retailPrice: '',
  retailProfitPct: '',
  // Box packing is optional per product, so the two fields below only show
  // once it is ticked. Form-only: what's stored is the box qty/unit themselves.
  boxApplicable: false,
  boxQty: '',
  boxUnitId: '',
  hsnCodeId: '',
  shelfLife: '',
  // Defaults for a new finished product: packed, no recipe, and not usable as
  // an ingredient. The two BOM flags are editable in the drawer.
  // Max discount % per authority level, keyed by DISCOUNT_LEVEL LookupValue id.
  discounts: {} as DiscountForm,
  // Finished goods on this screen are made in-house by default; switch to
  // Purchased for resale / traded stock.
  source: 'MANUFACTURED' as ProductSource,
  hasRecipe: false,
  hasPacking: true,
  isIngredient: false,
  // Production schedule — the days this product is made on.
  prodSun: false,
  prodMon: false,
  prodTue: false,
  prodWed: false,
  prodThu: false,
  prodFri: false,
  prodSat: false,
  prodOccasional: false,
  // Delivery Schedule — LookupValue ids from the DELIVERY_TRIP lookup.
  deliveryTripIds: [] as number[],
  // Which companies make and/or sell this, and the costing each traces it
  // against. Keyed by companyId; a missing key means the company is not involved.
  companies: {} as CompaniesForm,
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
  return pct < 0 ? '' : pct.toFixed(2);
};

export default function ProductsPage() {
  const { can } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const { data, loading, refetch } = useFetch<Product[]>('/products');
  const { data: groups } = useFetch<Group[]>('/groups');
  const { data: categories } = useFetch<Category[]>('/categories');
  // Cost centres / objects across ALL companies — the company grid needs each
  // company's own, not just the active one's, so these go unscoped.
  const { data: costCenters } = useFetch<CostCenter[]>('/cost-centers');
  const { data: costObjects } = useFetch<CostObject[]>('/cost-objects');
  const { data: units } = useFetch<Unit[]>('/units');
  const { data: hsnCodes } = useFetch<HsnCode[]>('/hsn-codes');
  const { data: companies } = useFetch<Company[]>('/companies');
  const { data: branches } = useFetch<Branch[]>('/branches');
  // All stores/racks across companies — the per-branch default location pickers
  // span every company the product is available in, so they can't be scoped to
  // the active branch.
  const { data: stores } = useFetch<Store[]>('/stores?all=true');
  const { data: racks } = useFetch<Rack[]>('/racks?all=true');

  // Both lists are lookup-driven, so they're fetched the same way: find the
  // lookup by code, then its active values.
  const tripValues = useLookupValues(DELIVERY_TRIP_LOOKUP_CODE);
  const discountLevels = useLookupValues('DISCOUNT_LEVEL');
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
  const [primaryFilter, setPrimaryFilter] = useState('');
  const [parentFilter, setParentFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState(''); // '' | ProductSource
  // No "can sell" filter here: every finished product is sellable (canSell is
  // forced on for this screen), so it would only ever have one answer.
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
  // Top of a group's tree. Products hang off leaf groups, so both the Primary
  // group filter and the group list it cascades into resolve through this.
  const primaryIdOf = useMemo(
    () => (groupId: number | null | undefined) => {
      let node = groupId != null ? groupById.get(groupId) : undefined;
      while (node && node.level > 1 && node.parentGroupId) {
        node = groupById.get(node.parentGroupId);
      }
      return node && node.level === 1 ? node.id : null;
    },
    [groupById],
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
  // The same read-out for a new product, following the cascade as it is filled
  // in (leaf group once chosen, otherwise the parent).
  const drawerAncestry = groupAncestry(
    form.groupId
      ? Number(form.groupId)
      : drawerParent
        ? Number(drawerParent)
        : null,
  );

  // Data-entry keyboard rules, same as the transaction screens: Enter moves to
  // the next field (it never submits), and pickers open ready to search as soon
  // as focus lands on them.
  const enterTo = (nextId: string) => (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    document.getElementById(nextId)?.focus();
  };

  // Unit name for the pack helper line under the box fields.
  const unitName = (id: string) =>
    unitList.find((u) => String(u.id) === String(id))?.name ?? 'unit';
  const closeDrawer = () => {
    setOpen(false);
    setView(false);
  };

  // Prices and margins are read down a column and compared against each other,
  // so each settles to two decimals when its field is left. Typing stays free.
  const blur2 =
    (
      key:
        | 'costPrice'
        | 'wholesalePrice'
        | 'wholesaleProfitPct'
        | 'intercompanyPrice'
        | 'intercompanyProfitPct'
        | 'retailPrice'
        | 'retailProfitPct',
    ) =>
    () =>
      setForm((f) => ({ ...f, [key]: dec2(f[key]) }));

  const formFrom = (p: Product) => ({
    code: p.code,
    name: p.name,
    description: p.description ?? '',
    imageUrl: p.imageUrl ?? '',
    categoryId: p.categoryId != null ? String(p.categoryId) : '',
    groupId: p.groupId != null ? String(p.groupId) : '',
    unitId: String(p.unitId),
    // Form factor is re-derived from hasPacking on save; finished products are
    // always sellable.
    unpacked: !(p.hasPacking ?? true),
    packed: p.hasPacking ?? true,
    canSell: true,
    costPrice: dec2(String(p.costPrice ?? 0)),
    wholesalePrice: dec2(String(p.wholesalePrice ?? 0)),
    wholesaleProfitPct: pctDisplay(
      String(p.wholesalePrice ?? 0),
      p.costPrice ?? 0,
    ),
    intercompanyPrice: dec2(String(p.intercompanyPrice ?? 0)),
    intercompanyProfitPct: pctDisplay(
      String(p.intercompanyPrice ?? 0),
      p.costPrice ?? 0,
    ),
    retailPrice: dec2(String(p.retailPrice ?? 0)),
    retailProfitPct: pctDisplay(String(p.retailPrice ?? 0), p.costPrice ?? 0),
    // Ticked for anything already boxed, so the saved values stay visible.
    boxApplicable: !!(p.boxUnitId || p.boxQty),
    boxQty: String(p.boxQty ?? 0),
    boxUnitId: p.boxUnitId != null ? String(p.boxUnitId) : '',
    hsnCodeId: p.hsnCodeId != null ? String(p.hsnCodeId) : '',
    shelfLife: String(p.shelfLife ?? 0),
    // Editable in the drawer; `empty` holds this screen's default for new rows.
    discounts: discountFormFrom(p.discounts),
    source: (p.source ?? 'MANUFACTURED') as ProductSource,
    hasRecipe: p.hasRecipe ?? false,
    hasPacking: p.hasPacking ?? true,
    isIngredient: false,
    prodSun: !!p.prodSun,
    prodMon: !!p.prodMon,
    prodTue: !!p.prodTue,
    prodWed: !!p.prodWed,
    prodThu: !!p.prodThu,
    prodFri: !!p.prodFri,
    prodSat: !!p.prodSat,
    prodOccasional: !!p.prodOccasional,
    deliveryTripIds: p.deliveryTripIds ?? [],
    companies: companiesFormFrom(p.companies),
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

  // A new product opens with the cursor in Name — the first thing anyone types
  // (Source, category and the capabilities all come pre-filled). The delay lets
  // the drawer finish sliding in, otherwise the focus doesn't stick.
  useEffect(() => {
    if (!open || editing || view) return;
    const t = setTimeout(() => codeRef.current?.focus(), 320);
    return () => clearTimeout(t);
  }, [open, editing, view]);

  const toggleTrip = (id: number) =>
    setForm((f) => ({
      ...f,
      deliveryTripIds: f.deliveryTripIds.includes(id)
        ? f.deliveryTripIds.filter((x) => x !== id)
        : [...f.deliveryTripIds, id],
    }));

  // Branches the product can be stocked at: every active branch of each company
  // the product is available in (all companies, or the chosen set), grouped by
  // company. New branches appear automatically because this reads the live
  // branch list rather than the product's saved rows.
  const branchGroups = companyList
    .filter((c) => form.companies[c.id] != null)
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
    if (!form.groupId) {
      toast.error('Select a group — every product belongs to a leaf group.');
      return;
    }
    if (drawerCategoryId == null) {
      toast.error('Select a category.');
      return;
    }
    if (!form.unitId) {
      toast.error('Select a unit.');
      return;
    }
    if (Object.keys(form.companies).length === 0) {
      toast.error('Select at least one company that makes or sells this product.');
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
      // Form factor follows the packing capability rather than the screen: a
      // finished product that has a packing step is packed, one made straight
      // from a recipe (e.g. Egg Puff) is not. Deriving it here keeps the flag
      // from drifting away from `hasPacking`, which is what Recipe Master and
      // Packing Master actually key their costing off.
      unpacked: !form.hasPacking,
      packed: form.hasPacking,
      canSell: form.canSell,
      costPrice: num(form.costPrice),
      wholesalePrice: num(form.wholesalePrice),
      wholesaleProfitPct: num(form.wholesaleProfitPct),
      intercompanyPrice: num(form.intercompanyPrice),
      intercompanyProfitPct: num(form.intercompanyProfitPct),
      retailPrice: num(form.retailPrice),
      retailProfitPct: num(form.retailProfitPct),
      // Cleared outright when box packing does not apply.
      boxQty: form.boxApplicable ? num(form.boxQty) : 0,
      boxUnitId: form.boxApplicable ? idOrNull(form.boxUnitId) : null,
      hsnCodeId: idOrNull(form.hsnCodeId),
      shelfLife: num(form.shelfLife),
      // Sent whole; the server drops the zeros and clears it when not sellable.
      discounts: discountPayload(discountLevels, form.discounts),
      source: form.source,
      hasRecipe: form.hasRecipe,
      hasPacking: form.hasPacking,
      isIngredient: form.isIngredient,
      prodSun: form.prodSun,
      prodMon: form.prodMon,
      prodTue: form.prodTue,
      prodWed: form.prodWed,
      prodThu: form.prodThu,
      prodFri: form.prodFri,
      prodSat: form.prodSat,
      prodOccasional: form.prodOccasional,
      deliveryTripIds: form.deliveryTripIds,
      companies: companiesPayload(form.companies),
      // Only send when the branch list has loaded, so a failed/empty fetch can't
      // silently wipe saved rows (backend leaves them intact when omitted).
      ...(branches ? { branchStocks } : {}),
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
    // A primary picks up everything beneath it, however deep the tree runs.
    if (primaryFilter) {
      rows = rows.filter(
        (r) => String(primaryIdOf(r.groupId) ?? '') === primaryFilter,
      );
    }
    if (parentFilter) {
      // The parent-group filter lists leaf groups (what products attach to), so
      // match the product's own leaf group.
      rows = rows.filter((r) => String(r.groupId ?? '') === parentFilter);
    }
    // No packed/unpacked narrowing: the screen's boundary is the category kind
    // (filtered above), and a FINISHED product may be either — packed (made from
    // a semi-finished source) or unpacked (made straight from a recipe, e.g. Egg
    // Puff). Filtering on `packed` here would hide the unpacked ones.
    if (sourceFilter) rows = rows.filter((r) => r.source === sourceFilter);
    if (status === 'active') rows = rows.filter((r) => r.isActive);
    else if (status === 'inactive') rows = rows.filter((r) => !r.isActive);
    return rows.sort((a, b) => a.code.localeCompare(b.code));
  }, [
    data,
    sourceFilter,
    status,
    screenCategoryIds,
    primaryFilter,
    parentFilter,
    primaryIdOf,
  ]);

  const columns: Column<Product>[] = [
    { key: 'code', header: 'Code', accessor: (r) => r.code },
    { key: 'category', header: 'Category', accessor: (r) => r.category?.name ?? '-' },
    { key: 'group', header: 'Group', accessor: (r) => r.group?.name ?? '-' },
    {
      key: 'name',
      header: 'Product',
      sortAccessor: (r) => r.name,
      render: (r) => (
        <div className="flex items-center gap-2.5">
          <span className="flex h-9 w-9 flex-none items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
            {r.imageUrl ? (
              <img
                src={mediaUrl(r.imageUrl)}
                alt=""
                className="h-full w-full object-cover"
              />
            ) : (
              <ImageIcon className="h-4 w-4 text-slate-300" />
            )}
          </span>
          <span className="font-medium text-slate-800 dark:text-slate-100">
            {r.name}
          </span>
        </div>
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
      // Cost leads the prices — it's the base every margin is read against.
      key: 'costPrice',
      header: 'Cost',
      accessor: (r) => money2(r.costPrice),
      sortAccessor: (r) => r.costPrice ?? 0,
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
    },
    {
      key: 'intercompanyPrice',
      header: 'Inter-Co',
      accessor: (r) => money2(r.intercompanyPrice),
      sortAccessor: (r) => r.intercompanyPrice ?? 0,
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
    },
    {
      key: 'wholesalePrice',
      header: 'Wholesale',
      accessor: (r) => money2(r.wholesalePrice),
      sortAccessor: (r) => r.wholesalePrice ?? 0,
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
    },
    {
      key: 'retailPrice',
      header: 'Retail',
      accessor: (r) => money2(r.retailPrice),
      sortAccessor: (r) => r.retailPrice ?? 0,
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
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
        title="Products - Finished"
        description="Finished products — packing is set under Production → Packing Master"
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
        key={`${primaryFilter}|${parentFilter}|${sourceFilter}|${status}`}
        rowKey={(r) => r.id}
        loading={loading}
        fillHeight
        onRefresh={refetch}
        searchPlaceholder="Search products..."
        toolbar={
          <div className="flex flex-nowrap items-center gap-2">
            {/* No category filter: the screen is fixed to SCREEN_KIND. */}
            <Select
              value={primaryFilter}
              onChange={(e) => {
                // The group list below cascades from this, so a leftover group
                // from another tree would filter everything away.
                setPrimaryFilter(e.target.value);
                setParentFilter('');
              }}
              wrapClassName="w-36"
              placeholder="Any primary group"
              options={primaryGroups
                .filter((g) => g.isActive)
                .map((g) => ({ value: String(g.id), label: g.name }))}
            />
            <Select
              value={parentFilter}
              onChange={(e) => setParentFilter(e.target.value)}
              wrapClassName="w-36"
              placeholder="Any parent group"
              options={productGroups
                .filter(
                  (g) =>
                    !g.subGroupApplicable &&
                    g.isActive &&
                    (!primaryFilter ||
                      String(primaryIdOf(g.id) ?? '') === primaryFilter),
                )
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
            {/* Header — identity on the left, picture on the right. Source
                leads because it decides the rest of the form: a Purchased
                product carries no BOM at all.
                Description sits at the very bottom of the drawer — it's free
                text nobody fills in first, so it shouldn't push the fields that
                matter (classification, unit, cost) below the fold. */}
            {/* Source — in-house production vs resale/traded goods.
                Declared, not inferred from a missing recipe, and it governs
                the two BOM capabilities below: resale stock is bought
                ready-made, so choosing Purchased clears and locks them. */}
            <div className="flex flex-col gap-1 sm:col-start-1">
              <Select
                id="pf-source"
                advanceToId="pf-name"
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
                  ? 'Resale / traded goods — bought in ready-made and sold as-is, so it carries no recipe or packing BOM and stays off the production screens.'
                  : 'Made in-house — it can carry a recipe and packing BOM and appears on the production screens.'}
              </p>
            </div>
            {/* The code is system-generated from the category + group and
                is already on the listing, so the drawer doesn't repeat it.
                Name gets the whole row, in bold — it's what the record is
                known by. */}
            <Input
              ref={codeRef}
              label="Name"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Butter Bun"
              id="pf-name"
              onKeyDown={enterTo(editing ? 'pf-unit' : 'pf-parent')}
              className="font-semibold"
              wrapClassName="sm:col-start-1"
            />

            {/* Product picture — only for sellable products. */}
            {form.canSell && (
              <div className="flex flex-col gap-1.5 sm:col-start-2 sm:row-start-1 sm:row-span-2">
                <span className="label !mb-0">Product Picture</span>
                <div className="flex h-36 w-36 items-center justify-center overflow-hidden rounded-lg border border-slate-200 bg-slate-50 dark:border-slate-700 dark:bg-slate-800/50">
                  {form.imageUrl ? (
                    <img
                      src={mediaUrl(form.imageUrl)}
                      alt="Product"
                      className="h-full w-full object-contain"
                    />
                  ) : (
                    <ImageIcon className="h-8 w-8 text-slate-300" />
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
                <p className="text-xs text-slate-400">
                  PNG, JPG, WEBP or GIF — up to 5 MB.
                </p>
              </div>
            )}

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
                        : 'No Finished Products category yet'
                    }
                    options={screenCategories.map((c) => ({
                      value: c.id,
                      label: c.name,
                    }))}
                  />
                )}
                {/* Primary Group — derived from the chosen group rather
                    than picked, so a new product reads exactly like the view /
                    edit form instead of a differently shaped one. */}
                <Input
                  label="Primary Group"
                  value={drawerAncestry.primary}
                  disabled
                />
                <Select
                  id="pf-parent"
                  advanceToId="pf-group"
                  openOnFocus
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
                  id="pf-group"
                  advanceToId="pf-unit"
                  openOnFocus
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

            {/* Form factor has no toggles: it is derived from "Has packing"
                below — see the save payload. */}

            {/* Capabilities — what may be built for this product and how it may
                be used. Has Packing puts it on Production → Packing Master and
                Has Recipe on Recipe Master; both are defaulted per screen
                (packing on here) but editable, and both are unavailable to a
                Purchased product. Can Sell rides along for parity with the
                Semifinished screen, but packed products are always sellable, so
                it stays checked and the control is disabled. */}
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
                  label="Can Sell"
                  checked={form.canSell}
                  disabled
                  onChange={(e) => {
                    const canSell = e.target.checked;
                    // Unchecking clears the fields that vanish with it.
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
                          },
                    );
                  }}
                />
              </div>
            </div>

            <Select
              id="pf-unit"
              advanceToId="pf-boxqty"
              openOnFocus
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
            {/* Pack content — how the stock is boxed, so it follows the unit.
                Off by default and hidden with it: plenty of products are never
                handled by the box. Not gated by Can Sell either way — it is how
                the product is handled, whether or not it is sold. */}
            <div className="sm:col-span-2">
              <Checkbox
                label="Box packing applicable"
                checked={form.boxApplicable}
                onChange={(e) =>
                  setForm((f) =>
                    e.target.checked
                      ? { ...f, boxApplicable: true }
                      : { ...f, boxApplicable: false, boxQty: '', boxUnitId: '' },
                  )
                }
              />
            </div>
            {form.boxApplicable && (
              <>
                <Input
                  label="Box Quantity"
                  type="number"
                  min={0}
                  step="any"
                  id="pf-boxqty"
                  onKeyDown={enterTo('pf-boxunit')}
                  value={form.boxQty}
                  onChange={(e) => setForm({ ...form, boxQty: e.target.value })}
                />
                <Select
                  id="pf-boxunit"
                  advanceToId="pf-shelf"
                  openOnFocus
                  label="Box Unit"
                  value={form.boxUnitId}
                  onChange={(e) =>
                    setForm({ ...form, boxUnitId: e.target.value })
                  }
                  placeholder="— None —"
                  options={unitList.map((u) => ({
                    value: u.id,
                    label: u.name,
                  }))}
                />
                <p className="-mt-1 text-xs text-slate-500 dark:text-slate-400 sm:col-span-2">
                {form.boxQty && form.boxUnitId && form.unitId
                  ? `1 ${unitName(form.boxUnitId)} = ${form.boxQty} ${unitName(
                      form.unitId,
                    )} — goods are received in this pack, while stock, issues and balances stay in ${unitName(
                      form.unitId,
                    )}.`
                  : 'How much stock one pack holds — pack unit Bottle with a box qty of 200 against a stock unit of Gram means one bottle is 200 g.'}
                </p>
              </>
            )}
            <Input
              label="Shelf Life (days)"
              type="number"
              min={0}
              id="pf-shelf"
              onKeyDown={enterTo('pf-hsn')}
              value={form.shelfLife}
              onChange={(e) => setForm({ ...form, shelfLife: e.target.value })}
            />
            <Select
              id="pf-hsn"
              advanceToId="pf-cost"
              openOnFocus
              label="HSN Code"
              value={form.hsnCodeId}
              onChange={(e) => setForm({ ...form, hsnCodeId: e.target.value })}
              placeholder="— None —"
              options={(hsnCodes ?? []).map((h) => ({
                value: h.id,
                label: `${h.code} — ${h.description} (IGST ${h.igst}%)`,
              }))}
            />
            {/* Cost — the base for every profit %. Always shown, even for
                non-sellable products, so it sits outside the price matrix
                below. */}
            <Input
              label="Cost Price"
              type="number"
              min={0}
              step="any"
              id="pf-cost"
              onBlur={blur2('costPrice')}
              onKeyDown={enterTo('pf-interco')}
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

            {/* Price matrix — selling prices and the margin each carries over
                the cost above. Hidden outright for a product that isn't sold,
                rather than shown greyed out. */}
            {form.canSell && (
              <div className="flex flex-col gap-2 sm:col-span-2">
                <span className="label !mb-0">Price Matrix</span>
                <p className="text-xs text-slate-400">
                  Price or profit % — entering either fills the other from the
                  cost price.
                </p>
                <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 p-3 dark:border-slate-700 sm:grid-cols-2">
                  <Input
                    label="Intercompany Price"
                    type="number"
                    id="pf-interco"
                    onBlur={blur2('intercompanyPrice')}
                    onKeyDown={enterTo('pf-interco-pct')}
                    min={0}
                    step="any"
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
                    id="pf-interco-pct"
                    onBlur={blur2('intercompanyProfitPct')}
                    onKeyDown={enterTo('pf-wholesale')}
                    step="any"
                    value={form.intercompanyProfitPct}
                    onChange={(e) =>
                      setForm((f) => {
                        const cost = toN(f.costPrice);
                        return {
                          ...f,
                          intercompanyProfitPct: e.target.value,
                          intercompanyPrice:
                            e.target.value !== '' && cost > 0
                              ? priceFromPct(toN(e.target.value), cost).toFixed(2)
                              : f.intercompanyPrice,
                        };
                      })
                    }
                  />
                  <Input
                    label="Wholesale Price"
                    type="number"
                    id="pf-wholesale"
                    onBlur={blur2('wholesalePrice')}
                    onKeyDown={enterTo('pf-wholesale-pct')}
                    min={0}
                    step="any"
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
                    id="pf-wholesale-pct"
                    onBlur={blur2('wholesaleProfitPct')}
                    onKeyDown={enterTo('pf-retail')}
                    step="any"
                    value={form.wholesaleProfitPct}
                    onChange={(e) =>
                      setForm((f) => {
                        const cost = toN(f.costPrice);
                        return {
                          ...f,
                          wholesaleProfitPct: e.target.value,
                          wholesalePrice:
                            e.target.value !== '' && cost > 0
                              ? priceFromPct(toN(e.target.value), cost).toFixed(2)
                              : f.wholesalePrice,
                        };
                      })
                    }
                  />
                  <Input
                    label="Retail Price"
                    type="number"
                    id="pf-retail"
                    onBlur={blur2('retailPrice')}
                    onKeyDown={enterTo('pf-retail-pct')}
                    min={0}
                    step="any"
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
                    id="pf-retail-pct"
                    onBlur={blur2('retailProfitPct')}
                    step="any"
                    value={form.retailProfitPct}
                    onChange={(e) =>
                      setForm((f) => {
                        const cost = toN(f.costPrice);
                        return {
                          ...f,
                          retailProfitPct: e.target.value,
                          retailPrice:
                            e.target.value !== '' && cost > 0
                              ? priceFromPct(toN(e.target.value), cost).toFixed(2)
                              : f.retailPrice,
                        };
                      })
                    }
                  />
                </div>
              </div>
            )}

            {/* Discount matrix — sellable products only, straight after the
                prices it discounts. */}
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

            {/* Capabilities (Has Recipe / Has Packing / Can Sell) live in one
                block higher up, above the selling fields. "Can be Ingredient"
                stays hidden and forced off — a packed product is never consumed
                as an ingredient (see `empty` / `formFrom`). */}

            {/* Production schedule — fixed weekdays, so they live in code. */}
            <div className="flex flex-col gap-2 sm:col-span-2">
              <span className="label !mb-0">Production schedule</span>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                {PRODUCTION_DAYS.map((d) => (
                  <Checkbox
                    key={d.key}
                    label={d.label}
                    checked={form[d.key]}
                    onChange={(e) => setForm({ ...form, [d.key]: e.target.checked })}
                  />
                ))}
                {/* Made to order: no fixed day, so it is set apart from them. */}
                <span className="mx-1 hidden h-5 w-px bg-slate-200 dark:bg-slate-700 sm:inline-block" />
                <Checkbox
                  label="Occasional"
                  checked={form.prodOccasional}
                  onChange={(e) =>
                    setForm({ ...form, prodOccasional: e.target.checked })
                  }
                />
              </div>
            </div>

            {/* Delivery Schedule — trips come from the Inventory lookup, so they
                can be renamed or added to without a code change. */}
            <div className="flex flex-col gap-2 sm:col-span-2">
              <span className="label !mb-0">Delivery Schedule</span>
              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
                {tripValues.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    No delivery trips defined — add them under Inventory &gt; Lookups
                    (Delivery Trip).
                  </p>
                ) : (
                  tripValues.map((t) => (
                    <Checkbox
                      key={t.id}
                      label={t.alias || t.label}
                      checked={form.deliveryTripIds.includes(t.id)}
                      onChange={() => toggleTrip(t.id)}
                    />
                  ))
                )}
              </div>
            </div>

            {/* Companies — replaces the old flat "Availability" list: which
                companies make and/or sell this, each with the cost centre its
                production, purchases and sales here are traced against. */}
            <ProductCompanies
              companies={companyList}
              costCenters={costCenters ?? []}
              costObjects={costObjects ?? []}
              value={form.companies}
              onChange={(companies) => setForm((f) => ({ ...f, companies }))}
              hasRecipe={form.hasRecipe}
              hasPacking={form.hasPacking}
            />

            {/* Per-branch stock levels — one row per active branch of every
                company this product is available in. New branches appear here
                automatically (rendered from the live branch list). */}
            <div className="flex flex-col gap-2 sm:col-span-2">
              <span className="label !mb-0">Branch Stock Levels</span>
              <p className="text-xs text-slate-400">
                Minimum / maximum stock, reorder level and lead time (days) per
                branch. New branches are added here automatically.
              </p>
              {branchGroups.length === 0 ? (
                <p className="rounded-lg border border-dashed border-slate-200 p-3 text-sm text-slate-400 dark:border-slate-700">
                  No branches to configure yet — tick the companies that make or
                  sell this product above, and their active branches appear
                  here.
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

            <div className="sm:col-span-2">
              <Checkbox
                label="Active"
                checked={form.isActive}
                onChange={(e) =>
                  setForm({ ...form, isActive: e.target.checked })
                }
              />
            </div>

            <Textarea
              label="Description"
              value={form.description}
              onChange={(e) =>
                setForm({ ...form, description: e.target.value })
              }
              wrapClassName="sm:col-span-2"
            />
          </div>
        </ReadOnlyFieldset>
      </Drawer>
    </div>
  );
}
