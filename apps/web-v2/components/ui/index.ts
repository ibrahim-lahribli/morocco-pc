/**
 * Shared UI kit. One import path, and every component is a plain function:
 * no hooks, no context, no `"use client"`. Interactive behaviour belongs to
 * the element underneath (a native input or button) or to the feature island
 * that owns state.
 *
 * Rules for anything added here:
 *   - theme tokens only, never a raw colour or a physical direction utility;
 *   - logical properties (`ms/me`, `ps/pe`, `start/end`) so RTL mirrors free;
 *   - user-facing text arrives as props or from next-intl;
 *   - 44px minimum touch target, and a visible focus state.
 */
export {
  Button,
  buttonVariants,
  type ButtonProps,
  type ButtonSize,
  type ButtonVariant,
} from "./button";
export { Badge, badgeVariants, type BadgeProps, type BadgeTone } from "./badge";
export {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  cardVariants,
  type CardProps,
} from "./card";
export { TextField, type TextFieldProps } from "./text-field";
