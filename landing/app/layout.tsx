import type { Metadata } from 'next';
import { Geist, Geist_Mono } from 'next/font/google';
import './globals.css';

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  display: 'swap',
});

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
  weight: ['400', '600'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'defi-risk-mcp — Give Claude DeFi-grade risk awareness',
  description:
    'An MCP server that synthesizes audits, exploits, oracles, MEV — exposed as 8 tools any AI agent can call. Built for Encode DeFi Mini Hack 2026.',
  metadataBase: new URL('https://defi-risk-mcp.vercel.app'),
  openGraph: {
    title: 'defi-risk-mcp',
    description:
      'Give Claude DeFi-grade risk awareness. An MCP server for risk synthesis across audits, exploits, oracles, MEV.',
    type: 'website',
    // images: ['/og-image.png'],   // TBD — see PR body
  },
  twitter: {
    card: 'summary_large_image',
    title: 'defi-risk-mcp',
    description:
      'Give Claude DeFi-grade risk awareness. An MCP server for risk synthesis across audits, exploits, oracles, MEV.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`dark ${geistSans.variable} ${geistMono.variable}`}>
      <body className="bg-[#0A0A0A] text-[#FAFAFA] antialiased">{children}</body>
    </html>
  );
}
