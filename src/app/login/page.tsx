import { LoginForm } from "./LoginForm";

export const metadata = { title: "Sign in / Stock Tracker" };

export default function LoginPage() {
  return (
    <div className="mx-auto flex min-h-[78vh] max-w-sm flex-col justify-center">
      <div className="mb-8 flex items-center gap-3">
        <span className="inline-block size-4 rotate-45 bg-amber" />
        <span className="display text-4xl tracking-wide">
          Stock<span className="text-steel">/</span>Tracker
        </span>
      </div>
      <LoginForm />
      <p className="mt-6 text-[11px] leading-relaxed text-steel">
        Private tool, single account. Informational only, not investment advice.
      </p>
    </div>
  );
}
