"use client"; // Error boundaries must be Client Components

import { useEffect } from "react";

export default function Error({
  error,
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main className="flex flex-1 items-center justify-center px-6 py-16 sm:px-10">
      <div className="w-full max-w-xl text-center sm:text-left">
        <h1 className="font-mono text-4xl font-semibold tracking-tight sm:text-5xl">
          Something went wrong
        </h1>
        <p className="mt-4 text-lg leading-relaxed text-muted-foreground">
          An unexpected error occurred. Please try again.
        </p>
        <button
          type="button"
          onClick={() => retry()}
          className="mt-8 inline-flex h-11 cursor-pointer items-center rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-colors duration-200 hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
