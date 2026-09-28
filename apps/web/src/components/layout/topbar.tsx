export function Topbar() {
  return (
    <header className="h-14 border-b flex items-center px-6 bg-background sticky top-0 z-10">
      <div className="flex-1"></div>
      <div className="flex items-center gap-4">
        <span className="text-sm font-medium">User</span>
      </div>
    </header>
  );
}
