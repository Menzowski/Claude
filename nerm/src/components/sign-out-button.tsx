import { LogOut } from 'lucide-react';
import { signOut } from '@/lib/auth/config';

/**
 * Sign-out as a server action inside a form — a POST, so it cannot be triggered
 * by a stray link or an image request the way a GET endpoint could.
 */
export function SignOutButton() {
  return (
    <form
      action={async () => {
        'use server';
        await signOut({ redirectTo: '/signin' });
      }}
    >
      <button
        type="submit"
        className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-foreground"
        aria-label="Sign out"
      >
        <LogOut className="h-4 w-4" />
      </button>
    </form>
  );
}
