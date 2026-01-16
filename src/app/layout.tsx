import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AE Kompensation - DACH',
  description: 'Sales Compensation Dashboard für Account Executives im DACH-Markt',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="de">
      <body className="min-h-screen bg-gray-50">{children}</body>
    </html>
  );
}
