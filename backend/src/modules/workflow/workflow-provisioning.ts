/**
 * Screens shipped by the Workflow module. The engine's *setup* lives in Cpanel
 * (Workflow Setup, see CPANEL_SUBS); this module hosts the end-user runtime
 * surface — the approver inbox. Consumed by the module scaffold registry
 * (module-scaffold.ts); routes match the frontend page paths + privilege keys.
 */
export const WORKFLOW_SUBS = [
  {
    name: 'My Approvals',
    route: '/workflow/approvals',
    icon: 'inbox',
    order: 1,
  },
];
