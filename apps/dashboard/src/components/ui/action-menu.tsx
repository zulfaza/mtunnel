import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { Ellipsis } from "lucide-react";
import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/utils.js";
import { Button } from "./button.js";

function ActionMenu({ children, label }: { readonly children: ReactNode; readonly label: string }) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button aria-label={label} size="icon" title={label} variant="ghost">
          <Ellipsis />
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          className="z-50 min-w-40 border border-border bg-background p-1 shadow-lg"
          sideOffset={4}
        >
          {children}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function ActionMenuItem({
  className,
  destructive = false,
  ...props
}: ComponentProps<typeof DropdownMenu.Item> & { readonly destructive?: boolean }): ReactNode {
  return (
    <DropdownMenu.Item
      className={cn(
        "flex cursor-default select-none items-center gap-2 px-2 py-1.5 text-xs outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0",
        destructive
          ? "text-destructive focus:bg-destructive/10"
          : "text-muted-foreground focus:bg-muted focus:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

export { ActionMenu, ActionMenuItem };
