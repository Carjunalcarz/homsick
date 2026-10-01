import type { Metadata } from "next";
import { PageTitle } from "@/components/page-title";

export const metadata: Metadata = {
  title: "Directory",
};

export default function DirectoryPage() {
  return (
    <PageTitle
      title="Directory"
      description="The Doctors and Departments directory, with duty days, arrives in a later story."
    />
  );
}
