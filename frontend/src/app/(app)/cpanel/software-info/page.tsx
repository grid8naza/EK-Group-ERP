'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Info, Upload, ImageOff, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/providers/AuthProvider';
import { useToast } from '@/providers/ToastProvider';
import { useSoftwareInfo } from '@/providers/SoftwareInfoProvider';
import { PageHeader } from '@/components/ui/PageHeader';
import { Input, Textarea } from '@/components/ui/Field';
import { mediaUrl } from '@/lib/login-screen';
import {
  LOGO_SIZE_DEFAULT,
  LOGO_SIZE_MAX,
  LOGO_SIZE_MIN,
  type SoftwareInfo,
} from '@/lib/software-info';

const ROUTE = '/cpanel/software-info';

/** Normalize an ISO datetime to the yyyy-mm-dd a date input expects. */
const toDateInput = (iso?: string | null) => (iso ? iso.slice(0, 10) : '');

export default function SoftwareInfoPage() {
  const router = useRouter();
  const { can } = useAuth();
  const toast = useToast();
  const { refresh } = useSoftwareInfo();
  const readOnly = !can(ROUTE, 'edit');

  const [form, setForm] = useState<SoftwareInfo>({});
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [logoSize, setLogoSize] = useState<number>(LOGO_SIZE_DEFAULT);
  const [logoBroken, setLogoBroken] = useState(false);

  const close = () => router.back();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = async () => {
    try {
      const data = await api.get<SoftwareInfo>('/software-info');
      setForm({
        companyName: data.companyName ?? '',
        address: data.address ?? '',
        email: data.email ?? '',
        contactNumber: data.contactNumber ?? '',
        softwareName: data.softwareName ?? '',
        softwareVersion: data.softwareVersion ?? '',
        licenceKey: data.licenceKey ?? '',
        subscriptionExpiry: toDateInput(data.subscriptionExpiry),
      });
      setLogoUrl(data.logoUrl ?? null);
      setLogoSize(data.logoSize ?? LOGO_SIZE_DEFAULT);
      setLogoBroken(false);
    } catch {
      toast.error('Failed to load software information.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patch = (p: Partial<SoftwareInfo>) => setForm((f) => ({ ...f, ...p }));

  const save = async () => {
    setSaving(true);
    try {
      await api.put('/software-info', {
        companyName: form.companyName?.trim() || null,
        address: form.address?.trim() || null,
        email: form.email?.trim() || null,
        contactNumber: form.contactNumber?.trim() || null,
        softwareName: form.softwareName?.trim() || null,
        softwareVersion: form.softwareVersion?.trim() || null,
        licenceKey: form.licenceKey?.trim() || null,
        subscriptionExpiry: form.subscriptionExpiry || null,
        logoSize,
      });
      toast.success('Software information saved.');
      await refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to save.');
    } finally {
      setSaving(false);
    }
  };

  const onPickLogo = async (file: File) => {
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const res = await api.post<SoftwareInfo>('/software-info/logo', fd);
      setLogoUrl(res.logoUrl ?? null);
      setLogoBroken(false);
      toast.success('Logo updated.');
      await refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? e.message : 'Failed to upload logo.');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        title="Software Information"
        description="Licence & branding shown as the app's top-left tile"
        icon={<Info className="h-5 w-5" />}
        actions={
          <button className="btn-secondary" onClick={close}>
            <X className="h-4 w-4" /> Close
          </button>
        }
      />

      <div className="card border-[#e7ddcb] bg-[#fbf9f4] p-6 dark:border-slate-800 dark:bg-slate-900">
        {loading ? (
          <p className="py-8 text-center text-sm text-slate-400">Loading…</p>
        ) : (
          <div className="space-y-6">
            {/* Logo */}
            <div className="flex items-start gap-4">
              <div className="flex h-24 w-24 flex-none items-center justify-center overflow-hidden rounded-xl border border-[#e7ddcb] bg-white dark:border-slate-700 dark:bg-slate-800">
                {logoUrl && !logoBroken ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={mediaUrl(logoUrl)}
                    alt="Logo"
                    onError={() => setLogoBroken(true)}
                    // Preview at the chosen brand size so the effect is visible
                    // before saving.
                    style={{ height: logoSize, width: logoSize }}
                    className="object-contain"
                  />
                ) : (
                  <ImageOff className="h-7 w-7 text-slate-300" />
                )}
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-200">
                  Logo
                </p>
                <p className="mb-2 text-xs text-slate-400">
                  PNG / JPG / WEBP / SVG, up to 5 MB.
                </p>
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onPickLogo(f);
                  }}
                />
                <button
                  type="button"
                  className="btn-secondary text-sm"
                  disabled={readOnly || uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  <Upload className="h-4 w-4" />
                  {uploading ? 'Uploading…' : 'Upload logo'}
                </button>

                {/* Brand-logo display size */}
                <div className="mt-3 flex items-center gap-3">
                  <label className="text-xs font-medium text-slate-500">
                    Logo size
                  </label>
                  <input
                    type="range"
                    min={LOGO_SIZE_MIN}
                    max={LOGO_SIZE_MAX}
                    value={logoSize}
                    disabled={readOnly}
                    onChange={(e) => setLogoSize(Number(e.target.value))}
                    className="w-40 accent-brand-600"
                  />
                  <span className="w-10 text-xs tabular-nums text-slate-500">
                    {logoSize}px
                  </span>
                </div>
              </div>
            </div>

            {/* Fields */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Input
                label="Company name"
                wrapClassName="sm:col-span-2"
                value={form.companyName ?? ''}
                disabled={readOnly}
                onChange={(e) => patch({ companyName: e.target.value })}
                placeholder="Licensee / vendor company"
              />
              <Textarea
                label="Address"
                wrapClassName="sm:col-span-2"
                value={form.address ?? ''}
                disabled={readOnly}
                onChange={(e) => patch({ address: e.target.value })}
                placeholder="Company address"
              />
              <Input
                label="Email"
                type="email"
                value={form.email ?? ''}
                disabled={readOnly}
                onChange={(e) => patch({ email: e.target.value })}
                placeholder="name@company.com"
              />
              <Input
                label="Contact number"
                value={form.contactNumber ?? ''}
                disabled={readOnly}
                onChange={(e) => patch({ contactNumber: e.target.value })}
                placeholder="e.g. +91 98765 43210"
              />
              <Input
                label="Software name"
                value={form.softwareName ?? ''}
                disabled={readOnly}
                onChange={(e) => patch({ softwareName: e.target.value })}
                placeholder="e.g. Grid8 ERP"
              />
              <Input
                label="Software version"
                value={form.softwareVersion ?? ''}
                disabled={readOnly}
                onChange={(e) => patch({ softwareVersion: e.target.value })}
                placeholder="e.g. 1.0.0"
              />
              <Input
                label="Subscription expiry"
                type="date"
                value={form.subscriptionExpiry ?? ''}
                disabled={readOnly}
                onChange={(e) => patch({ subscriptionExpiry: e.target.value })}
              />
              <Input
                label="Licence key"
                value={form.licenceKey ?? ''}
                disabled={readOnly}
                onChange={(e) => patch({ licenceKey: e.target.value })}
                placeholder="Licence / activation key"
              />
            </div>

            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={close} disabled={saving}>
                Close
              </button>
              {!readOnly && (
                <button className="btn-primary" onClick={save} disabled={saving}>
                  {saving ? 'Saving…' : 'Save'}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
