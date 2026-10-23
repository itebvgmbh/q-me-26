import { RouterProvider } from "react-router-dom";
import { Toaster } from "sonner";
import { DEFAULT_THEME } from "./constants/default-theme";
import { ThemeProvider } from "./internal-components/ThemeProvider";
import { OuterErrorBoundary } from "./prod-components/OuterErrorBoundary";
import { router } from "./router";

export const AppWrapper = () => {
  return (
    <OuterErrorBoundary>
      <ThemeProvider defaultTheme={DEFAULT_THEME}>
        <RouterProvider router={router} />
        <Toaster richColors position="top-center" toastOptions={{ className: "font-sans rounded-2xl" }} />
      </ThemeProvider>
    </OuterErrorBoundary>
  );
};
