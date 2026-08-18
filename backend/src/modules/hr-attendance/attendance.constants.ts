import { AttendanceSheetStatus } from '@prisma/client';
import { WorkflowStatus } from '../../contracts/workflow.port';

/**
 * The attendance sheet's identity to the rest of the system.
 *
 * The workflow engine matches a definition on (module, object) — the object
 * being the SCREEN the document is raised on — so these two constants are what
 * bind "who may mark, who verifies, who approves" in Cpanel → Workflows to the
 * sheets marked here.
 */
export const HR_MODULE_CODE = 'HR';
export const ATTENDANCE_ROUTE = '/hr/attendance';

/** The lookup the attendance types come from (HR → Lookups). */
export const ATTENDANCE_TYPE_LOOKUP = 'ATTENDANCE_TYPE';

/**
 * The codes the engine itself needs to recognise, out of a list the business
 * otherwise owns.
 *
 * Only these three: the day a sheet is opened it has to be filled in with
 * SOMETHING, and "a normal day", "not due at work this week" and "not due at
 * work today" are the three answers the system can work out for itself. Every
 * other type — which leaves exist, what they are called, whether there is a
 * compensatory off — is the business's, and nothing here reads it.
 */
export const TYPE_PRESENT = 'PRESENT';
export const TYPE_WEEKLY_OFF = 'WEEKLY_OFF';
export const TYPE_HOLIDAY = 'HOLIDAY';

/** Fallback working day, used only until somebody sets the defaults. */
export const FALLBACK_TIME_IN = 9 * 60;
export const FALLBACK_TIME_OUT = 18 * 60;

/**
 * Workflow instance status → the sheet's own status.
 *
 * IN_PROGRESS is SUBMITTED whatever step it has reached: "Verified" and
 * "Approved" are labels the business configures, and the sheet keeps the label
 * beside the status rather than turning each one into a state of its own.
 */
export const STATUS_MAP: Record<WorkflowStatus, AttendanceSheetStatus> = {
  IN_PROGRESS: AttendanceSheetStatus.SUBMITTED,
  APPROVED: AttendanceSheetStatus.APPROVED,
  REJECTED: AttendanceSheetStatus.REJECTED,
  CANCELLED: AttendanceSheetStatus.CANCELLED,
};
