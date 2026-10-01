import { CircleAlert, CircleDot, Siren, TriangleAlert } from "lucide-react";
import type { UrgencyTone } from "@/lib/triage";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<UrgencyTone, string> = {
  urgent: "border-urgent/60 text-urgent",
  abnormal: "border-abnormal/60 text-abnormal",
  routine: "border-routine/60 text-routine",
};

const TONE_ICON = { urgent: CircleAlert, abnormal: TriangleAlert, routine: CircleDot } as const;

/**
 * An Urgency Level as an outlined pill: color from the rank (DESIGN tokens
 * `urgent`, `abnormal`, `routine`), always with an icon and the level's name.
 */
export function UrgencyBadge({
  name,
  tone,
  isEr = false,
  className,
}: {
  name: string;
  tone: UrgencyTone;
  isEr?: boolean;
  className?: string;
}) {
  const Icon = isEr ? Siren : TONE_ICON[tone];
  return (
    <span
      className={cn(
        "inline-flex h-6 items-center gap-1 rounded-full border bg-card px-2.5 text-xs font-medium",
        TONE_CLASS[tone],
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">Urgency: </span>
      {name}
    </span>
  );
}
