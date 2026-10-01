"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { FIELD, FieldError } from "@/components/form-parts";
import { cn } from "@/lib/utils";

/** A new temporary password with a show/hide toggle. Never prefilled or stored. */
export function PasswordField({
  id,
  value,
  onChange,
  error,
  min,
  max,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  min: number;
  max: number;
}) {
  const [visible, setVisible] = useState(false);
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        Temporary password
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          name="password"
          type={visible ? "text" : "password"}
          autoComplete="new-password"
          spellCheck={false}
          autoCapitalize="off"
          maxLength={max}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={[helpId, error ? errorId : null].filter(Boolean).join(" ")}
          className={cn(FIELD, "font-mono")}
        />
        <button
          type="button"
          aria-controls={id}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
          className="inline-flex h-11 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded border border-input bg-card px-3 text-sm font-medium transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {visible ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
          {visible ? "Hide" : "Show"}
          <span className="sr-only"> password</span>
        </button>
      </div>
      <p id={helpId} className="text-sm text-muted-foreground">
        At least {min} characters. Give it to the person directly; it isn&apos;t shown again.
      </p>
      <FieldError id={errorId} message={error} />
    </div>
  );
}
