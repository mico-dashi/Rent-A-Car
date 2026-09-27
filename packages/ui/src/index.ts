/**
 * Shared UI recipes for web surfaces (storefront + owner/admin dashboards).
 * Components are styled with Tailwind classes that resolve to the tenant's
 * CSS variables (see @rental/design-tokens themeToCssVars), so one component
 * set renders every tenant's brand.
 */
export function cn(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export type ButtonVariant = "primary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

const base = "inline-flex items-center justify-center gap-2 rounded-md font-semibold transition-[transform,background-color,opacity] duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";
const variants: Record<ButtonVariant, string> = {
  primary: "bg-brand-btn text-on-brand hover:brightness-110",
  ghost: "border border-line bg-transparent text-fg hover:bg-raised",
  danger: "border border-bad bg-transparent text-bad hover:bg-raised",
};
const sizes: Record<ButtonSize, string> = { sm: "px-3 py-2 text-xs", md: "px-5 py-3 text-[15px]", lg: "px-6 py-3.5 text-base" };

export function buttonClasses(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra?: string): string {
  return cn(base, variants[variant], sizes[size], extra);
}

export const statusTone: Record<string, "neutral" | "success" | "warning" | "danger" | "info"> = {
  CONFIRMED: "success", READY_FOR_PICKUP: "success", ACTIVE: "info", RETURN_DUE: "warning", PENDING_PAYMENT: "warning",
  PENDING_APPROVAL: "warning", CANCELLED: "danger", NO_SHOW: "danger", DISPUTED: "danger", COMPLETED: "neutral", RETURNED: "neutral",
};
