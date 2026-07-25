import { useState } from "react";
import { Outlet } from "react-router-dom";
import { MdMenu } from "react-icons/md";

import Sidebar from "./Sidebar";
import Header from "./Header";

export default function MainLayout() {
  const [sidebarOpen, setSidebarOpen] =
    useState(false);

  function openSidebar() {
    setSidebarOpen(true);
  }

  function closeSidebar() {
    setSidebarOpen(false);
  }

  return (
    <div className="min-h-screen bg-[#F8F6F3]">
      <Sidebar
        open={sidebarOpen}
        onClose={closeSidebar}
      />

      <div className="min-h-screen lg:pl-64">
        <div className="sticky top-0 z-30 border-b bg-white">
          <div className="flex items-center">
            <button
              type="button"
              onClick={openSidebar}
              aria-label="Buka menu"
              className="ml-4 flex h-10 w-10 items-center justify-center rounded-lg text-2xl text-gray-700 transition hover:bg-amber-50 lg:hidden"
            >
              <MdMenu />
            </button>

            <div className="min-w-0 flex-1">
              <Header />
            </div>
          </div>
        </div>

        <main className="p-4 sm:p-6 lg:p-8">
          <div className="mx-auto w-full max-w-[1600px]">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}