/**
 * Customers and suppliers.
 *
 * Keyed on (company, code) — the code is per company (CUS-####, SUP-####), so
 * the same number means a different party in a different company.
 *
 * Each one hangs under a CONTROL ACCOUNT, named here by account code and
 * resolved at seed time. That account must exist AND be adopted by the party's
 * company, which is what the Chart of Accounts seed does; a party whose ledger
 * is not there is skipped and reported rather than pointed at the wrong one.
 */

export interface SeedParty {
  companyId: number;
  code: string;
  name: string;
  /** Chart of Accounts code of the ledger this party is kept under. */
  controlAccountCode: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  gstNumber: string | null;
  address: string | null;
  creditDays: number | null;
  creditLimit: number | null;
  isActive: boolean;
}

export const CUSTOMERS: SeedParty[] = [
  { companyId: 1, code: "CUS-0001", name: "Al Manara Hypermarket LLC", controlAccountCode: "13001", contactPerson: "Rashid Al Mansoori", phone: "+971 4 335 8820", email: "purchase@almanarahyper.ae", gstNumber: "100234567800003", address: "Warehouse 12, Al Quoz Industrial 3, Dubai, UAE", creditDays: 30, creditLimit: 250000, isActive: true },
  { companyId: 1, code: "CUS-0002", name: "Gulf Retail Distribution FZE", controlAccountCode: "13001", contactPerson: "Nadia Haddad", phone: "+971 6 557 1140", email: "orders@gulfretaildist.ae", gstNumber: "100311224500003", address: "Block B, Hamriyah Free Zone, Sharjah, UAE", creditDays: 45, creditLimit: 400000, isActive: true },
  { companyId: 1, code: "CUS-0003", name: "Emirates Catering Services LLC", controlAccountCode: "13002", contactPerson: "Joseph Fernandes", phone: "+971 2 641 9075", email: "supplychain@emiratescatering.ae", gstNumber: "100455998100003", address: "Mussafah M-9, Abu Dhabi, UAE", creditDays: 60, creditLimit: 300000, isActive: true },
  { companyId: 1, code: "CUS-0004", name: "Sunrise International School", controlAccountCode: "13002", contactPerson: "Meera Krishnan", phone: "+971 4 288 3311", email: "accounts@sunriseintl.sch.ae", gstNumber: "100566332200003", address: "Al Garhoud, Dubai, UAE", creditDays: 30, creditLimit: 80000, isActive: true },
  { companyId: 2, code: "CUS-0001", name: "Done Events", controlAccountCode: "13002", contactPerson: null, phone: null, email: null, gstNumber: null, address: null, creditDays: 15, creditLimit: 100000, isActive: true },
  { companyId: 2, code: "CUS-0002", name: "Corniche Cafe and Bakery Outlet", controlAccountCode: "13002", contactPerson: "Samir Qureshi", phone: "+971 50 774 2286", email: "corniche.outlet@gmail.com", gstNumber: "100677441300003", address: "Shop 4, Corniche Road, Ajman, UAE", creditDays: 15, creditLimit: 25000, isActive: true },
  { companyId: 2, code: "CUS-0003", name: "Marina Walk Coffee House", controlAccountCode: "13003", contactPerson: "Layla Sabbagh", phone: "+971 50 662 4471", email: "marinawalk.coffee@gmail.com", gstNumber: "101244007900003", address: "Shop 7, Marina Walk, Dubai, UAE", creditDays: 15, creditLimit: 30000, isActive: true },
  { companyId: 2, code: "CUS-0004", name: "Green Valley Mini Mart", controlAccountCode: "13003", contactPerson: "Rakesh Pillai", phone: "+971 6 745 3092", email: "greenvalley.mart@outlook.com", gstNumber: "101355118000003", address: "Al Nakheel, Ras Al Khaimah, UAE", creditDays: 7, creditLimit: 15000, isActive: true },
];

