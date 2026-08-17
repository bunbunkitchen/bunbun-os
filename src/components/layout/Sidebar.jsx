import { NavLink } from "react-router-dom";

import {
  MdDashboard,
  MdBakeryDining,
  MdCategory,
  MdScience,
  MdLocalShipping,
  MdMenuBook,
  MdFactory,
  MdInventory,
  MdAcUnit,
  MdShoppingCart,
  MdCleaningServices,
  MdSettings,
  MdViewKanban,
  MdAttachMoney,
  MdPointOfSale,
  MdMoneyOff,
  MdAssessment,
  MdBuild,
  MdClose,
} from "react-icons/md";

import { useAuth } from "../../context/AuthContext";

const menus = [
  {
    name: "Dashboard",
    path: "/",
    icon: <MdDashboard />,
    roles: ["owner", "baker", "helper"],
  },
  {
    name: "Produk",
    path: "/products",
    icon: <MdBakeryDining />,
    roles: ["owner"],
  },
  {
    name: "Kategori",
    path: "/categories",
    icon: <MdCategory />,
    roles: ["owner"],
  },
  {
    name: "Bahan Baku",
    path: "/ingredients",
    icon: <MdScience />,
    roles: ["owner"],
  },
  {
    name: "Supplier",
    path: "/suppliers",
    icon: <MdLocalShipping />,
    roles: ["owner"],
  },
  {
    name: "Recipe",
    path: "/recipes",
    icon: <MdMenuBook />,
    roles: ["owner", "baker"],
  },
  {
    name: "Produksi",
    path: "/production",
    icon: <MdFactory />,
    roles: ["owner", "baker"],
  },
  {
    name: "Production Batch",
    path: "/production/batches",
    icon: <MdViewKanban />,
    roles: ["owner", "baker", "helper"],
  },
  {
    name: "Inventory",
    path: "/inventory",
    icon: <MdInventory />,
    roles: ["owner", "baker", "helper"],
  },
  {
    name: "Stok Produk",
    path: "/product-stock",
    icon: <MdAcUnit />,
    roles: ["owner", "baker", "helper"],
  },
  {
    name: "Pemasukan",
    path: "/finance/income",
    icon: <MdAttachMoney />,
    roles: ["owner"],
  },
  {
    name: "Penjualan",
    path: "/sales",
    icon: <MdPointOfSale />,
    roles: ["owner"],
  },
  {
    name: "Pengeluaran",
    path: "/finance/expense",
    icon: <MdMoneyOff />,
    roles: ["owner"],
  },
  {
    name: "Laporan",
    path: "/reports",
    icon: <MdAssessment />,
    roles: ["owner"],
  },
  {
    name: "Purchasing",
    path: "/purchasing",
    icon: <MdShoppingCart />,
    roles: ["owner", "baker"],
  },
  {
    name: "Maintenance",
    path: "/maintenance",
    icon: <MdBuild />,
    roles: ["owner", "baker"],
  },
  {
    name: "Settings",
    path: "/settings",
    icon: <MdSettings />,
    roles: ["owner"],
  },
];

export default function Sidebar({
  open = false,
  onClose = () => {},
}) {
  const { role, profile } = useAuth();

  const visibleMenus = menus.filter(
    (menu) =>
      !menu.roles ||
      menu.roles.includes(role)
  );

  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Tutup menu"
          onClick={onClose}
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-white shadow-xl transition-transform duration-200 lg:translate-x-0 lg:shadow-none ${
          open
            ? "translate-x-0"
            : "-translate-x-full"
        }`}
      >
        <div className="flex items-start justify-between border-b px-6 py-5">
          <div>
            <h1 className="text-2xl font-bold text-amber-700">
              Bunbun OS
            </h1>

            <p className="mt-1 text-sm text-gray-500">
              Bunbun Kitchen
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Tutup menu"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-2xl text-gray-500 transition hover:bg-gray-100 hover:text-gray-800 lg:hidden"
          >
            <MdClose />
          </button>
        </div>

        <nav className="flex-1 space-y-2 overflow-y-auto px-4 py-5">
          {visibleMenus.map((menu) => (
            <NavLink
              key={menu.path}
              to={menu.path}
              end={menu.path === "/"}
              onClick={onClose}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-medium transition ${
                  isActive
                    ? "bg-amber-700 text-white shadow-sm"
                    : "text-gray-700 hover:bg-amber-50 hover:text-amber-800"
                }`
              }
            >
              <span className="text-xl">
                {menu.icon}
              </span>

              <span>{menu.name}</span>
            </NavLink>
          ))}
        </nav>

        <div className="border-t px-5 py-4">
          <p className="truncate text-sm font-semibold text-gray-800">
            {profile?.full_name ||
              "Pengguna Bunbun OS"}
          </p>

          <p className="mt-1 text-xs capitalize text-gray-500">
            {role || "user"}
          </p>
        </div>
      </aside>
    </>
  );
}
