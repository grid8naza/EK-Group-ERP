/**
 * Module-boundary enforcement for the modular monolith.
 *
 * The rules below make "highly isolated, independently extractable modules" a
 * BUILD-TIME guarantee instead of a convention people remember on good days.
 *
 * Run: `npm run lint:boundaries`
 */
module.exports = {
  forbidden: [
    {
      name: 'no-cross-module-imports',
      severity: 'error',
      comment:
        'A feature module must not import another feature module directly. ' +
        'Cross-module communication goes through src/contracts (ports), so each ' +
        'module stays independently extractable. See src/contracts/README.md.',
      from: { path: '^src/modules/([^/]+)/' },
      to: {
        path: '^src/modules/([^/]+)/',
        // Allow imports WITHIN the same module ($1 = the module name captured
        // in `from.path`); forbid imports into any OTHER module.
        pathNot: '^src/modules/$1/',
      },
    },
    {
      name: 'no-circular',
      severity: 'error',
      comment:
        'Circular dependencies couple modules into a unit that cannot be split. ' +
        'Break the cycle (often via a contracts port or an event).',
      from: {},
      to: { circular: true },
    },
    {
      name: 'contracts-stay-pure',
      severity: 'error',
      comment:
        'src/contracts holds ports (interfaces + tokens + plain types) and the ' +
        'composition root only. A *.port.ts file must not import feature modules ' +
        'or Prisma — keep ports free of implementation so a remote adapter can ' +
        'drop in. (contracts.module.ts is the one allowed exception: it binds ' +
        'tokens to adapters.)',
      from: { path: '^src/contracts/.+\\.port\\.ts$' },
      to: { path: '^(src/modules/|src/prisma/|node_modules/@prisma)' },
    },
  ],
  options: {
    tsConfig: { fileName: 'tsconfig.json' },
    tsPreCompilationDeps: true,
    doNotFollow: { path: 'node_modules' },
    exclude: { path: '(^|/)node_modules/' },
  },
};
