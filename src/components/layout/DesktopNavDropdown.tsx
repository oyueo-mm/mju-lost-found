"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import {
  BellIcon,
  BoxIcon,
  ChatBubbleIcon,
  ChevronDownIcon,
  HandboxIcon,
  InfoIcon,
  LogoutIcon,
  PlusIcon,
  SearchIcon,
  ShieldIcon,
  UserIcon,
} from "@/components/icons";
import { useI18n } from "@/lib/i18n/client";
import { DESKTOP_PROFILE_NAV_ITEM, isNavActive, type NavChild, type NavIconName, type NavItem } from "./NavLinks";

type ServerAction = (formData: FormData) => void | Promise<void>;

type DesktopNavDropdownProps = {
  item: NavItem;
  active: boolean;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  onSignOut?: ServerAction;
  triggerContent?: ReactNode;
};

const ICONS: Record<NavIconName, typeof BoxIcon> = {
  box: BoxIcon,
  handbox: HandboxIcon,
  plus: PlusIcon,
  search: SearchIcon,
  chat: ChatBubbleIcon,
  user: UserIcon,
  bell: BellIcon,
  chatBubble: ChatBubbleIcon,
  logout: LogoutIcon,
  shield: ShieldIcon,
  info: InfoIcon,
};

const DROPDOWN_OPEN_EVENT = "mju-desktop-nav-dropdown-open";

export function DesktopNavDropdown({ item, active, open, onOpen, onClose, onSignOut, triggerContent }: DesktopNavDropdownProps) {
  const { t } = useI18n();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLAnchorElement>(null);
  const firstLinkRef = useRef<HTMLElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const menuId = `desktop-nav-${item.key}`;

  useEffect(() => {
    function closeWhenAnotherOpens(event: Event) {
      if ((event as CustomEvent<string>).detail !== item.key) onClose();
    }

    function closeOnOutsidePointer(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) onClose();
    }

    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener(DROPDOWN_OPEN_EVENT, closeWhenAnotherOpens);
    return () => {
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener(DROPDOWN_OPEN_EVENT, closeWhenAnotherOpens);
    };
  }, [item.key, onClose]);

  function openMenu() {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
    window.dispatchEvent(new CustomEvent(DROPDOWN_OPEN_EVENT, { detail: item.key }));
    onOpen();
  }

  function scheduleClose() {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    closeTimerRef.current = setTimeout(() => {
      onClose();
      closeTimerRef.current = null;
    }, 200);
  }

  function closeAndFocusTrigger() {
    if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    onClose();
    triggerRef.current?.focus();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      closeAndFocusTrigger();
      return;
    }

    if (event.key === "ArrowDown" && event.target === triggerRef.current) {
      event.preventDefault();
      openMenu();
      requestAnimationFrame(() => firstLinkRef.current?.focus());
    }
  }

  return (
    <div
      ref={rootRef}
      className="relative"
      onMouseEnter={openMenu}
      onMouseLeave={scheduleClose}
      onFocusCapture={openMenu}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) scheduleClose();
      }}
      onKeyDown={handleKeyDown}
    >
      <Link
        ref={triggerRef}
        href={item.href}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={menuId}
        aria-current={active ? "page" : undefined}
        className={`inline-flex h-10 items-center gap-1 rounded-full px-4 text-sm font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
          active ? "bg-primary-muted text-primary" : "text-muted-foreground hover:text-foreground"
        }`}
      >
        {triggerContent ?? t(item.labelKey)}
        <ChevronDownIcon className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </Link>

      {item.children && (
        <div
          id={menuId}
          role="group"
          aria-label={t(item.labelKey)}
          aria-hidden={!open}
          className={`absolute top-full z-50 min-w-52 pt-1.5 transition-[opacity,transform,visibility] duration-150 ease-out motion-reduce:transition-none ${
            item.menuAlign === "end" ? "right-0" : "left-0"
          } ${
            open
              ? "visible translate-y-0 opacity-100 pointer-events-auto"
              : "invisible translate-y-1 opacity-0 pointer-events-none"
          }`}
        >
          <div className="overflow-hidden rounded-card border border-border bg-card p-1 shadow-lg">
            {item.children.map((child, index) => (
              <NavChildEntry
                key={child.action ?? child.href}
                child={child}
                index={index}
                firstLinkRef={firstLinkRef}
                open={open}
                onClose={onClose}
                onSignOut={onSignOut}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function DesktopProfileDropdown({
  nickname,
  active,
  onSignOut,
}: {
  nickname: string;
  active: boolean;
  onSignOut: ServerAction;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const item = DESKTOP_PROFILE_NAV_ITEM;

  return (
    <DesktopNavDropdown
      item={item}
      active={active || isNavActive("me", item.href, pathname)}
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => setOpen(false)}
      onSignOut={onSignOut}
      triggerContent={
        <span className="flex min-w-0 items-center gap-2">
          <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <UserIcon className="size-4" />
          </span>
          <span className="hidden max-w-24 truncate sm:inline">{nickname}</span>
        </span>
      }
    />
  );
}

function NavChildEntry({
  child,
  index,
  firstLinkRef,
  open,
  onClose,
  onSignOut,
}: {
  child: NavChild;
  index: number;
  firstLinkRef: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  onSignOut?: ServerAction;
}) {
  const { t } = useI18n();
  const Icon = ICONS[child.icon];
  const className =
    "flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:bg-muted focus-visible:text-foreground focus-visible:outline-none";
  const content = (
    <>
      <Icon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate">{t(child.labelKey)}</span>
    </>
  );

  if (child.action === "signOut") {
    if (!onSignOut) return null;
    return (
      <form action={onSignOut}>
        <button
          ref={index === 0 ? (node) => { firstLinkRef.current = node; } : undefined}
          type="submit"
          tabIndex={open ? 0 : -1}
          className={className}
          onClick={onClose}
        >
          {content}
        </button>
      </form>
    );
  }

  return (
    <Link
      ref={index === 0 ? (node) => { firstLinkRef.current = node; } : undefined}
      href={child.href ?? "#"}
      tabIndex={open ? 0 : -1}
      aria-label={t(child.labelKey)}
      className={className}
      onClick={onClose}
    >
      {content}
    </Link>
  );
}
