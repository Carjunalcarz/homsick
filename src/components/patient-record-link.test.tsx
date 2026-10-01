// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const linkProps = vi.hoisted(() => [] as Record<string, unknown>[]);

vi.mock("next/link", () => ({
  default: (props: Record<string, unknown> & { href: string; children?: React.ReactNode }) => {
    linkProps.push(props);
    return <a href={props.href}>{props.children}</a>;
  },
}));

const { PatientRecordLink } = await import("./patient-record-link");
const { patientRecordPath } = await import("@/lib/patient-links");

afterEach(() => {
  cleanup();
  linkProps.length = 0;
});

describe("patientRecordPath", () => {
  it("is /patients/<id>, with the id encoded", () => {
    expect(patientRecordPath("ea8d76c2-bc98-4d9c-b853-1a37095e4819")).toBe("/patients/ea8d76c2-bc98-4d9c-b853-1a37095e4819");
    expect(patientRecordPath("a/b c")).toBe("/patients/a%2Fb%20c");
  });
});

describe("PatientRecordLink", () => {
  it("links to the record and never prefetches", () => {
    render(
      // A caller can't turn prefetching back on (the prop isn't accepted; forced here to check).
      <PatientRecordLink patientId="p-1" className="x" {...({ prefetch: true } as object)}>
        DELA CRUZ, Juan
      </PatientRecordLink>,
    );
    expect(linkProps).toHaveLength(1);
    expect(linkProps[0]).toMatchObject({ href: "/patients/p-1", prefetch: false, className: "x" });
  });
});
