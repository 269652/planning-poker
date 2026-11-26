import type { Metadata, Viewport } from "next";
import "./globals.css";
import Backdrop from "@/components/Backdrop";

export const metadata: Metadata = {
  title: "Planning Poker",
  description: "Realtime Scrum planning poker with Jira write-back",
};
// viewport-fit=cover: the card sheet on phones pads itself for the home indicator (safe-area insets).
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      {/* Browser extensions (e.g. ColorZilla) add attributes to <body> before React hydrates. */}
      <body suppressHydrationWarning>
        <Backdrop />
        {children}
      </body>
    </html>
  );
}
