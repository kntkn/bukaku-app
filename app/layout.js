export const metadata = {
  title: '物確アプリ',
  description: '不動産物件確認の自動化ツール',
};

export default function RootLayout({ children }) {
  return (
    <html lang="ja">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif' }}>
        {children}
      </body>
    </html>
  );
}
