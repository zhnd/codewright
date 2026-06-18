'use client';

import { LogOut, Moon, Sun } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { authClient } from '@/libs/auth-client';
import { cn } from '@/utils/cn';
import { NAVIGATION_ITEMS } from './constants';

export function LeftSidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const { data: session } = authClient.useSession();
  const user = session?.user;
  const initial = user?.name?.charAt(0)?.toUpperCase() ?? 'U';

  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const currentTheme = mounted
    ? theme === 'system'
      ? resolvedTheme
      : theme
    : null;

  async function handleSignOut() {
    await authClient.signOut();
    router.push('/login');
  }

  return (
    <>
      {/* Desktop sidebar — internal left column of the unified shell */}
      <aside className="hidden w-55 shrink-0 flex-col border-r border-border-faint bg-sidebar lg:flex">
        {/* Brand identity */}
        <Link
          href="/"
          className="m-2 mb-1 flex items-center gap-2.5 rounded-sm px-2 py-2 no-underline transition-colors hover:bg-surface-2"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-sm bg-foreground text-[12px] font-semibold text-background">
            T
          </div>
          <div className="min-w-0 flex-1 text-left">
            <div className="truncate text-[12.5px] font-semibold tracking-normal">
              Codewright
            </div>
            <div className="-mt-px truncate font-mono text-[10px] text-foreground-subtle">
              AI execution
            </div>
          </div>
        </Link>

        {/* Workspace nav */}
        <div className="px-2 pt-2">
          <div className="flex items-center justify-between px-2 pb-1.5">
            <span className="font-mono text-[9.5px] font-medium uppercase tracking-[0.1em] text-foreground-subtle">
              main
            </span>
          </div>
          <nav className="flex flex-col gap-px">
            {NAVIGATION_ITEMS.map((item, i) => {
              const isActive =
                item.href === '/'
                  ? pathname === '/'
                  : pathname.startsWith(item.href);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'group relative flex items-center gap-2.5 rounded-sm px-2 py-1.5 text-[12.5px] transition-colors',
                    isActive
                      ? 'bg-surface-inset font-semibold text-foreground'
                      : 'font-medium text-foreground-muted hover:bg-surface-2 hover:text-foreground'
                  )}
                >
                  {isActive && (
                    <span className="absolute inset-y-1 left-0 w-px rounded-full bg-accent" />
                  )}
                  <Icon
                    className={cn(
                      'h-3.5 w-3.5 transition-colors',
                      isActive
                        ? 'text-foreground'
                        : 'text-foreground-subtle group-hover:text-foreground-muted'
                    )}
                    strokeWidth={isActive ? 2.25 : 1.75}
                  />
                  <span className="flex-1">{item.label}</span>
                  <span className="font-mono text-[9.5px] tabular-nums text-foreground-faint">
                    {String(i).padStart(2, '0')}
                  </span>
                </Link>
              );
            })}
          </nav>
        </div>

        {/* Filler — pushes footer down */}
        <div className="flex-1" />

        {/* User row footer */}
        <div className="m-2 rounded-sm border border-border-faint bg-card p-1.5">
          <div className="flex items-center gap-2 px-1 py-1">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-[11px] font-semibold text-accent-ink">
              {initial}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[12px] font-semibold leading-tight">
                {user?.name ?? 'User'}
              </div>
              <div className="truncate font-mono text-[9.5px] text-foreground-subtle">
                {user?.email ?? ''}
              </div>
            </div>
          </div>
          <div className="mt-1 flex items-center gap-1 border-t border-border-faint pt-1">
            <button
              type="button"
              onClick={() =>
                setTheme(currentTheme === 'dark' ? 'light' : 'dark')
              }
              title="Toggle theme"
              className="flex h-7 flex-1 items-center justify-center rounded-sm text-foreground-subtle hover:bg-surface-2 hover:text-foreground"
            >
              {currentTheme === 'dark' ? (
                <Sun className="h-3.5 w-3.5" />
              ) : (
                <Moon className="h-3.5 w-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={handleSignOut}
              title="Sign out"
              className="flex h-7 flex-1 items-center justify-center rounded-sm text-foreground-subtle hover:bg-surface-2 hover:text-foreground"
            >
              <LogOut className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      <nav className="fixed inset-x-0 bottom-0 z-50 flex items-center justify-around border-t border-border bg-card px-2 py-2 lg:hidden">
        {NAVIGATION_ITEMS.map((item) => {
          const isActive =
            item.href === '/'
              ? pathname === '/'
              : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                'flex flex-col items-center gap-1 px-3 py-1 text-[11px] transition-colors',
                isActive ? 'text-foreground' : 'text-foreground-muted'
              )}
            >
              <Icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
