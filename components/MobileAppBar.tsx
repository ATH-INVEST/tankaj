"use client";

export default function MobileAppBar() {
  return (
    <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom,0px)+12px)] z-[9999] mx-auto max-w-md rounded-[24px] border border-white/10 bg-[#071a12]/88 p-2 shadow-[0_20px_70px_rgba(0,0,0,.42)] backdrop-blur-xl md:hidden">
      <div className="grid grid-cols-3 gap-1">
        <a
          href="#top"
          className="rounded-[18px] bg-[#b9fb6a] px-3 py-2.5 text-center text-xs font-black text-[#071a12]"
        >
          Išči
        </a>

        <a
          href="#result"
          className="rounded-[18px] px-3 py-2.5 text-center text-xs font-black text-white/65"
        >
          Rezultat
        </a>

        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          className="rounded-[18px] px-3 py-2.5 text-center text-xs font-black text-white/65"
        >
          Na vrh
        </button>
      </div>
    </div>
  );
}