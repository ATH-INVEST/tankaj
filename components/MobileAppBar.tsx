"use client";

import { useEffect, useState } from "react";

type ActiveTab = "search" | "result" | "settings";

function isNativeAppMode() {
  if (typeof window === "undefined") return false;

  try {
    const params = new URLSearchParams(window.location.search);
    return (
      params.get("app") === "1" ||
      window.matchMedia?.("(display-mode: standalone)")?.matches ||
      Boolean((window as any).Capacitor)
    );
  } catch {
    return false;
  }
}

export default function MobileAppBar() {
  const [visible, setVisible] = useState(false);
  const [active, setActive] = useState<ActiveTab>("search");

  useEffect(() => {
    const appMode = isNativeAppMode();
    setVisible(appMode);
    document.documentElement.classList.toggle("tankaj-native-app", appMode);
  }, []);

  useEffect(() => {
    if (!visible) return;

    const onScroll = () => {
      const result = document.getElementById("result");
      if (!result) return;

      const rect = result.getBoundingClientRect();
      setActive(rect.top < 180 ? "result" : "search");
    };

    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });

    return () => window.removeEventListener("scroll", onScroll);
  }, [visible]);

  function scrollToId(id: string, nextActive: ActiveTab) {
    const el = document.getElementById(id);
    if (!el) return;

    setActive(nextActive);

    const offset = id === "result" ? 86 : 0;
    const top = el.getBoundingClientRect().top + window.scrollY - offset;

    window.scrollTo({
      top: Math.max(0, top),
      behavior: "smooth",
    });
  }

  if (!visible) return null;

  return (
<nav className="fixed inset-x-3 bottom-[max(env(safe-area-inset-bottom),12px)] z-[9999] mx-auto max-w-[420px] rounded-[28px] border border-white/10 bg-[#071a12]/88 p-2 shadow-[0_22px_70px_rgba(0,0,0,.46)] backdrop-blur-2xl md:hidden">
      <div className="grid grid-cols-3 gap-1.5">
        <button
          type="button"
          onClick={() => scrollToId("top", "search")}
          className={`rounded-[22px] px-2.5 py-2.5 text-center transition ${
            active === "search"
              ? "bg-[#b9fb6a] text-[#071a12] shadow-[0_12px_26px_rgba(185,251,106,.22)]"
              : "text-white/58"
          }`}
        >
          <span className="block text-[17px] leading-none">⌕</span>
          <span className="mt-1 block text-[10px] font-black">Išči</span>
        </button>

        <button
          type="button"
          onClick={() => scrollToId("result", "result")}
          className={`rounded-[22px] px-2.5 py-2.5 text-center transition ${
            active === "result"
              ? "bg-[#b9fb6a] text-[#071a12] shadow-[0_12px_26px_rgba(185,251,106,.22)]"
              : "text-white/58"
          }`}
        >
          <span className="block text-[17px] leading-none">◆</span>
          <span className="mt-1 block text-[10px] font-black">Izbira</span>
        </button>

        <button
          type="button"
          onClick={() => scrollToId("top", "settings")}
          className={`rounded-[22px] px-2.5 py-2.5 text-center transition ${
            active === "settings"
              ? "bg-[#b9fb6a] text-[#071a12] shadow-[0_12px_26px_rgba(185,251,106,.22)]"
              : "text-white/58"
          }`}
        >
          <span className="block text-[17px] leading-none">⚙︎</span>
          <span className="mt-1 block text-[10px] font-black">Nastavitve</span>
        </button>
      </div>
    </nav>
  );
}
