import { DirectionProvider } from "@radix-ui/react-direction";
import { useEffect } from "react";
import { RouterProvider } from "react-router-dom";
import { Toaster } from "sonner";
import { DEFAULT_THEME } from "./constants/default-theme";
import { ThemeProvider } from "./internal-components/ThemeProvider";
import { OuterErrorBoundary } from "./prod-components/OuterErrorBoundary";
import { router } from "./router";
import { istRtl } from "./i18n";
import { connectNativeApp } from "./utils/native-app";

export const AppWrapper = () => {
  // iPhone/iPad-App: Antippen einer Benachrichtigung und QR-Codes öffnen die passende Seite
  useEffect(() => connectNativeApp((path) => void router.navigate(path)), []);

  return (
    <OuterErrorBoundary>
      <ThemeProvider defaultTheme={DEFAULT_THEME}>
        {/* Arabisch: Menüs, Auswahllisten und Tastatur der Radix-Bausteine von rechts nach links */}
        <DirectionProvider dir={istRtl() ? "rtl" : "ltr"}>
          <RouterProvider router={router} />
          <Toaster dir={istRtl() ? "rtl" : "ltr"} richColors position="top-center" toastOptions={{ className: "font-sans rounded-2xl" }} />
        </DirectionProvider>
      </ThemeProvider>
    </OuterErrorBoundary>
  );
};
