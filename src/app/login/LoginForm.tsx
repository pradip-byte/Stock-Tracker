"use client";

import { useActionState } from "react";
import { signIn } from "../actions";

const field =
  "num h-10 w-full rounded-sm border border-line bg-night px-3 text-sm text-ink outline-none placeholder:text-steel/50 focus:border-amber";

export function LoginForm() {
  const [state, action, pending] = useActionState(signIn, null);
  return (
    <form action={action} className="metal flex flex-col gap-4 rounded-md p-5">
      <label className="flex flex-col gap-1.5">
        <span className="label text-[10px] text-steel">Email</span>
        <input name="email" type="email" autoComplete="username" required className={field} />
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="label text-[10px] text-steel">Password</span>
        <input name="password" type="password" autoComplete="current-password" required className={field} />
      </label>
      {state?.error && (
        <p role="alert" className="num text-[11px] text-amber">
          {state.error}
        </p>
      )}
      <button
        disabled={pending}
        className="label h-10 rounded-sm bg-amber text-night transition-transform duration-150 ease-out hover:bg-amber-hi active:scale-[0.98] disabled:opacity-60"
      >
        {pending ? "Signing in" : "Sign in"}
      </button>
    </form>
  );
}
