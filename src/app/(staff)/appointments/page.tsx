import type { Metadata } from "next";
import { PageTitle } from "@/components/page-title";

export const metadata: Metadata = {
  title: "Appointments",
};

export default function AppointmentsPage() {
  return (
    <PageTitle
      title="Appointments"
      description="Booking appointments and follow-ups arrives in a later story."
    />
  );
}
