import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { MetaPixel } from "@/components/meta-pixel";
import { PostHogProvider } from "@/components/posthog-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "SongFromText — Turn their messages into a song",
  description:
    "Paste what they said. Hear it as a real song. AI-generated music using the original messages as lyrics.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`dark ${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-black text-white">
        {children}
        <PostHogProvider />
        <MetaPixel />
      </body>
    </html>
  );
}
