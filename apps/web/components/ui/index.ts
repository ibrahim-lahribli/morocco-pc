/**
 * The base component kit (S3) — eight components, one import path.
 *
 * Every component is a plain function: no hooks, no context, no `"use client"`.
 * That keeps them usable in server components, and it means the only stateful
 * thing in a screen is the screen itself. Interactive behaviour comes from the
 * element underneath (a native radio, a native range, a native button), which is
 * also where keyboard support and the accessibility tree come from.
 *
 * Rules that hold for all eight, enforced by `npm run check:tokens` and the
 * specs in `e2e/kit.spec.ts`:
 *   - token classes only — no colour literal, no raw palette utility (the gate
 *     scans this file too, so the rule cannot be written as an example here);
 *   - logical properties only — `ms/me/ps/pe/start/end`, never a physical
 *     margin, padding or alignment utility;
 *   - ≥ 44 px touch targets (`h-control` 48 px, `h-tap` 44 px);
 *   - a visible `:focus-visible` state that is not colour-only.
 */
export { Alert, type AlertProps, type AlertTone } from "./alert";
export { Badge, type BadgeProps, type BadgeTone } from "./badge";
export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from "./button";
export { ChoiceCard, type ChoiceCardProps } from "./choice-card";
export { cn } from "./cn";
export { ProgressBar, type ProgressBarProps, type ProgressTone } from "./progress-bar";
export { Skeleton, SkeletonCard } from "./skeleton";
export { Slider, type SliderProps } from "./slider";
export { TextField, type TextFieldProps } from "./text-field";
