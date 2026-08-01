import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/utils.js";

function Table({ className, ...props }: ComponentProps<"table">): ReactNode {
  return (
    <div className="w-full overflow-x-auto border border-border-soft">
      <table className={cn("w-full caption-bottom text-[13px]", className)} {...props} />
    </div>
  );
}

function TableHeader({ className, ...props }: ComponentProps<"thead">): ReactNode {
  return <thead className={cn("bg-muted", className)} {...props} />;
}

function TableBody({ className, ...props }: ComponentProps<"tbody">): ReactNode {
  return <tbody className={className} {...props} />;
}

function TableRow({ className, ...props }: ComponentProps<"tr">): ReactNode {
  return (
    <tr
      className={cn("border-b border-border-soft transition-colors last:border-b-0", className)}
      {...props}
    />
  );
}

function TableHead({ className, ...props }: ComponentProps<"th">): ReactNode {
  return (
    <th
      className={cn(
        "h-9 whitespace-nowrap border-b border-border-soft px-3 text-left text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TableCell({ className, ...props }: ComponentProps<"td">): ReactNode {
  return <td className={cn("px-3 py-2 align-middle", className)} {...props} />;
}

export { Table, TableBody, TableCell, TableHead, TableHeader, TableRow };
