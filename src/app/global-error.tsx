"use client"; // Error boundaries must be Client Components

// Replaces the root layout when it fails, so it renders its own <html>/<body>
// and cannot rely on globals.css or the layout's fonts.
export default function GlobalError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          fontFamily: "system-ui, sans-serif",
          colorScheme: "light dark",
        }}
      >
        <title>Something went wrong | OPD</title>
        <main style={{ padding: "1.5rem", textAlign: "center" }}>
          <h1 style={{ fontSize: "1.75rem", fontWeight: 600 }}>
            Something went wrong
          </h1>
          <p>An unexpected error occurred. Please try again.</p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              minHeight: "44px",
              padding: "0 1.25rem",
              cursor: "pointer",
              fontSize: "1rem",
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
