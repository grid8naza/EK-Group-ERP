'use client';

import { ClipboardList } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';

/**
 * Sales Orders — reserved for orders converted from approved purchase orders
 * (after a quantity check). That conversion step isn't built yet, so this screen
 * is a placeholder. Purchase orders themselves — including ones routed to an
 * approver for action — now live under "Purchase Order - IC".
 */
export default function SalesOrdersPage() {
  return (
    <div className="mx-auto flex h-full max-w-6xl flex-col">
      <PageHeader
        title="Sales Orders"
        description="Orders converted from approved purchase orders"
        icon={<ClipboardList className="h-5 w-5" />}
      />
      <div className="mt-10 flex flex-1 items-start justify-center">
        <div className="max-w-md rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center dark:border-slate-700 dark:bg-slate-900/40">
          <ClipboardList className="mx-auto h-8 w-8 text-slate-400" />
          <h2 className="mt-3 text-base font-semibold text-slate-700 dark:text-slate-200">
            No sales orders yet
          </h2>
          <p className="mt-2 text-sm text-slate-500">
            Approved purchase orders will be converted into sales orders here
            after the quantity check. Until then, review and act on purchase
            orders under <span className="font-medium">Purchase Order - IC</span>.
          </p>
        </div>
      </div>
    </div>
  );
}
