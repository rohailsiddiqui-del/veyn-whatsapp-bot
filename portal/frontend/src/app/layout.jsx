import './globals.css';

export const metadata = {
  title: 'Veyn Bot Portal',
  description: 'WhatsApp Bot Configuration Portal',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
