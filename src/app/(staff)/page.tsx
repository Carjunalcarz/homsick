import type { Metadata } from "next";
import { PageTitle } from "@/components/page-title";

export const metadata: Metadata = {
  title: "Overview",
};

export default function OverviewPage() {
  return (
    <PageTitle
      title="Overview"
      description="Today's OPD at a glance, with waiting counts and wait times per Facility, arrives in a later story."
    />
  );
}
