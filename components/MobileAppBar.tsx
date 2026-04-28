"use client";

import { useEffect, useState } from "react";

type ActiveTab = "search" | "result";

export default function MobileAppBar() {
  const [active, setActive] = useState<ActiveTab>("search");

  useEffect(() => {
    const onScroll = () => {
      const result = document.getElementById("result");
      if (!result) return;

      const rect = result.getBoundingClientRect();
      setActive(rect.top < 180 ? "result" : "search");
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  function scrollToId(id: string, nextActive: ActiveTab) {
    const el = document.getElementById(id);
    if (!el) return;

    setActive(nextActive);

    const offset = id === "result" ? 92 : 0;
    const top = el.getBoundingClientRect().top + window.scrollY - offset;

    window.scrollTo({
      top: Math.max(0, top),
      behavior: "smooth",
    });
  }

  return (
    <div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom,0px)+12px)] z-[9999] mx-auto max-w-md rounded-[24px] border border-white/10 bg-[#071a12]/88 p-2 shadow-[0_20px_70px_rgba(0,0,0,.42)] backdrop-blur-xl md:hidden">
      <div className="grid grid-cols-3 gap-1">
        <button
          type="button"
          onClick={() => scrollToId("top", "search")}
          className={`rounded-[18px] px-3 py-2.5 text-center text-xs font-black transition ${
            active === "search"
              ? "bg-[#b9fb6a] text-[#071a12]"
              : "text-white/65"
          }`}
        >
          Išči
        </button>

        <button
          type="button"
          onClick={() => scrollToId("result", "result")}
          className={`rounded-[18px] px-3 py-2.5 text-center text-xs font-black transition ${
            active === "result"
              ? "bg-[#b9fb6a] text-[#071a12]"
              : "text-white/65"
          }`}
        >
          Rezultat
        </button>

        <button
          type="button"
          onClick={() => {
            setActive("search");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          className="rounded-[18px] px-3 py-2.5 text-center text-xs font-black text-white/65 transition"
        >
          Na vrh
        </button>
      </div>
    </div>
  );
}
