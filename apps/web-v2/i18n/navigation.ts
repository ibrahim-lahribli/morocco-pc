/**
 * Locale-aware navigation. `Link`, `usePathname` and `useRouter` from here
 * carry the current locale automatically, so no component builds `/fr/...` by
 * hand.
 */
import { createNavigation } from "next-intl/navigation";

import { routing } from "./routing";

export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
