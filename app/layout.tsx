import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Genie — test ideas before you build them",
  description:
    "Genie is an idea & decision simulation engine. Turn a vague idea into a clear, scored, practical execution plan.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
