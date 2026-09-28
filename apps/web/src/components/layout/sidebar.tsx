import Link from "next/link";

export function Sidebar() {
  return (
    <aside className="w-64 border-r bg-background h-screen sticky top-0 flex flex-col">
      <div className="p-4 border-b h-14 flex items-center font-bold">
        App Name
      </div>
      <nav className="flex-1 p-4">
        <ul className="space-y-2">
          <li>
            <Link href="/" className="block p-2 hover:bg-muted rounded-md transition-colors">
              Dashboard
            </Link>
          </li>
          <li>
            <Link href="/settings" className="block p-2 hover:bg-muted rounded-md transition-colors">
              Settings
            </Link>
          </li>
        </ul>
      </nav>
    </aside>
  );
}
