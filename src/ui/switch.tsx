import { Switch as SwitchPrimitive, SwitchThumb } from "@ui-sdk/react/switch";
import { cn } from "cn";

export type SwitchProps = {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  id?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  title?: string;
};

/** Token-styled switch: 36x20 track, 16px thumb. */
export function Switch({ checked, onCheckedChange, ...rest }: SwitchProps) {
  return (
    <SwitchPrimitive
      checked={checked}
      data-state={checked ? "checked" : "unchecked"}
      onCheckedChange={onCheckedChange}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 motion-reduce:transition-none",
        checked
          ? "bg-primary"
          : "bg-foreground/15 hover:bg-foreground/20 dark:bg-white/15 dark:hover:bg-white/20",
      )}
      {...rest}
    >
      <SwitchThumb
        aria-hidden
        className={cn(
          "pointer-events-none absolute top-0.5 left-0.5 size-4 rounded-full shadow-xs transition-transform duration-150 motion-reduce:transition-none",
          checked
            ? "translate-x-4 bg-primary-foreground"
            : "bg-white ring-1 ring-foreground/10 dark:bg-white/90 dark:ring-0",
        )}
      />
    </SwitchPrimitive>
  );
}
