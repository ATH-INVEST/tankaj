"use client";

import { useEffect, useState } from "react";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
};

function isIos() {
  if (typeof window === "undefined") return false;
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

function isStandalone() {
  if (typeof window === "undefined") return false;

  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    // iOS Safari standalone mode
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window.navigator as any).standalone === true
  );
}

export default function InstallAppPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [showIosHint, setShowIosHint] = useState(false);

  useEffect(() => {
    if (window.innerWidth >= 1024) return;

    if (isStandalone()) return;

    const dismissed = localStorage.getItem("tankaj_install_dismissed");
    if (dismissed === "1") return;

    const onBeforeInstallPrompt = (event: Event) => {
      event.preventDefault();
      setDeferredPrompt(event as BeforeInstallPromptEvent);
      setShow(true);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);

    if (isIos()) {
      const timer = window.setTimeout(() => {
        if (!isStandalone()) {
          setShow(true);
          setShowIosHint(true);
        }
      }, 2500);

      return () => {
        window.clearTimeout(timer);
        window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      };
    }

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    };
  }, []);

  async function install() {
    if (!deferredPrompt) {
      setShowIosHint(true);
      return;
    }

    await deferredPrompt.prompt();
    const choice = await deferredPrompt.userChoice;

    if (choice.outcome === "accepted") {
      setShow(false);
    }

    setDeferredPrompt(null);
  }

  function dismiss() {
    localStorage.setItem("tankaj_install_dismissed", "1");
    setShow(false);
  }

  if (!show) return null;

  return (
<div className="fixed inset-x-3 bottom-[calc(env(safe-area-inset-bottom,0px)+12px)] z-[99999] mx-auto max-w-md rounded-[24px] border border-white/10 bg-[#071a12]/95 p-4 text-white shadow-[0_24px_80px_rgba(0,0,0,.45)] backdrop-blur-xl lg:hidden">
      <div className="flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-[#b9fb6a] text-lg font-black text-[#071a12]">
          T
        </div>

        <div className="min-w-0 flex-1">
          <div className="text-sm font-black">Dodaj Tankaj.si na zaslon</div>
          <p className="mt-1 text-xs leading-relaxed text-white/55">
            Odpri kot aplikacijo, brez iskanja po brskalniku. Hitro preverjanje
            cen goriva pred potjo.
          </p>

          {showIosHint && (
            <div className="mt-3 rounded-2xl border border-[#b9fb6a]/20 bg-[#b9fb6a]/10 p-3 text-xs leading-relaxed text-[#b9fb6a]">
              Na iPhone: tapni <span className="font-black">Share</span> ikono
              v Safariju, nato izberi{" "}
              <span className="font-black">Add to Home Screen</span>.
            </div>
          )}

          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={dismiss}
              className="rounded-2xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-xs font-black text-white/70"
            >
              Kasneje
            </button>
            <button
              type="button"
              onClick={install}
              className="rounded-2xl bg-[#b9fb6a] px-3 py-2.5 text-xs font-black text-[#071a12]"
            >
              Dodaj app
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}