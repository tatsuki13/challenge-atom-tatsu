import { logout } from "../auth-actions";
import Link from "next/link";

export default function AccountBar({ displayName }: { displayName: string }) {
  return (
    <div className="border-b border-[#d8e3de] bg-white px-4 py-2 text-[#1d2733]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-end gap-4">
        <Link href="/state-vector" className="text-sm font-bold text-[#237668] underline underline-offset-4">状態の変化</Link>
        <span className="truncate text-sm font-semibold">{displayName} さん</span>
        <form action={logout}>
          <button type="submit" className="rounded-md border border-[#aebdcc] px-3 py-2 text-sm font-bold hover:bg-[#f3f6f8]">
            ログアウト
          </button>
        </form>
      </div>
    </div>
  );
}
