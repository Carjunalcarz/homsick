import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Hospital } from "lucide-react";
import { safeNextPath } from "@/lib/safe-next";
import { getStaff } from "@/server/auth/session";
import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = {
  title: "Sign in",
};

export default async function SignInPage({ searchParams }: PageProps<"/sign-in">) {
  const { next } = await searchParams;
  const nextPath = safeNextPath(Array.isArray(next) ? next[0] : next);

  // Already signed in: go straight on.
  if (await getStaff()) redirect(nextPath);

  return (
    <main
      id="content"
      className="flex min-h-full flex-1 items-center justify-center bg-background px-4 py-12"
    >
      <div className="w-full max-w-sm rounded-lg border border-border bg-card p-6 shadow-sm sm:p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded bg-primary text-primary-foreground">
            <Hospital className="size-6" aria-hidden="true" />
          </span>
          <div>
            <h1 className="text-2xl font-light tracking-tight">Sign in</h1>
            <p className="mt-1 text-sm text-muted-foreground">Hospital OPD</p>
          </div>
        </div>
        <SignInForm next={nextPath} />
      </div>
    </main>
  );
}
