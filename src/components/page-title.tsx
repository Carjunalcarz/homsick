/** Page heading in the reference style: large light title, optional action on the right. */
export function PageTitle({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <h1 className="text-3xl font-light tracking-tight">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Shared classes for the uppercase action buttons (orange, green) of the reference design. */
export const ACTION_BUTTON =
  "inline-flex h-11 cursor-pointer items-center justify-center gap-2 rounded px-5 text-sm font-bold tracking-wide uppercase transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";
