"use client";
import Image from "next/image";
import Link from "next/link";

export default function Header({
  onReset,
}: {
  onReset: () => void;
}) {
 

  return (
    <header className="sticky top-0 z-50 backdrop-blur bg-black/70 border-b border-white/10">
        <div className="mx-auto max-w-6xl px-4 py-3 flex items-center justify-between">
            {/* Left */}
            <div className="flex items-center gap-3">
            <Image
                src="/logo.png"
                alt="PM Scalps Coach"
                width={36}
                height={36}
                priority
                className="rounded-md"
            />
            <div>
                <div className="text-base font-extrabold tracking-wide">
                PM Scalps Coach
                </div>
            </div>
            </div>

            {/* Right */}
            <div className="flex items-center gap-2">
            <button className="px-3 py-2 rounded-xl text-sm font-bold
                                border border-white/15 bg-white/5
                                hover:bg-white/10 transition"
                    onClick={onReset}>
                Reset
            </button>

            <button className="px-3 py-2 rounded-xl text-sm font-bold
                                border border-blue-400/40
                                bg-blue-500/20 text-blue-200
                                hover:bg-blue-500/30 transition">
                Journal
            </button>
            </div>
        </div>
        </header>
  );
}