import React, { useEffect, useState } from "react";

const LS_KEY = "betaBannerDismissed";

export default function BetaBanner() {
  const [open, setOpen] = useState(true);

  // Remember dismissal across page reloads
  useEffect(() => {
    const saved = localStorage.getItem(LS_KEY);
    if (saved === "1") setOpen(false);
  }, []);

  function close() {
    setOpen(false);
    localStorage.setItem(LS_KEY, "1");
  }

  if (!open) return null;

  return (
    <>
      {/* Fixed banner */}
      <div className="fixed top-0 inset-x-0 z-50">
        <div className="mx-auto max-w-6xl px-3">
          <div className="mt-2 rounded-md bg-red-600 text-white shadow-lg ring-1 ring-red-500/50">
            <div className="flex items-start gap-3 px-4 py-2">
              <span className="mt-0.5 text-sm sm:text-base font-semibold">
                WARNING
              </span>
              <p className="text-sm sm:text-base leading-snug">
                SusScanner is in beta. This information is being provided to beta
                testers to help dial in the results.
              </p>

              <button
                type="button"
                onClick={close}
                aria-label="Dismiss beta warning"
                className="ml-auto -mr-1 inline-flex h-7 w-7 items-center justify-center rounded-md
                           bg-white/10 hover:bg-white/20 focus:outline-none focus:ring-2
                           focus:ring-white/60"
              >
                <span aria-hidden>✕</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Spacer so fixed banner doesn't cover your header/content */}
      <div className="h-14 sm:h-16" />
    </>
  );
}
