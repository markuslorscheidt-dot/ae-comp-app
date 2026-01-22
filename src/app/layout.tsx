import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Commercial Business Planner',
  description: 'Business Planning & Compensation Dashboard',
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