export const SUPPLIERS: SeedParty[] = [
  { companyId: 1, code: "SUP-0001", name: "Sunrise Tradeders", controlAccountCode: "23001", contactPerson: null, phone: null, email: null, gstNumber: null, address: null, creditDays: null, creditLimit: null, isActive: true },
  { companyId: 1, code: "SUP-0002", name: "Al Waha Flour Mills LLC", controlAccountCode: "23001", contactPerson: "Khalid Bin Sulaiman", phone: "+971 4 883 5510", email: "sales@alwahamills.ae", gstNumber: "100788552400003", address: "Jebel Ali Industrial Area 1, Dubai, UAE", creditDays: 45, creditLimit: 500000, isActive: true },
  { companyId: 1, code: "SUP-0003", name: "Desert Dairy Products Trading", controlAccountCode: "23001", contactPerson: "Anita Varghese", phone: "+971 6 534 6690", email: "orders@desertdairy.ae", gstNumber: "100899663500003", address: "Industrial Area 10, Sharjah, UAE", creditDays: 30, creditLimit: 200000, isActive: true },
  { companyId: 1, code: "SUP-0004", name: "Prime Packaging Industries LLC", controlAccountCode: "23001", contactPerson: "Vikram Shetty", phone: "+971 4 347 2201", email: "info@primepackaging.ae", gstNumber: "100911774600003", address: "Plot 78, Al Quoz Industrial 4, Dubai, UAE", creditDays: 60, creditLimit: 150000, isActive: true },
  { companyId: 1, code: "SUP-0005", name: "Falcon Facility Maintenance Services", controlAccountCode: "23002", contactPerson: "Omar Haidar", phone: "+971 2 555 8123", email: "service@falconfms.ae", gstNumber: "101022885700003", address: "Mussafah M-14, Abu Dhabi, UAE", creditDays: 30, creditLimit: 60000, isActive: true },
  { companyId: 1, code: "SUP-0006", name: "Metro Power and Utilities Services", controlAccountCode: "23003", contactPerson: "Suresh Nair", phone: "+971 4 606 4400", email: "billing@metropowerutils.ae", gstNumber: "101133996800003", address: "Business Bay Tower 2, Dubai, UAE", creditDays: 15, creditLimit: 40000, isActive: true },
  { companyId: 2, code: "SUP-0001", name: "Trinity Traders", controlAccountCode: "23001", contactPerson: null, phone: null, email: null, gstNumber: null, address: null, creditDays: null, creditLimit: null, isActive: true },
  { companyId: 2, code: "SUP-0002", name: "Golden Grain Bakery Supplies LLC", controlAccountCode: "23001", contactPerson: "Imran Sheikh", phone: "+971 6 542 7718", email: "sales@goldengrainsupplies.ae", gstNumber: "101466229100003", address: "Industrial Area 6, Sharjah, UAE", creditDays: 30, creditLimit: 180000, isActive: true },
  { companyId: 2, code: "SUP-0003", name: "Oasis Fresh Produce Trading LLC", controlAccountCode: "23001", contactPerson: "Fatima Al Balushi", phone: "+971 4 320 9964", email: "orders@oasisfresh.ae", gstNumber: "101577330200003", address: "Al Aweer Central Market, Dubai, UAE", creditDays: 15, creditLimit: 90000, isActive: true },
  { companyId: 2, code: "SUP-0004", name: "Crescent Sugar and Confectionery FZC", controlAccountCode: "23001", contactPerson: "Daniel Mathew", phone: "+971 6 526 1130", email: "export@crescentsugar.ae", gstNumber: "101688441300003", address: "Hamriyah Free Zone Phase 2, Sharjah, UAE", creditDays: 45, creditLimit: 260000, isActive: true },
  { companyId: 2, code: "SUP-0005", name: "Skyline Print and Label Solutions LLC", controlAccountCode: "23002", contactPerson: "Hassan Darwish", phone: "+971 6 533 8802", email: "accounts@skylineprint.ae", gstNumber: "101799552400003", address: "Industrial Area 12, Sharjah, UAE", creditDays: 45, creditLimit: 70000, isActive: true },
  { companyId: 2, code: "SUP-0006", name: "Bluewave Cold Chain Logistics LLC", controlAccountCode: "23002", contactPerson: "Priya Menon", phone: "+971 4 885 6120", email: "billing@bluewavecoldchain.ae", gstNumber: "101800663500003", address: "Jebel Ali Free Zone South, Dubai, UAE", creditDays: 30, creditLimit: 120000, isActive: true },
  { companyId: 2, code: "SUP-0007", name: "Emirates Telecom and Internet Services", controlAccountCode: "23003", contactPerson: "Ahmed Zubair", phone: "+971 4 800 5555", email: "corporate.billing@etisservices.ae", gstNumber: "101911774600003", address: "Deira Business Centre, Dubai, UAE", creditDays: 15, creditLimit: 20000, isActive: true },
];
