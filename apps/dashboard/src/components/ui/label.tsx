import * as LabelPrimitive from "@radix-ui/react-label";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/utils.js";

function Label({ className, ...props }: ComponentProps<typeof LabelPrimitive.Root>): ReactNode {
  return (
    <LabelPrimitive.Root
      className={cn(
        "text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { Label };
