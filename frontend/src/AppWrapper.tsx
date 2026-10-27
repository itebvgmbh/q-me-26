import { DirectionProvider } from "@radix-ui/react-direction";
import { RouterProvider } from "react-router-dom";
import { Toaster } from "sonner";
import { DEFAULT_THEME } from "./constants/default-theme";
import { ThemeProvider } from "./internal-components/ThemeProvider";
import { OuterErrorBoundary } from "./prod-components/OuterErrorBoundary";
import { router } from "./router";
import { istRtl } from "./i18n";

export const AppWrapper = () => {
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
