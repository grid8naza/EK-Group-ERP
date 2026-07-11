/** Global software / licence information (singleton). */
export interface SoftwareInfo {
  id?: number;
  companyName?: string | null;
  address?: string | null;
  email?: string | null;
  contactNumber?: string | null;
  softwareName?: string | null;
  softwareVersion?: string | null;
  licenceKey?: string | null;
  /** ISO date string (yyyy-mm-dd or full ISO). */
  subscriptionExpiry?: string | null;
  logoUrl?: string | null;
  /** Symbol-only mark shown when the sidebar is collapsed. */
  symbolLogoUrl?: string | null;
  /** Displayed brand-logo size in px (null = default 36). */
  logoSize?: number | null;
  /** Displayed symbol-logo size in px (null = default 36). */
  symbolLogoSize?: number | null;
}

/** Default and bounds for the brand-logo size control. */
export const LOGO_SIZE_DEFAULT = 36;
export const LOGO_SIZE_MIN = 16;
export const LOGO_SIZE_MAX = 56;
