import type { ComponentProps } from "react";
import { Button as SdkButton } from "@ui-sdk/react/button";
import { Toolbar as SdkToolbar, ToolbarButton as SdkToolbarButton } from "@ui-sdk/react/toolbar";
import { cn } from "cn";

export type ButtonVariant = "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";
export type ButtonSize = "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";

const BUTTON_BASE =
  "inline-flex shrink-0 cursor-pointer items-center justify-center whitespace-nowrap border border-transparent font-medium select-none outline-none transition-colors active:translate-y-px disabled:pointer-events-none disabled:opacity-45 aria-disabled:pointer-events-none aria-disabled:opacity-45 focus-visible:border-ring/80 focus-visible:ring-2 focus-visible:ring-ring/40 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  default: "bg-primary text-primary-foreground shadow-2xs hover:bg-primary/90",
  outline:
    "border-border/80 bg-background/80 hover:bg-muted/70 hover:text-foreground aria-expanded:bg-muted/70 aria-expanded:text-foreground dark:border-white/[0.1] dark:bg-white/[0.03] dark:hover:bg-white/[0.08]",
  secondary:
    "bg-muted/65 text-secondary-foreground hover:bg-muted dark:bg-white/[0.07] dark:hover:bg-white/[0.12]",
  ghost:
    "bg-transparent bg-clip-padding hover:bg-muted/65 hover:text-foreground aria-expanded:bg-muted/65 aria-expanded:text-foreground dark:hover:bg-white/[0.08]",
  destructive:
    "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/15 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/15 dark:hover:bg-destructive/25 dark:focus-visible:ring-destructive/40",
  link: "text-primary underline-offset-4 hover:underline",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  default: "h-8 gap-1.5 rounded-lg px-2.5 text-sm",
  xs: "h-6 gap-1 rounded-md px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
  sm: "h-7 gap-1.5 rounded-lg px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3.5",
  lg: "h-9 gap-1.5 rounded-lg px-3 text-sm",
  icon: "size-8 rounded-lg text-sm",
  "icon-xs": "size-6 rounded-md text-sm [&_svg:not([class*='size-'])]:size-3",
  "icon-sm": "size-7 rounded-lg text-sm [&_svg:not([class*='size-'])]:size-3.5",
  "icon-lg": "size-9 rounded-lg text-sm",
};

export type ButtonProps = Omit<ComponentProps<typeof SdkButton>, "className"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  "data-slot"?: string;
};

/** Styled button primitive built on @ui-sdk/react/button. */
export function Button({
  variant = "default",
  size = "default",
  className,
  "data-slot": dataSlot = "button",
  ...props
}: ButtonProps) {
  return (
    <SdkButton
      data-slot={dataSlot}
      data-variant={variant}
      data-size={size}
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      {...props}
    />
  );
}

const BADGE_BASE =
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-[11px] font-medium whitespace-nowrap transition-colors select-none outline-none [&>svg]:pointer-events-none [&>svg]:size-3";

const BADGE_VARIANTS = {
  default: "bg-primary text-primary-foreground",
  secondary:
    "bg-muted/70 text-foreground/85 ring-1 ring-inset ring-foreground/[0.06] dark:bg-white/[0.08] dark:ring-white/[0.08]",
  outline:
    "border-border/80 bg-background/80 text-foreground dark:border-white/[0.1] dark:bg-white/[0.04]",
  destructive:
    "border-destructive/30 bg-destructive/10 text-destructive dark:bg-destructive/20",
} as const;

export type BadgeProps = ComponentProps<"span"> & {
  variant?: "default" | "secondary" | "outline" | "destructive";
};

/** Compact pill badge primitive. */
export function Badge({ variant = "default", className, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      data-variant={variant}
      className={cn(BADGE_BASE, BADGE_VARIANTS[variant], className)}
      {...props}
    />
  );
}

export type KbdProps = ComponentProps<"kbd">;

/** Keyboard shortcut keycap primitive. */
export function Kbd({ className, ...props }: KbdProps) {
  return (
    <kbd
      data-slot="kbd"
      className={cn(
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-md border border-border/70 bg-muted/55 px-1.5 font-sans text-[11px] font-medium text-muted-foreground shadow-[0_1px_0_rgba(0,0,0,0.06)] select-none [&_svg:not([class*='size-'])]:size-3 dark:border-white/[0.08] dark:bg-white/[0.06]",
        className,
      )}
      {...props}
    />
  );
}

export type ToolbarProps = Omit<ComponentProps<typeof SdkToolbar>, "className"> & {
  className?: string;
  "data-slot"?: string;
};

/** Accessible toolbar container built on @ui-sdk/react/toolbar. */
export function Toolbar({ className, "data-slot": dataSlot = "toolbar", ...props }: ToolbarProps) {
  return <SdkToolbar data-slot={dataSlot} className={className} {...props} />;
}

export type ToolbarButtonProps = Omit<ComponentProps<typeof SdkToolbarButton>, "className" | "render" | "onClick"> &
  Pick<ComponentProps<typeof SdkButton>, "onClick"> & {
    variant?: ButtonVariant;
    size?: ButtonSize;
    className?: string;
    "data-slot"?: string;
  };

/** Toolbar button built on @ui-sdk/react/toolbar and @ui-sdk/react/button. */
export function ToolbarButton({
  variant = "default",
  size = "default",
  className,
  onClick,
  "data-slot": dataSlot = "toolbar-button",
  ...props
}: ToolbarButtonProps) {
  return (
    <SdkToolbarButton
      render={<SdkButton onClick={onClick} data-slot={dataSlot} />}
      data-variant={variant}
      data-size={size}
      className={cn(BUTTON_BASE, BUTTON_VARIANTS[variant], BUTTON_SIZES[size], className)}
      {...props}
    />
  );
}
