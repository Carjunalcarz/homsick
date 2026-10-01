import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FORBIDDEN_TITLE } from "@/components/forbidden";
import { formatQueueNumber, SLIP_MARKER_ATTRIBUTE, SLIP_WAIT_LINE } from "@/lib/queue-number";
import { formatSlipDateTime } from "@/lib/time";
import { requirePermission } from "@/server/auth/permissions";
import { getSlip } from "@/server/queue/queries";
import { hospitalName } from "@/server/settings/queries";
import styles from "./slip.module.css";

/** Shared with the triage banner's hidden iframe, which checks it loaded the slip and not an error page. */
const SLIP_MARKER = { [SLIP_MARKER_ATTRIBUTE]: "" };

/** Longer than any id the app makes (text UUIDs): not worth a query. */
const ENTRY_ID_MAX = 64;

export async function generateMetadata(): Promise<Metadata> {
  const { allowed } = await requirePermission("triage.record");
  return { title: allowed ? "Queue slip" : FORBIDDEN_TITLE };
}

/**
 * The printable queue slip (Story 3.6, FR-8, UX-DR17), outside the staff
 * shell: no header, no session guard, no skip link. The triage banner loads
 * it in a hidden iframe and prints it. It shows the hospital name, the
 * Facility, the Queue Number, when it was issued and the wait line, and
 * nothing about the patient, so it is not audited. Signed-out requests are
 * sent to sign-in (proxy + requireStaff).
 */
export default async function QueueSlipPage({ params }: { params: Promise<{ entryId: string }> }) {
  const { allowed } = await requirePermission("triage.record");
  // Decide before reading anything: a denied user gets no data.
  if (!allowed) {
    return (
      <main className={styles.page}>
        <h1 className={styles.denied}>You don&apos;t have access to this page.</h1>
      </main>
    );
  }

  const { entryId } = await params;
  const slip = entryId.length <= ENTRY_ID_MAX ? getSlip(entryId) : null;
  if (!slip) notFound();

  return (
    <main className={styles.page}>
      <article className={styles.slip} {...SLIP_MARKER}>
        <h1 className="sr-only">Queue slip</h1>
        <p className={styles.hospital}>{hospitalName()}</p>
        <p className={styles.facility}>{slip.facilityName}</p>
        <p className={styles.number}>{formatQueueNumber(slip.prefix, slip.seq)}</p>
        <p className={styles.when}>{formatSlipDateTime(slip.enteredAt)}</p>
        <p className={styles.wait}>{SLIP_WAIT_LINE}</p>
      </article>
    </main>
  );
}
