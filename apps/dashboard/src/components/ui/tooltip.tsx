import { createPortal } from "react-dom";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

type TooltipPosition = {
  readonly left: number;
  readonly top: number;
};

function Tooltip({
  children,
  content,
}: {
  readonly children: ReactNode;
  readonly content: string;
}) {
  const trigger = useRef<HTMLSpanElement>(null);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tooltipId = useId();
  const [position, setPosition] = useState<TooltipPosition | null>(null);

  const show = (): void => {
    if (timeout.current !== null) clearTimeout(timeout.current);
    timeout.current = setTimeout(() => {
      const bounds = trigger.current?.getBoundingClientRect();
      if (bounds === undefined) return;
      const maxWidth = Math.min(512, window.innerWidth - 32);
      setPosition({
        left: Math.max(16, Math.min(bounds.left, window.innerWidth - maxWidth - 16)),
        top: bounds.bottom + 8,
      });
    }, 500);
  };

  const hide = (): void => {
    if (timeout.current !== null) clearTimeout(timeout.current);
    timeout.current = null;
    setPosition(null);
  };

  useEffect(
    () => () => {
      if (timeout.current !== null) clearTimeout(timeout.current);
    },
    [],
  );

  return (
    <span
      aria-describedby={position === null ? undefined : tooltipId}
      className="block min-w-0"
      onBlur={hide}
      onFocus={show}
      onMouseEnter={show}
      onMouseLeave={hide}
      ref={trigger}
    >
      {children}
      {position !== null &&
        createPortal(
          <span
            className="pointer-events-none fixed z-50 max-w-[min(32rem,calc(100vw-2rem))] whitespace-normal break-words border border-border bg-background px-2 py-1 text-xs leading-5 text-foreground shadow-lg"
            id={tooltipId}
            role="tooltip"
            style={{ left: position.left, top: position.top }}
          >
            {content}
          </span>,
          document.body,
        )}
    </span>
  );
}

export { Tooltip };
