/**
 * Screens shipped by the Workplace module (module code WORKFLOW — the approval
 * engine keeps its name, only the user-facing label changed).
 *
 * The module's surface is grouped by the KIND of thing waiting for a person
 * rather than by which subsystem serves it: documents to decide on, messages,
 * tasks, circulars, broadcasts. That is why the approval inbox sits under
 * Documents next to a review list it shares no code with, and why Chat sits
 * with mail it shares none with either.
 *
 * The engine's own *setup* stays in Cpanel (Workflow Setup, see CPANEL_SUBS).
 *
 * Consumed by the module scaffold registry (module-scaffold.ts); routes match
 * the frontend page paths + privilege keys. Screens not yet built are listed
 * here anyway so the menu, the Object Master row and the privilege matrix all
 * exist for an admin to grant against before the screen lands.
 */

/**
 * Documents — the module's PRIMARY menu, so the sync reuses the existing main
 * menu row rather than creating a second one beside it (a primary is matched by
 * module, an extra by name). The one-time rename in scaffold.sync.ts relabels
 * that row; without it, an existing database would keep saying "Workplace".
 */
export const WORKFLOW_SUBS = [
  {
    // The approval inbox, built. Route deliberately unchanged: SubMenu and
    // ObjectMaster rows are keyed by it, privileges and workflow bindings hang
    // off their ids, and the Topbar's notification bell links straight to it.
    // Renaming the path would buy a tidier URL and risk all three.
    name: 'For Approval',
    route: '/workflow/approvals',
    icon: 'inbox',
    order: 1,
  },
  {
    name: 'For Review',
    route: '/workplace/documents/for-review',
    icon: 'eye',
    order: 2,
  },
];

/**
 * The rest of the Workplace menus. Extra menus are matched by NAME, so renaming
 * one here without a migration would leave the old menu (and every privilege on
 * its screens) behind and create an empty twin.
 */
export const WORKFLOW_EXTRA_MENUS = [
  {
    /**
     * The module's overview, and the page a login LANDS on — Workplace is the
     * landing module for everybody (see grantWorkplaceToEveryone), so this is
     * the first screen of the working day.
     *
     * It sits in a menu of its own rather than under Documents because it is not
     * a kind of thing waiting for anybody: it is the view OF everything waiting.
     * The `workplace-dashboard-first` migration in scaffold.sync puts it at the
     * top of the module, which is also what makes it the landing route (the nav
     * takes the first item of the first menu).
     */
    name: 'My Day',
    icon: 'layout-dashboard',
    subs: [
      {
        name: 'Dashboard',
        route: '/workplace/dashboard',
        icon: 'layout-dashboard',
        order: 1,
      },
    ],
  },
  {
    name: 'Communication',
    icon: 'mail',
    subs: [
      {
        name: 'New Mail',
        route: '/workplace/mail/new',
        icon: 'pencil-line',
        order: 1,
      },
      {
        name: 'Inbox',
        route: '/workplace/mail/inbox',
        icon: 'inbox',
        order: 2,
      },
      {
        // Mail started and not sent. Sits between Inbox and Sent, where every
        // mail client has put it: a draft is on its way OUT, and the eye goes
        // down the list in the order a letter travels. Circulars and broadcasts
        // keep their drafts on a tab of their own view screen instead; mail gets
        // a menu entry, because a mailbox is where somebody looks for an
        // unfinished letter.
        name: 'Drafts',
        route: '/workplace/mail/drafts',
        icon: 'file-minus',
        order: 3,
      },
      { name: 'Sent', route: '/workplace/mail/sent', icon: 'send', order: 4 },
      {
        // Built. Moved here from the old Workplace menu by the migration.
        name: 'Chat',
        route: '/workplace/chat',
        icon: 'message-circle',
        order: 5,
      },
      {
        // Alerts (FR-COM-05). Under Communication because that is where the SRS
        // puts it — the Communication Suite covers mail, chat, broadcasts,
        // circulars AND alerts — and because a menu of its own for one screen
        // would be a heading with nothing under it. What arrives here is not
        // written by anybody: it is raised by things happening. The bell in the
        // topbar is the same feed, shortened.
        name: 'Alerts',
        route: '/workplace/alerts',
        icon: 'bell',
        order: 6,
        // These three are what the list is filtered TO, not separate sections —
        // declared all the same, so an admin can narrow a group to the alerts
        // still waiting on them rather than the whole history.
        tabs: [
          { key: 'live', label: 'Waiting', order: 1 },
          { key: 'unread', label: 'Unread', order: 2 },
          { key: 'cleared', label: 'Cleared', order: 3 },
        ],
      },
    ],
  },
  {
    name: 'Tasks',
    icon: 'clipboard-list',
    subs: [
      {
        name: 'Assigned by Me',
        route: '/workplace/tasks/assigned-by-me',
        icon: 'forward',
        order: 1,
      },
      {
        name: 'Assigned to Me',
        route: '/workplace/tasks/assigned-to-me',
        icon: 'clipboard-check',
        order: 2,
      },
      {
        // FR-TSK-02. The SCHEDULES, not the checklists under way — an occurrence
        // is an ordinary task and appears on the two boards above, which is why
        // this sits beside them rather than in a module of its own.
        name: 'Recurring Checklists',
        route: '/workplace/tasks/checklists',
        icon: 'repeat',
        order: 3,
      },
    ],
  },
  {
    name: 'Circulars',
    icon: 'book-open',
    subs: [
      {
        name: 'Send Circular',
        route: '/workplace/circulars/send',
        icon: 'send',
        order: 1,
      },
      {
        name: 'View Circulars',
        route: '/workplace/circulars/view',
        icon: 'list',
        order: 2,
      },
    ],
  },
  {
    name: 'Broadcast',
    icon: 'megaphone',
    subs: [
      {
        name: 'Send Broadcast',
        route: '/workplace/broadcast/send',
        icon: 'send',
        order: 1,
      },
      {
        name: 'View Broadcasts',
        route: '/workplace/broadcast/view',
        icon: 'list',
        order: 2,
      },
    ],
  },
];
