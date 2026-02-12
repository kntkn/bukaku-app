import './globals.css';

export const metadata = {
  title: 'bukkaku AI',
  description: 'AI-powered property vacancy checker',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
      </head>
      <body className="min-h-dvh bg-[#09090b] font-sans antialiased text-white overflow-x-hidden">
        {children}
      </body>
    </html>
  );
}
