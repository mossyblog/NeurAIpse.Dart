import type { ComponentProps } from "react";
import { Button as SdkButton } from "@ui-sdk/react/button";
import { Toolbar as SdkToolbar, ToolbarButton as SdkToolbarButton } from "@ui-sdk/react/toolbar";
import { cn } from "cn";

export type ButtonVariant = "default" | "outline" | "secondary" | "ghost" | "destructive" | "link";
export type ButtonSize = "default" | "xs" | "sm" | "lg" | "icon" | "icon-xs" | "icon-sm" | "icon-lg";

const BUTTON_BASE =
  "inline-flex shrink-0 items-center justify-center whitespace-nowrap border border-transparent font-medium select-none outline-none transition-all active:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  default: "bg-primary text-primary-foreground hover:bg-primary/80",
  outline:
    "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
  secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
  ghost:
    "bg-transparent bg-clip-padding hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
  destructive:
    "border-destructive bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
  link: "text-primary underline-offset-4 hover:underline",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  default: "h-8 gap-1.5 rounded-lg px-2.5 text-sm",
  xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs [&_svg:not([class*='size-'])]:size-3",
  sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] [&_svg:not([class*='size-'])]:size-3.5",
  lg: "h-9 gap-1.5 rounded-lg px-3 text-sm",
  icon: "size-8 rounded-lg text-sm",
  "icon-xs": "size-6 rounded-[min(var(--radius-md),10px)] text-sm [&_svg:not([class*='size-'])]:size-3",
  "icon-sm": "size-7 rounded-[min(var(--radius-md),12px)] text-sm",
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
  "inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all select-none outline-none [&>svg]:pointer-events-none [&>svg]:size-3";

const BADGE_VARIANTS = {
  default: "bg-primary text-primary-foreground",
  secondary: "bg-secondary text-secondary-foreground",
  outline: "border-border bg-background text-foreground dark:border-input dark:bg-input/30",
  destructive: "border-destructive bg-destructive/10 text-destructive dark:bg-destructive/20",
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
        "pointer-events-none inline-flex h-5 w-fit min-w-5 items-center justify-center gap-1 rounded-sm bg-muted px-1 font-sans text-xs font-medium text-muted-foreground select-none [&_svg:not([class*='size-'])]:size-3",
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
