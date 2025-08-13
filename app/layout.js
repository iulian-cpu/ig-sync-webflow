export const metadata = { title: "IG Sync" };
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body style={{fontFamily:"Inter, system-ui, Arial", padding:20}}>
        {children}
      </body>
    </html>
  );
}
