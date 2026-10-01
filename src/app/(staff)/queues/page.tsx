import type { Metadata } from "next";
import { PageTitle } from "@/components/page-title";

export const metadata: Metadata = {
  title: "Queues",
};

export default function QueuesPage() {
  return (
    <PageTitle
      title="Queues"
      description="Live Facility queues, with calling and serving patients, arrive in a later story."
    />
  );
}
