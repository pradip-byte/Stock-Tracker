import type { Metadata } from "next";
import { Barlow_Condensed, Geist, JetBrains_Mono } from "next/font/google";
import { MotionRoot } from "@/components/motion/primitives";
import { QuotesProvider } from "@/components/shell/quotes";
import { Disclaimer, TickerTape, TopBar } from "@/components/shell/Shell";
import { getQuotes } from "@/lib/data";
import { currentUser } from "@/lib/supabase/server";
import "./globals.css";

const barlow = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-barlow",
});
const geist = Geist({ subsets: ["latin"], variable: "--font-geist" });
const jbmono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jbmono" });

export const metadata: Metadata = {
  title: "Stock Tracker",
  description: "Internal Indian stock analysis. Informational only, not investment advice.",
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();
  const quotes = user ? await getQuotes() : {};
  return (
    <html lang="en-IN" className={`${barlow.variable} ${geist.variable} ${jbmono.variable}`}>
      <body>
        <MotionRoot>
          <QuotesProvider initial={quotes}>
            {user && <TopBar />}
            {user && <TickerTape />}
            <main className="mx-auto max-w-[1680px] overflow-x-clip px-4 pt-5">{children}</main>
            <Disclaimer />
          </QuotesProvider>
        </MotionRoot>
      </body>
    </html>
  );
}
