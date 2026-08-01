import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/utils.js";

function Input({ className, type, ...props }: ComponentProps<"input">): ReactNode {
  return (
    <input
      className={cn(
        "flex h-7 w-full border border-input bg-background px-2 text-[13px] text-foreground placeholder:text-muted-foreground focus-visible:outline focus-visible:outline-1 focus-visible:-outline-offset-1 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
      type={type}
      {...props}
    />
  );
}

export { Input };
