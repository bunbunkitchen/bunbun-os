import { BrowserRouter, Routes, Route } from "react-router-dom";

import MainLayout from "../components/layout/MainLayout";
import ProtectedRoute from "./ProtectedRoute";
import RoleRoute from "./RoleRoute";

import Login from "../pages/auth/Login";
import Dashboard from "../pages/dashboard/Dashboard";
import Products from "../pages/products/Products";
import Categories from "../pages/categories/Categories";
import Ingredients from "../pages/ingredients/Ingredients";
import Suppliers from "../pages/suppliers/Suppliers";
import Recipes from "../pages/recipes/Recipes";
import RecipeDetail from "../pages/recipes/RecipeDetail";
import Production from "../pages/production/Production";
import ProductionBatches from "../pages/production/ProductionBatches";
import Inventory from "../pages/inventory/Inventory";
import ProductStock from "../pages/inventory/ProductStock";
import Purchasing from "../pages/purchasing/Purchasing";
import Maintenance from "../pages/maintenance/Maintenance";
import Income from "../pages/finance/Income";
import Expense from "../pages/finance/Expense";
import Sales from "../pages/sales/Sales";
import Reports from "../pages/reports/Reports";
import Settings from "../pages/settings/Settings";
import GoLiveChecklist from "../pages/settings/GoLiveChecklist";
import Profile from "../pages/profile/Profile";
import UserManagement from "../pages/users/UserManagement";

export default function AppRoutes() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<Login />} />

        <Route
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="profile" element={<Profile />} />

          <Route path="users" element={<RoleRoute allowedRoles={["owner"]}><UserManagement /></RoleRoute>} />
          <Route path="products" element={<RoleRoute allowedRoles={["owner"]}><Products /></RoleRoute>} />
          <Route path="categories" element={<RoleRoute allowedRoles={["owner"]}><Categories /></RoleRoute>} />
          <Route path="ingredients" element={<RoleRoute allowedRoles={["owner"]}><Ingredients /></RoleRoute>} />
          <Route path="suppliers" element={<RoleRoute allowedRoles={["owner"]}><Suppliers /></RoleRoute>} />

          <Route path="recipes" element={<RoleRoute allowedRoles={["owner", "baker"]}><Recipes /></RoleRoute>} />
          <Route path="recipes/:recipeKode" element={<RoleRoute allowedRoles={["owner", "baker"]}><RecipeDetail /></RoleRoute>} />
          <Route path="production" element={<RoleRoute allowedRoles={["owner", "baker"]}><Production /></RoleRoute>} />

          <Route path="production/batches" element={<RoleRoute allowedRoles={["owner", "baker", "helper"]}><ProductionBatches /></RoleRoute>} />
          <Route path="inventory" element={<RoleRoute allowedRoles={["owner", "baker", "helper"]}><Inventory /></RoleRoute>} />
          <Route path="product-stock" element={<RoleRoute allowedRoles={["owner", "baker", "helper"]}><ProductStock /></RoleRoute>} />

          <Route path="purchasing" element={<RoleRoute allowedRoles={["owner", "baker"]}><Purchasing /></RoleRoute>} />
          <Route path="maintenance" element={<RoleRoute allowedRoles={["owner", "baker"]}><Maintenance /></RoleRoute>} />

          <Route path="finance/income" element={<RoleRoute allowedRoles={["owner"]}><Income /></RoleRoute>} />

          {/* Penjualan dapat diinput oleh Owner dan Baker */}
          <Route path="sales" element={<RoleRoute allowedRoles={["owner", "baker"]}><Sales /></RoleRoute>} />

          <Route path="finance/expense" element={<RoleRoute allowedRoles={["owner"]}><Expense /></RoleRoute>} />
          <Route path="reports" element={<RoleRoute allowedRoles={["owner"]}><Reports /></RoleRoute>} />
          <Route path="settings" element={<RoleRoute allowedRoles={["owner"]}><Settings /></RoleRoute>} />
          <Route path="settings/go-live" element={<RoleRoute allowedRoles={["owner"]}><GoLiveChecklist /></RoleRoute>} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
